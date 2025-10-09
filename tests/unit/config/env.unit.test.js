import { afterEach, beforeEach, describe, jest, test } from '@jest/globals'
import assert from 'node:assert/strict'
import { restoreEnv, snapshotEnv } from '../../helpers/test-fakes.js'

const REQUIRED_ENV = [
  'API_ID',
  'API_HASH',
  'PHONE_NUMBER',
  'TELEGRAM_BOT_TOKEN',
  'TG_SOURCE_CHANNEL',
  'TG_TARGETS'
]

describe('config environment parsing', () => {
  let envSnapshot

  beforeEach(() => {
    envSnapshot = snapshotEnv([...REQUIRED_ENV, 'NODE_ENV'])
  })

  afterEach(() => {
    restoreEnv(envSnapshot)
  })

  test('config parses multiple source channels', async () => {
    process.env.NODE_ENV = 'development'
    process.env.API_ID = '123456'
    process.env.API_HASH = 'hash'
    process.env.PHONE_NUMBER = '+1234567890'
    process.env.TELEGRAM_BOT_TOKEN = 'token'
    process.env.TG_SOURCE_CHANNEL = '@alpha,@beta'
    process.env.TG_TARGETS = '-1001234567890,-1009876543210'

    jest.resetModules()
    const { config } = await import('../../../src/config.js')

    assert.deepEqual(config.sources, ['@alpha', '@beta'])
    assert.strictEqual(config.source, '@alpha')
    assert.strictEqual(config.targets.length, 2)
  })
})
