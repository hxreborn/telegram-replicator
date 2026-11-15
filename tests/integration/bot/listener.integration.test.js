import { jest, test } from '@jest/globals'
import assert from 'node:assert/strict'

import { createListener } from '../../../src/bot/listener.js'
import { createLoggerDouble } from '../../helpers/test-fakes.js'

test('createListener emits events and surfaces channel trust metadata', async () => {
  const fsWrites = []
  const fakeFs = {
    existsSync: () => false,
    chmodSync: () => {},
    readFileSync: () => '',
    writeFileSync: (path, data, options) => {
      fsWrites.push({ path, data, options })
    },
    statSync: () => ({ mode: 0o600 })
  }

  const loggerDouble = createLoggerDouble()

  const processStub = {
    env: {},
    stdout: { write: () => {} },
    stdin: { once: () => {} },
    exitCodes: [],
    exit(code) {
      this.exitCodes.push(code)
    }
  }

  const entities = {
    '@flagged': {
      id: 1,
      username: 'flagged',
      title: 'Flagged Source',
      verified: false,
      scam: true,
      fake: false
    },
    '@legit': {
      id: 2,
      username: 'legit',
      title: 'Legit Source',
      verified: false,
      scam: false,
      fake: false
    }
  }

  let registeredHandler
  let disconnectCalled = false

  const fakeClient = {
    startOptions: null,
    session: {
      save: () => 'session-data'
    },
    start: async (options) => {
      fakeClient.startOptions = options
      fakeClient.connected = true
    },
    connect: async () => {
      fakeClient.connected = true
    },
    connected: true,
    getDialogs: async () => {},
    getEntity: async (input) => {
      const entity = entities[input]
      if (!entity) {
        throw new Error(`Unknown source ${input}`)
      }
      return entity
    },
    addEventHandler: (handler) => {
      registeredHandler = handler
    },
    on: () => {},
    disconnect: async () => {
      disconnectCalled = true
    },
    downloadMedia: async () => Buffer.from('media')
  }

  const listener = await createListener(
    {
      apiId: 123,
      apiHash: 'hash',
      phone: '+123456789',
      sources: ['@flagged', '@legit'],
      twoFactorPassword: 'otp'
    },
    {
      clientFactory: () => fakeClient,
      sessionFile: 'test-session',
      fs: fakeFs,
      logger: loggerDouble.logger,
      process: processStub,
      eventClass: class FakeNewMessage {}
    }
  )

  assert.ok(fakeClient.startOptions, 'starts authentication when no session exists')
  assert.strictEqual(fsWrites.length, 1)
  assert.ok(fsWrites[0].path.endsWith('test-session'))
  assert.strictEqual(fsWrites[0].options.mode, 0o600)

  assert.ok(registeredHandler, 'registers GramJS event handler')

  const received = []
  listener.on('message', (payload) => {
    received.push(payload)
  })

  const eventMessage = {
    id: 99,
    message: 'hello world',
    peerId: { channelId: BigInt(2) }
  }

  await registeredHandler({ message: eventMessage })

  assert.strictEqual(received.length, 1)
  assert.strictEqual(received[0].message, eventMessage)
  assert.strictEqual(received[0].source.label, '@legit')

  const flaggedLog = loggerDouble.entries.find(
    (entry) =>
      entry.level === 'error' &&
      entry.args[1] === 'Source channel flagged by Telegram metadata; review before replicating'
  )
  assert.ok(flaggedLog, 'logs flagged channels')

  const unverifiedWarn = loggerDouble.entries.find(
    (entry) =>
      entry.level === 'warn' &&
      entry.args[1] === 'Source channel is not verified; confirm authenticity before replicating'
  )
  assert.ok(unverifiedWarn, 'warns when channel lacks verification badge')

  const mediaBuffer = await listener.downloadMedia(
    { id: 1, media: { document: { size: 512 } } },
    2048
  )
  assert.ok(Buffer.isBuffer(mediaBuffer))

  const oversize = await listener.downloadMedia(
    { id: 2, media: { document: { size: 10_000 } } },
    1024
  )
  assert.strictEqual(oversize, null, 'drops media larger than configured limit')

  await listener.stop()
  assert.ok(disconnectCalled, 'disconnects GramJS client on stop')
  assert.deepEqual(processStub.exitCodes, [], 'does not exit process during normal operations')
})

async function createMonitoredListener(getMessages = async () => []) {
  const client = {
    connected: true,
    connect: async () => {},
    getDialogs: async () => {},
    getEntity: async () => ({ id: 1, title: 'Source' }),
    getMessages,
    addEventHandler: () => {},
    on: () => {},
    disconnect: async () => {}
  }
  const exit = jest.fn()
  const loggerDouble = createLoggerDouble()
  const listener = await createListener(
    { apiId: 123, apiHash: 'hash', sources: ['source'] },
    {
      clientFactory: () => client,
      fs: {
        existsSync: () => true,
        statSync: () => ({ mode: 0o600 }),
        readFileSync: () => 'session'
      },
      logger: loggerDouble.logger,
      process: { exit }
    }
  )
  return { client, listener, exit, entries: loggerDouble.entries }
}

test('connection monitor exits without private GramJS connection state', async () => {
  jest.useFakeTimers()
  const { client, listener, exit } = await createMonitoredListener()
  try {
    client.connected = false
    await jest.advanceTimersByTimeAsync(299999)
    assert.equal(exit.mock.calls.length, 0)
    await jest.advanceTimersByTimeAsync(1)
    assert.equal(exit.mock.calls.length, 1)
    assert.equal(exit.mock.calls[0][0], 1)
  } finally {
    await listener.stop()
    jest.useRealTimers()
  }
})

test('stalled polling exits without accumulating pending requests', async () => {
  jest.useFakeTimers()
  const getMessages = jest.fn().mockResolvedValue([])
  const { listener, exit } = await createMonitoredListener(getMessages)
  getMessages.mockImplementation(() => new Promise(() => {}))
  try {
    await jest.advanceTimersByTimeAsync(600000)
    assert.equal(exit.mock.calls.length, 1)
    assert.equal(exit.mock.calls[0][0], 1)
    assert.equal(getMessages.mock.calls.length, 3)
  } finally {
    await listener.stop()
    jest.useRealTimers()
  }
})

test('successful empty polls keep an idle source healthy and stop clears monitoring', async () => {
  jest.useFakeTimers()
  const { client, listener, exit } = await createMonitoredListener()
  try {
    await jest.advanceTimersByTimeAsync(1500000)
    assert.equal(exit.mock.calls.length, 0)
    await listener.stop()
    client.connected = false
    await jest.advanceTimersByTimeAsync(600000)
    assert.equal(exit.mock.calls.length, 0)
  } finally {
    jest.useRealTimers()
  }
})

test('health logging records successful reads even when the channel is quiet', async () => {
  jest.useFakeTimers()
  const { listener, entries } = await createMonitoredListener()
  try {
    await jest.advanceTimersByTimeAsync(600000)
    const healthy = entries.filter((entry) => entry.args[1] === 'Source polling healthy')
    assert.equal(healthy.length, 2)
    assert.equal(healthy[0].args[0].sourceCount, 1)
  } finally {
    await listener.stop()
    jest.useRealTimers()
  }
})

test('failed source reads do not log a healthy polling cycle', async () => {
  jest.useFakeTimers()
  const getMessages = jest.fn().mockResolvedValue([])
  const { listener, entries } = await createMonitoredListener(getMessages)
  getMessages.mockRejectedValue(new Error('TIMEOUT'))
  try {
    await jest.advanceTimersByTimeAsync(300000)
    assert.equal(entries.filter((entry) => entry.args[1] === 'Source polling healthy').length, 0)
  } finally {
    await listener.stop()
    jest.useRealTimers()
  }
})
