import { test } from 'node:test'
import assert from 'node:assert/strict'

import { splitIntoChunks } from '../src/bot/sender.js'

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
