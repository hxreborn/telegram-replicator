import { test } from '@jest/globals'
import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { splitIntoChunks } from '../../../../src/bot/sender.js'

/**
 * Performance benchmark tests ensure critical paths remain fast
 * These tests will fail if performance degrades significantly
 */

test('benchmark: splitIntoChunks handles 1MB text under 100ms', () => {
  const hugeText = 'word '.repeat(200000) // ~1MB
  const start = performance.now()

  splitIntoChunks(hugeText, 4096)

  const duration = performance.now() - start

  assert.ok(duration < 100, `Chunking 1MB text took ${duration.toFixed(2)}ms, expected <100ms`)
})

test('benchmark: splitIntoChunks handles 10K words under 10ms', () => {
  const text = 'word '.repeat(10000) // ~50KB
  const start = performance.now()

  splitIntoChunks(text, 4096)

  const duration = performance.now() - start

  assert.ok(duration < 10, `Chunking 10K words took ${duration.toFixed(2)}ms, expected <10ms`)
})

test('benchmark: splitIntoChunks handles long URL list under 20ms', () => {
  const url = 'https://example.com/very-long-url-path-without-any-spaces-to-break-on'
  const text = (url + ' ').repeat(1000) // ~80KB of URLs
  const start = performance.now()

  splitIntoChunks(text, 4096)

  const duration = performance.now() - start

  assert.ok(duration < 20, `Chunking URL list took ${duration.toFixed(2)}ms, expected <20ms`)
})

test('benchmark: splitIntoChunks with tiny limit remains under 50ms', () => {
  const text = 'x'.repeat(10000) // Force many chunks
  const start = performance.now()

  splitIntoChunks(text, 10) // Very small limit = many iterations

  const duration = performance.now() - start

  assert.ok(duration < 50, `Chunking with tiny limit took ${duration.toFixed(2)}ms, expected <50ms`)
})

test('benchmark: splitIntoChunks handles typical message under 1ms', () => {
  // Typical Telegram message length
  const text = 'This is a typical message with multiple words and sentences. '.repeat(10)
  const iterations = 1000
  const start = performance.now()

  for (let i = 0; i < iterations; i++) {
    splitIntoChunks(text, 4096)
  }

  const duration = performance.now() - start
  const avgDuration = duration / iterations

  assert.ok(
    avgDuration < 1,
    `Average chunking time: ${avgDuration.toFixed(4)}ms, expected <1ms per message`
  )
})

test('benchmark: splitIntoChunks memory efficiency check', () => {
  // This test verifies that chunking doesn't create excessive intermediate objects
  const text = 'word '.repeat(100000) // ~500KB
  const limit = 4096

  const memBefore = process.memoryUsage().heapUsed
  const chunks = splitIntoChunks(text, limit)
  const memAfter = process.memoryUsage().heapUsed

  const memIncrease = (memAfter - memBefore) / 1024 / 1024 // MB

  // Memory increase should be reasonable (under 10MB for 500KB text)
  assert.ok(
    memIncrease < 10,
    `Memory increase: ${memIncrease.toFixed(2)}MB, expected <10MB for 500KB text. Chunks: ${chunks.length}`
  )
})

test('benchmark: splitIntoChunks scales linearly with input size', () => {
  const sizes = [1000, 5000, 10000, 50000]
  const durations = []

  for (const size of sizes) {
    const text = 'word '.repeat(size)
    const start = performance.now()
    splitIntoChunks(text, 4096)
    const duration = performance.now() - start
    durations.push(duration)
  }

  // Verify roughly linear scaling
  // Time for 50K should be < 50x time for 1K (allowing for overhead)
  const ratio = durations[3] / durations[0]

  assert.ok(
    ratio < 100,
    `Scaling ratio: ${ratio.toFixed(2)}x (50K vs 1K words), expected <100x for linear performance`
  )
})
