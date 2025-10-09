import { test } from '@jest/globals'
import assert from 'node:assert/strict'

import { retryWithBackoff } from '../../../src/utils/retry.js'
import { createLoggerDouble } from '../../helpers/test-fakes.js'

test('retryWithBackoff retries once when retry_after is provided', async () => {
  let callCount = 0
  const delays = []
  const loggerDouble = createLoggerDouble()

  const fn = async () => {
    callCount++
    if (callCount === 1) {
      const err = new Error('rate limited')
      err.parameters = { retry_after: 0.2 }
      throw err
    }
  }

  await retryWithBackoff({
    fn,
    maxRetries: 3,
    initialRetryAfter: 0.1,
    sleep: async (delay) => {
      delays.push(delay)
    },
    random: () => 0,
    logger: loggerDouble.logger
  })

  assert.strictEqual(callCount, 2)
  assert.deepEqual(delays, [1000, 2000])
  const successLog = loggerDouble.entries.find(
    (entry) => entry.level === 'info' && entry.args[1].includes('succeeded')
  )
  assert.ok(successLog)
})

test('retryWithBackoff caps retry_after at 60 seconds', async () => {
  let callCount = 0
  const delays = []
  const loggerDouble = createLoggerDouble()

  const fn = async () => {
    callCount++
    if (callCount < 3) {
      const err = new Error('rate limited')
      err.parameters = { retry_after: 120 }
      throw err
    }
  }

  await retryWithBackoff({
    fn,
    maxRetries: 3,
    initialRetryAfter: 0.1,
    sleep: async (delay) => {
      delays.push(delay)
    },
    random: () => 0,
    logger: loggerDouble.logger
  })

  assert.strictEqual(callCount, 3)
  // First delay uses initialRetryAfter (0.1s), then updated to 60s from error
  assert.deepEqual(delays, [1000, 60000, 60000])
})

test('retryWithBackoff throws after exhausting retries', async () => {
  let callCount = 0
  const delays = []
  const loggerDouble = createLoggerDouble()

  await assert.rejects(
    async () => {
      await retryWithBackoff({
        fn: async () => {
          callCount++
          const err = new Error('Persistent failure')
          err.parameters = { retry_after: 0.1 }
          throw err
        },
        maxRetries: 2,
        initialRetryAfter: 0.1,
        sleep: async (delay) => {
          delays.push(delay)
        },
        random: () => 0,
        logger: loggerDouble.logger
      })
    },
    { message: 'Persistent failure' }
  )

  assert.strictEqual(callCount, 2)
  assert.deepEqual(delays, [1000, 2000])
  const errorLog = loggerDouble.entries.find((entry) => entry.level === 'error')
  assert.ok(errorLog)
})

test('retryWithBackoff applies jitter when provided', async () => {
  const delays = []
  await retryWithBackoff({
    fn: async () => {},
    maxRetries: 1,
    initialRetryAfter: 0,
    sleep: async (delay) => {
      delays.push(delay)
    },
    random: () => 0.5,
    logger: createLoggerDouble().logger
  })

  assert.deepEqual(delays, [1500])
})
