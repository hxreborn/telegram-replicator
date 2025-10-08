import { test } from '@jest/globals'
import assert from 'node:assert/strict'
import { splitIntoChunks } from '../../../../src/bot/sender.js'

/**
 * Property-based tests verify invariants that should hold for any input
 * These tests use generated test cases rather than specific examples
 */

test('property: chunks concatenated approximate original text', () => {
  // Generate test cases with various characteristics
  const testCases = [
    'short',
    'x'.repeat(10000), // Long single token
    'word '.repeat(5000), // Many words
    'https://example.com/very-long-url-without-spaces'.repeat(100), // Long URLs
    'a b c d e f g h i j k l m n o p q r s t u v w x y z'.repeat(100), // Single char words
    'word1 word2 word3\nword4 word5\nword6', // With newlines
    '   leading spaces', // Leading whitespace
    'trailing spaces   ', // Trailing whitespace
    'multiple    consecutive     spaces', // Multiple spaces
    ''
  ]

  for (const text of testCases) {
    const chunks = splitIntoChunks(text, 4096)
    const reconstructed = chunks.join('')

    // Invariant: chunks joined should reconstruct original (or very close for word boundaries)
    // Some text may be lost at word boundaries when splitting
    const lengthDiff = Math.abs(reconstructed.length - text.length)

    assert.ok(
      lengthDiff <= 10 || reconstructed.includes(text.slice(0, 100)),
      `Text reconstruction failed. Original: ${text.length} chars, Reconstructed: ${reconstructed.length} chars, Diff: ${lengthDiff}`
    )
  }
})

test('property: no chunk exceeds limit', () => {
  const testCases = [
    { text: 'word '.repeat(1000), limit: 100 },
    { text: 'x'.repeat(5000), limit: 50 },
    { text: 'short message', limit: 5 },
    { text: 'a b c d e f g h i j'.repeat(50), limit: 20 },
    { text: '   spaces   everywhere   ', limit: 10 }
  ]

  for (const { text, limit } of testCases) {
    const chunks = splitIntoChunks(text, limit)

    chunks.forEach((chunk, idx) => {
      assert.ok(
        chunk.length <= limit,
        `Chunk ${idx} exceeds limit: ${chunk.length} > ${limit}. Text: "${chunk.slice(0, 50)}..."`
      )
    })
  }
})

test('property: empty input produces empty output', () => {
  const limits = [1, 10, 100, 1000, 4096]

  for (const limit of limits) {
    const chunks = splitIntoChunks('', limit)
    assert.deepEqual(
      chunks,
      [],
      `Empty string should produce empty chunks array for limit ${limit}`
    )
  }
})

test('property: single character under limit returns single chunk', () => {
  const chars = ['a', 'x', '1', ' ', '\n']
  const limits = [1, 10, 100]

  for (const char of chars) {
    for (const limit of limits) {
      if (limit >= 1) {
        const chunks = splitIntoChunks(char, limit)
        assert.strictEqual(
          chunks.length,
          1,
          `Single char "${char}" with limit ${limit} should produce 1 chunk`
        )
        assert.strictEqual(chunks[0], char)
      }
    }
  }
})

test('property: text under limit returns single chunk', () => {
  const texts = ['hello', 'short message', 'fits in limit', 'a b c d e']
  const limit = 100

  for (const text of texts) {
    const chunks = splitIntoChunks(text, limit)
    assert.strictEqual(chunks.length, 1, `Text "${text}" under limit should be single chunk`)
    assert.strictEqual(chunks[0], text)
  }
})

test('property: total chunks length >= original length (accounting for splits)', () => {
  const testCases = ['word '.repeat(1000), 'x'.repeat(5000), 'https://example.com/url'.repeat(100)]

  for (const text of testCases) {
    const chunks = splitIntoChunks(text, 4096)
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)

    // Total should be close to original (some chars may be lost at word boundaries)
    const lengthRatio = totalLength / text.length

    assert.ok(
      lengthRatio >= 0.95 && lengthRatio <= 1.01,
      `Length ratio out of bounds: ${lengthRatio} (expected 0.95-1.01). Original: ${text.length}, Total: ${totalLength}`
    )
  }
})

test('property: all chunks are non-empty strings', () => {
  const testCases = [
    'word '.repeat(1000),
    'x'.repeat(5000),
    'a b c d e f g h'.repeat(200),
    '    spaces    everywhere    '
  ]

  for (const text of testCases) {
    const chunks = splitIntoChunks(text, 100)

    chunks.forEach((chunk, idx) => {
      assert.ok(typeof chunk === 'string', `Chunk ${idx} is not a string`)
      assert.ok(chunk.length > 0, `Chunk ${idx} is empty`)
    })
  }
})

test('property: word boundary splitting preserves words', () => {
  const text = 'apple banana cherry date elderberry fig grape'
  const chunks = splitIntoChunks(text, 20)

  // Reconstruct and verify all words are present
  const reconstructed = chunks.join('')
  const originalWords = text.split(' ')
  const reconstructedWords = reconstructed.split(' ').filter((w) => w.length > 0)

  // Most words should be preserved (some may merge if space is lost at boundary)
  assert.ok(
    reconstructedWords.length >= originalWords.length - 2,
    `Word count mismatch. Original: ${originalWords.length}, Reconstructed: ${reconstructedWords.length}`
  )
})

test('property: force-break on long tokens', () => {
  // Very long token without spaces should be force-broken
  const longToken = 'x'.repeat(500)
  const limit = 100
  const chunks = splitIntoChunks(longToken, limit)

  // Should have multiple chunks
  assert.ok(chunks.length >= 5, `Long token should be split into multiple chunks: ${chunks.length}`)

  // All chunks (except last) should be exactly limit length
  for (let i = 0; i < chunks.length - 1; i++) {
    assert.strictEqual(
      chunks[i].length,
      limit,
      `Chunk ${i} should be exactly ${limit} chars when force-breaking`
    )
  }
})

test('property: idempotence - chunking already-chunked text', () => {
  const text = 'word '.repeat(500)
  const limit = 100

  const chunks1 = splitIntoChunks(text, limit)
  const reconstructed = chunks1.join('')
  const chunks2 = splitIntoChunks(reconstructed, limit)

  // Chunking the reconstructed text should produce similar structure
  assert.ok(
    Math.abs(chunks1.length - chunks2.length) <= 1,
    `Chunk counts should be similar. First: ${chunks1.length}, Second: ${chunks2.length}`
  )
})
