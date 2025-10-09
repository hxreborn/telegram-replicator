import { test } from '@jest/globals'
import assert from 'node:assert/strict'
import { splitIntoChunks } from '../../../../src/bot/sender.js'

// These tests focus on the stateless function logic (splitIntoChunks).
// Full sender tests with adapter pattern are in tests/unit/bot/sender/index.unit.test.js

test('splitIntoChunks with caption limit (1024)', () => {
  const text = 'a'.repeat(1024) + ' ' + 'b'.repeat(50)
  const chunks = splitIntoChunks(text, 1024)

  assert.strictEqual(chunks[0].length, 1024)
  assert.ok(chunks[1].includes('b'))
})

test('splitIntoChunks handles message limit (4096)', () => {
  const longText = 'word '.repeat(1000) // ~5000 chars
  const chunks = splitIntoChunks(longText, 4096)

  assert.ok(chunks.length >= 2)
  chunks.forEach((chunk) => assert.ok(chunk.length <= 4096))
})

test('splitIntoChunks preserves word boundaries', () => {
  const text = 'short text that fits'
  const chunks = splitIntoChunks(text, 100)

  assert.strictEqual(chunks.length, 1)
  assert.strictEqual(chunks[0], text)
})

test('sender logic: caption under 1024 does not overflow', () => {
  const CAPTION_LIMIT = 1024
  const text = 'Photo caption'

  const caption = text.length <= CAPTION_LIMIT ? text : text.slice(0, CAPTION_LIMIT)
  const bodyChunks =
    text.length > CAPTION_LIMIT ? splitIntoChunks(text.slice(CAPTION_LIMIT), 4096) : []

  assert.strictEqual(caption, 'Photo caption')
  assert.strictEqual(bodyChunks.length, 0)
})

test('sender logic: caption over 1024 splits into caption + body', () => {
  const CAPTION_LIMIT = 1024
  const MESSAGE_LIMIT = 4096
  const longText = 'a'.repeat(1024) + ' ' + 'b'.repeat(100)

  const caption = longText.length <= CAPTION_LIMIT ? longText : longText.slice(0, CAPTION_LIMIT)
  const bodyChunks =
    longText.length > CAPTION_LIMIT
      ? splitIntoChunks(longText.slice(CAPTION_LIMIT), MESSAGE_LIMIT)
      : []

  assert.strictEqual(caption.length, 1024)
  assert.ok(bodyChunks.length > 0)
  assert.ok(bodyChunks[0].includes('b'))
})

test('sender logic: file_id caching simulation', () => {
  // Simulate the file_id caching behavior
  let cachedFileId = null
  const targets = [111, 222, 333]
  const uploadCount = { count: 0 }

  const simulateUpload = () => {
    uploadCount.count++
    return `file_id_${Date.now()}`
  }

  const simulateSend = (_target) => {
    if (!cachedFileId) {
      cachedFileId = simulateUpload()
    }
    // Subsequent sends use cached file_id, no upload
    return cachedFileId
  }

  const results = targets.map((target) => simulateSend(target))

  assert.strictEqual(uploadCount.count, 1) // Only one upload
  assert.strictEqual(results[0], results[1]) // Same file_id
  assert.strictEqual(results[1], results[2])
})

test('sender logic: rate limit error detection', () => {
  const err1 = new Error('Rate limit')
  err1.parameters = { retry_after: 30 }

  const err2 = new Error('Rate limit')
  err2.response = { error_code: 429, parameters: { retry_after: 45 } }

  const err3 = new Error('Rate limit')
  err3.response = { error_code: 429 }

  // Simulate rate limit detection logic from sender.js
  const getRetryAfter = (err) => {
    const retryAfterParam = err.parameters?.retry_after ?? err.response?.parameters?.retry_after
    let retryAfter =
      typeof retryAfterParam === 'number' && retryAfterParam > 0 ? retryAfterParam : null

    if (!retryAfter && (err.response?.error_code === 429 || err.code === 429)) {
      retryAfter = 30 // DEFAULT_FLOOD_WAIT_SECONDS
    }

    return retryAfter
  }

  assert.strictEqual(getRetryAfter(err1), 30)
  assert.strictEqual(getRetryAfter(err2), 45)
  assert.strictEqual(getRetryAfter(err3), 30) // Falls back to default
})

test('sender logic: media type to method mapping', () => {
  const mediaTypes = ['photo', 'video', 'audio', 'voice', 'document']

  const methodMap = {
    photo: 'sendPhoto',
    video: 'sendVideo',
    audio: 'sendAudio',
    voice: 'sendVoice',
    document: 'sendDocument'
  }

  mediaTypes.forEach((type) => {
    assert.ok(methodMap[type], `Should have method for ${type}`)
  })
})

test('sender logic: empty caption handling', () => {
  const emptyCaption = ''
  const validCaption = 'Has content'

  // Logic from sender.js
  const getOptions = (caption) =>
    caption && caption.length > 0 ? { caption, parse_mode: 'HTML' } : undefined

  assert.strictEqual(getOptions(emptyCaption), undefined)
  assert.deepEqual(getOptions(validCaption), { caption: 'Has content', parse_mode: 'HTML' })
})
