import { test } from '@jest/globals'
import assert from 'node:assert/strict'

import { splitIntoChunks } from '../../../../src/bot/sender.js'

test('splitIntoChunks respects limits when spaces exist', () => {
  const text = 'alpha beta gamma delta'
  const chunks = splitIntoChunks(text, 10)

  assert.deepEqual(chunks, ['alpha', 'beta', 'gamma', 'delta'])
})

test('splitIntoChunks force-breaks long tokens without spaces', () => {
  const longToken = 'x'.repeat(25)
  const chunks = splitIntoChunks(longToken, 10)

  assert.deepEqual(chunks, ['x'.repeat(10), 'x'.repeat(10), 'x'.repeat(5)])
})

test('splitIntoChunks mixes long tokens and spaced text', () => {
  const text = `intro ${'y'.repeat(15)} outro`
  const chunks = splitIntoChunks(text, 12)

  assert.deepEqual(chunks, ['intro', 'yyyyyyyyyyyy', 'yyy outro'])
})

// Edge cases recommended by analysis

test('splitIntoChunks handles empty string', () => {
  const chunks = splitIntoChunks('', 100)
  assert.deepEqual(chunks, [])
})

test('splitIntoChunks handles single character', () => {
  const chunks = splitIntoChunks('x', 10)
  assert.deepEqual(chunks, ['x'])
})

test('splitIntoChunks handles text exactly equal to limit', () => {
  const text = 'x'.repeat(100)
  const chunks = splitIntoChunks(text, 100)
  assert.deepEqual(chunks, [text])
})

test('splitIntoChunks handles limit of 1', () => {
  const chunks = splitIntoChunks('abc', 1)
  assert.deepEqual(chunks, ['a', 'b', 'c'])
})

test('splitIntoChunks handles whitespace-only text', () => {
  const chunks = splitIntoChunks('   ', 10)
  assert.deepEqual(chunks, ['   '])
})

test('splitIntoChunks handles text with multiple consecutive spaces', () => {
  const text = 'word    with    spaces'
  const chunks = splitIntoChunks(text, 12)
  assert.ok(chunks.every((c) => c.length <= 12))
  // Note: splitting at word boundaries removes the split space
  const reconstructed = chunks.join('')
  assert.ok(reconstructed.includes('word'))
  assert.ok(reconstructed.includes('with'))
  assert.ok(reconstructed.includes('spaces'))
})

test('splitIntoChunks handles newlines as non-space characters', () => {
  const text = 'line1\nline2\nline3'
  const chunks = splitIntoChunks(text, 10)
  assert.ok(chunks.every((c) => c.length <= 10))
})

test('splitIntoChunks handles very small limit', () => {
  const chunks = splitIntoChunks('hello', 2)
  assert.deepEqual(chunks, ['he', 'll', 'o'])
})
