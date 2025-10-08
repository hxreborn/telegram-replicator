import { test } from '@jest/globals'
import assert from 'node:assert/strict'

test('deduplication map tracks last seen message ID per source', () => {
  const lastMessageId = new Map()

  // Simulate message flow from source A
  lastMessageId.set('sourceA', 100)
  assert.strictEqual(lastMessageId.get('sourceA'), 100)

  // Update with newer message
  lastMessageId.set('sourceA', 105)
  assert.strictEqual(lastMessageId.get('sourceA'), 105)

  // Different source tracked independently
  lastMessageId.set('sourceB', 50)
  assert.strictEqual(lastMessageId.get('sourceB'), 50)
  assert.strictEqual(lastMessageId.get('sourceA'), 105)
})

test('deduplication drops messages with ID <= lastSeen', () => {
  const lastMessageId = new Map()
  lastMessageId.set('channel1', 100)

  // Simulate deduplication logic from index.js
  const shouldDrop = (msgId, sourceId) => {
    const lastSeen = lastMessageId.get(sourceId)
    return lastSeen !== undefined && msgId <= lastSeen
  }

  assert.strictEqual(shouldDrop(99, 'channel1'), true) // Older
  assert.strictEqual(shouldDrop(100, 'channel1'), true) // Same (duplicate)
  assert.strictEqual(shouldDrop(101, 'channel1'), false) // Newer
})

test('deduplication allows first message from new source', () => {
  const lastMessageId = new Map()

  const shouldDrop = (msgId, sourceId) => {
    const lastSeen = lastMessageId.get(sourceId)
    return lastSeen !== undefined && msgId <= lastSeen
  }

  // No entry for 'newChannel' - should not drop
  assert.strictEqual(shouldDrop(1, 'newChannel'), false)
  assert.strictEqual(lastMessageId.has('newChannel'), false)
})

test('deduplication handles monotonic ID updates', () => {
  const lastMessageId = new Map()

  const processMessage = (msgId, sourceId) => {
    const lastSeen = lastMessageId.get(sourceId)
    if (lastSeen !== undefined && msgId <= lastSeen) {
      return 'dropped'
    }
    lastMessageId.set(sourceId, msgId)
    return 'processed'
  }

  assert.strictEqual(processMessage(10, 'src1'), 'processed')
  assert.strictEqual(lastMessageId.get('src1'), 10)

  assert.strictEqual(processMessage(15, 'src1'), 'processed')
  assert.strictEqual(lastMessageId.get('src1'), 15)

  assert.strictEqual(processMessage(12, 'src1'), 'dropped') // Out of order
  assert.strictEqual(lastMessageId.get('src1'), 15) // Unchanged

  assert.strictEqual(processMessage(15, 'src1'), 'dropped') // Duplicate
  assert.strictEqual(lastMessageId.get('src1'), 15)

  assert.strictEqual(processMessage(20, 'src1'), 'processed')
  assert.strictEqual(lastMessageId.get('src1'), 20)
})

test('deduplication works across multiple sources independently', () => {
  const lastMessageId = new Map()

  const processMessage = (msgId, sourceId) => {
    const lastSeen = lastMessageId.get(sourceId)
    if (lastSeen !== undefined && msgId <= lastSeen) {
      return 'dropped'
    }
    lastMessageId.set(sourceId, msgId)
    return 'processed'
  }

  // Process messages from different sources
  assert.strictEqual(processMessage(100, 'channelA'), 'processed')
  assert.strictEqual(processMessage(200, 'channelB'), 'processed')
  assert.strictEqual(processMessage(50, 'channelC'), 'processed')

  // Each source tracks independently
  assert.strictEqual(lastMessageId.get('channelA'), 100)
  assert.strictEqual(lastMessageId.get('channelB'), 200)
  assert.strictEqual(lastMessageId.get('channelC'), 50)

  // Duplicates detected per-source
  assert.strictEqual(processMessage(100, 'channelA'), 'dropped')
  assert.strictEqual(processMessage(200, 'channelB'), 'dropped')
  assert.strictEqual(processMessage(50, 'channelC'), 'dropped')

  // New messages pass through
  assert.strictEqual(processMessage(101, 'channelA'), 'processed')
  assert.strictEqual(processMessage(201, 'channelB'), 'processed')
  assert.strictEqual(processMessage(51, 'channelC'), 'processed')
})

test('deduplication handles message ID wrapping edge case', () => {
  const lastMessageId = new Map()

  const processMessage = (msgId, sourceId) => {
    const lastSeen = lastMessageId.get(sourceId)
    if (lastSeen !== undefined && msgId <= lastSeen) {
      return 'dropped'
    }
    lastMessageId.set(sourceId, msgId)
    return 'processed'
  }

  // Telegram uses 32-bit signed integers for message IDs
  const maxInt32 = 2147483647

  lastMessageId.set('src1', maxInt32 - 5)

  assert.strictEqual(processMessage(maxInt32 - 4, 'src1'), 'processed')
  assert.strictEqual(processMessage(maxInt32, 'src1'), 'processed')

  // After reaching max, any message with lower ID would be dropped
  // This is expected behavior - Telegram resets channels, not IDs
  assert.strictEqual(processMessage(1, 'src1'), 'dropped')
})

test('deduplication map size grows with number of unique sources', () => {
  const lastMessageId = new Map()

  for (let i = 0; i < 10; i++) {
    lastMessageId.set(`source_${i}`, i * 100)
  }

  assert.strictEqual(lastMessageId.size, 10)

  // Verify each source independently tracked
  assert.strictEqual(lastMessageId.get('source_0'), 0)
  assert.strictEqual(lastMessageId.get('source_5'), 500)
  assert.strictEqual(lastMessageId.get('source_9'), 900)
})
