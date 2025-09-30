import { test } from 'node:test'
import assert from 'node:assert/strict'
import { filterMessage } from './filter.js'


const mockConfig = {
  filterRegex: /tech|update/i,
  stripRegex: /Powered by.*$/gi,
  maxMediaBytes: 10 * 1024 * 1024
}

test('filterMessage returns null for messages without text', () => {
  const msg = { id: 1, message: '' }
  const result = filterMessage(msg, mockConfig)
  assert.strictEqual(result, null)
})

test('filterMessage returns null when filter regex does not match', () => {
  const msg = { id: 2, message: 'Random content without keywords' }
  const result = filterMessage(msg, mockConfig)
  assert.strictEqual(result, null)
})

test('filterMessage filters and transforms matching message', () => {
  const msg = { id: 3, message: 'New tech update available' }
  const result = filterMessage(msg, mockConfig)
  assert.ok(result)
  assert.strictEqual(result.text, 'New tech update available')
  assert.strictEqual(result.sourceId, 3)
  assert.strictEqual(result.mediaType, null)
})

test('filterMessage strips footer patterns from text', () => {
  const msg = { id: 4, message: 'Tech news\nPowered by Example.com' }
  const result = filterMessage(msg, mockConfig)
  assert.ok(result)
  assert.strictEqual(result.text, 'Tech news')
})

test('filterMessage returns null if text is empty after stripping', () => {
  const msg = { id: 5, message: 'Powered by Example.com' }
  const result = filterMessage(msg, mockConfig)
  assert.strictEqual(result, null)
})

test('filterMessage escapes HTML special characters', () => {
  const msg = { id: 6, message: 'Tech update: <script>alert("xss")</script> & more' }
  const result = filterMessage(msg, mockConfig)
  assert.ok(result)
  assert.strictEqual(
    result.text,
    'Tech update: &lt;script&gt;alert("xss")&lt;/script&gt; &amp; more'
  )
})

test('filterMessage handles photo media type', () => {
  const msg = {
    id: 7,
    caption: 'Tech update',
    media: { _: 'messageMediaPhoto' }
  }
  const result = filterMessage(msg, mockConfig)
  assert.ok(result)
  assert.strictEqual(result.mediaType, 'photo')
})

test('filterMessage rejects documents exceeding size limit', () => {
  const msg = {
    id: 8,
    caption: 'Tech update',
    media: {
      _: 'messageMediaDocument',
      document: { size: 20 * 1024 * 1024 } // 20MB > 10MB limit
    }
  }
  const result = filterMessage(msg, mockConfig)
  assert.strictEqual(result, null)
})

test('filterMessage accepts documents within size limit', () => {
  const msg = {
    id: 9,
    caption: 'Tech update',
    media: {
      _: 'messageMediaDocument',
      document: { size: 5 * 1024 * 1024 } // 5MB < 10MB limit
    }
  }
  const result = filterMessage(msg, mockConfig)
  assert.ok(result)
  assert.strictEqual(result.mediaType, 'document')
})
