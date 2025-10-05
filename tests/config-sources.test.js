import { test } from 'node:test'
import assert from 'node:assert/strict'

const REQUIRED_ENV = [
  'API_ID',
  'API_HASH',
  'PHONE_NUMBER',
  'TELEGRAM_BOT_TOKEN',
  'TG_SOURCE_CHANNEL',
  'TG_TARGETS'
]

function snapshotEnv(keys) {
  return keys.reduce((acc, key) => {
    acc[key] = process.env[key]
    return acc
  }, {})
}

test('config parses multiple source channels', async (t) => {
  const backup = snapshotEnv([...REQUIRED_ENV, 'NODE_ENV'])

  const restore = () => {
    for (const [key, value] of Object.entries(backup)) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }

  t.after(restore)

  process.env.NODE_ENV = 'development'
  process.env.API_ID = '123456'
  process.env.API_HASH = 'hash'
  process.env.PHONE_NUMBER = '+1234567890'
  process.env.TELEGRAM_BOT_TOKEN = 'token'
  process.env.TG_SOURCE_CHANNEL = '@alpha,@beta'
  process.env.TG_TARGETS = '-1001234567890,-1009876543210'

  const { config } = await import(`../src/config.js?multi=${Date.now()}`)

  assert.deepEqual(config.sources, ['@alpha', '@beta'])
  assert.strictEqual(config.source, '@alpha')
  assert.strictEqual(config.targets.length, 2)
})
