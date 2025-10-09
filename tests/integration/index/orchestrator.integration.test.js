import { test } from '@jest/globals'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'

import { main } from '../../../src/index.js'
import { createLoggerDouble } from '../../helpers/test-fakes.js'

test('main orchestrates listener, sender, dedupe, and shutdown', async () => {
  const loggerDouble = createLoggerDouble()

  const registeredSignals = {}
  const exitCodes = []
  const nodeProcess = {
    once: (signal, handler) => {
      registeredSignals[signal] = handler
    },
    exit: (code) => {
      exitCodes.push(code)
    }
  }

  const config = {
    sources: ['@source'],
    targets: [-100123],
    filterRegex: /allowed/i,
    stripRegex: /strip/gi,
    maxMediaBytes: 2048,
    logLevel: 'info',
    twoFactorPassword: '',
    botToken: 'TEST_TOKEN',
    apiId: 42,
    apiHash: 'hash',
    phone: '+123456789'
  }

  const sendCalls = []
  let senderStopSignal = null
  const createSender = async (token, targets, _options) => {
    assert.strictEqual(token, 'TEST_TOKEN')
    assert.deepEqual(targets, [-100123])
    return {
      send: async (payload) => {
        sendCalls.push(payload)
      },
      stop: (signal) => {
        senderStopSignal = signal
      }
    }
  }

  const emitter = new EventEmitter()
  const downloadCalls = []
  let listenerStopped = false
  emitter.downloadMedia = async (msg, maxBytes) => {
    downloadCalls.push({ id: msg.id, maxBytes })
    if (msg.id === 4) {
      return null
    }
    return Buffer.from(`media-${msg.id}`)
  }
  emitter.stop = async () => {
    listenerStopped = true
  }

  const createListener = async (options) => {
    assert.deepEqual(options.sources, ['@source'])
    return emitter
  }

  const filterMessage = (msg) => {
    if (msg.id === 2) return null
    if (msg.id === 3 || msg.id === 4) {
      return { text: `media-${msg.id}`, mediaType: 'photo', sourceId: `id-${msg.id}` }
    }
    return { text: `message-${msg.id}`, mediaType: null, sourceId: `id-${msg.id}` }
  }

  const maskChatId = (chatId) => `masked-${chatId}`

  await main({
    config,
    logger: loggerDouble.logger,
    maskChatId,
    createListener,
    createSender,
    filterMessage,
    nodeProcess
  })

  const source = { id: 1n, label: 'sourceLabel' }
  const drain = () => new Promise((resolve) => setTimeout(resolve, 0))
  const emitAndDrain = async (id, message) => {
    emitter.emit('message', { message: { id, message }, source })
    await drain()
  }

  await emitAndDrain(1, 'hello')
  await emitAndDrain(1, 'duplicate')
  await emitAndDrain(2, 'filtered')
  await emitAndDrain(3, 'media ok')
  await emitAndDrain(4, 'media fail')

  assert.strictEqual(sendCalls.length, 2)
  assert.deepEqual(sendCalls[0], {
    text: 'message-1',
    media: null,
    mediaType: null,
    sourceId: 'sourceLabel#id-1'
  })
  assert.strictEqual(sendCalls[1].mediaType, 'photo')
  assert.ok(Buffer.isBuffer(sendCalls[1].media))
  assert.strictEqual(sendCalls[1].sourceId, 'sourceLabel#id-3')

  assert.deepEqual(
    downloadCalls.map((call) => call.id),
    [3, 4]
  )
  assert.strictEqual(listenerStopped, false)

  assert.ok(registeredSignals.SIGINT)
  assert.ok(registeredSignals.SIGTERM)

  await registeredSignals.SIGTERM()

  assert.strictEqual(listenerStopped, true)
  assert.strictEqual(senderStopSignal, 'SIGTERM')
  assert.deepEqual(exitCodes, [0])

  const duplicateDebug = loggerDouble.entries.find(
    (entry) =>
      entry.level === 'debug' && entry.args[1] === 'Duplicate message' && entry.args[0].msgId === 1
  )
  assert.ok(duplicateDebug, 'logs duplicate detection')
})
