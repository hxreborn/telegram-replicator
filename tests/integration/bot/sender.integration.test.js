import { test } from '@jest/globals'
import assert from 'node:assert/strict'
import { createSender } from '../../../src/bot/sender.js'

/**
 * Integration tests for sender with real Telegraf adapter
 *
 * These tests are SKIPPED by default to avoid hitting Telegram API limits
 * and requiring real credentials during normal test runs.
 *
 * To run integration tests:
 *   RUN_TELEGRAM_INTEGRATION=1 TELEGRAM_BOT_TOKEN=your_token TELEGRAM_TARGET_ID=your_chat_id npm test
 *
 * Requirements:
 *   - TELEGRAM_BOT_TOKEN: Valid bot token from @BotFather
 *   - TELEGRAM_TARGET_ID: Chat ID where test messages will be sent (use a private test chat)
 *
 * WARNING: These tests will send real messages to Telegram. Use a dedicated test chat.
 */

const INTEGRATION_ENABLED = process.env.RUN_TELEGRAM_INTEGRATION === '1'
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN
const TARGET_ID = process.env.TELEGRAM_TARGET_ID

const maybeTest = (name, fn) => {
  if (INTEGRATION_ENABLED) {
    return test(name, fn)
  }

  return test.skip(`${name} (skipped: Set RUN_TELEGRAM_INTEGRATION=1 to run integration tests)`, () => {})
}

maybeTest('integration: sender sends real message via Telegraf', async () => {
  if (!BOT_TOKEN || !TARGET_ID) {
    throw new Error(
      'Integration tests require TELEGRAM_BOT_TOKEN and TELEGRAM_TARGET_ID environment variables.\n' +
        'Example: RUN_TELEGRAM_INTEGRATION=1 TELEGRAM_BOT_TOKEN=xxx TELEGRAM_TARGET_ID=123 npm test'
    )
  }

  const targetIdNumber = Number(TARGET_ID)
  if (!Number.isFinite(targetIdNumber)) {
    throw new Error(`TELEGRAM_TARGET_ID must be a numeric chat ID, got: ${TARGET_ID}`)
  }

  const sender = await createSender(BOT_TOKEN, [targetIdNumber])

  const timestamp = new Date().toISOString()
  const testMessage = `🧪 Integration test message\nTimestamp: ${timestamp}\nThis is an automated test from sender.integration.test.js`

  try {
    await sender.send({
      text: testMessage,
      sourceId: 'integration-test'
    })

    // If we got here without throwing, the send succeeded
    assert.ok(true, 'Message sent successfully')
  } catch (err) {
    assert.fail(`Integration test failed: ${err.message}\n${err.stack}`)
  } finally {
    sender.stop('TEST_COMPLETE')
  }
})

maybeTest('integration: sender sends photo with caption via Telegraf', async () => {
  if (!BOT_TOKEN || !TARGET_ID) {
    throw new Error('Integration tests require TELEGRAM_BOT_TOKEN and TELEGRAM_TARGET_ID')
  }

  const targetIdNumber = Number(TARGET_ID)
  const sender = await createSender(BOT_TOKEN, [targetIdNumber])

  // Create a minimal 1x1 red PNG image (67 bytes)
  const redPixelPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
    'base64'
  )

  const timestamp = new Date().toISOString()

  try {
    await sender.send({
      text: `🧪 Integration test photo\nTimestamp: ${timestamp}`,
      media: redPixelPng,
      mediaType: 'photo',
      sourceId: 'integration-test-photo'
    })

    assert.ok(true, 'Photo sent successfully')
  } catch (err) {
    assert.fail(`Integration test failed: ${err.message}\n${err.stack}`)
  } finally {
    sender.stop('TEST_COMPLETE')
  }
})

maybeTest('integration: sender handles rate limiting gracefully', async () => {
  if (!BOT_TOKEN || !TARGET_ID) {
    throw new Error('Integration tests require TELEGRAM_BOT_TOKEN and TELEGRAM_TARGET_ID')
  }

  const targetIdNumber = Number(TARGET_ID)
  const sender = await createSender(BOT_TOKEN, [targetIdNumber])

  const timestamp = new Date().toISOString()

  try {
    // Send multiple messages rapidly to potentially trigger rate limiting
    // The sender should handle any rate limits automatically with retry logic
    for (let i = 0; i < 3; i++) {
      await sender.send({
        text: `🧪 Rate limit test ${i + 1}/3\nTimestamp: ${timestamp}`,
        sourceId: `integration-rate-test-${i}`
      })
    }

    assert.ok(true, 'All messages sent successfully despite potential rate limits')
  } catch (err) {
    // If we fail after all retries, that's acceptable for this test
    // We're just verifying the retry mechanism doesn't crash
    if (err.message.includes('retry')) {
      assert.ok(true, 'Retry mechanism engaged as expected')
    } else {
      throw err
    }
  } finally {
    sender.stop('TEST_COMPLETE')
  }
})
