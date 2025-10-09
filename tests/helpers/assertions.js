/**
 * Minimal assertion helpers to reduce boilerplate in tests
 * Keep these explicit - they should be thin wrappers, not abstractions
 * All use node:assert/strict under the hood for consistency
 */

import assert from 'node:assert/strict'

/**
 * Assert that all items in array satisfy predicate
 * Clearer intent than forEach, shows index on failure
 * @template T
 * @param {T[]} items
 * @param {(item: T, index: number) => void} predicate
 * @param {string} [message] - Optional failure message
 * @example
 * assertAll(calls.sendMessage, (call, i) => {
 *   assert.ok(call.text.length <= 4096, `chunk ${i} exceeds limit`)
 * })
 */
export function assertAll(items, predicate, message) {
  items.forEach((item, index) => {
    try {
      predicate(item, index)
    } catch (err) {
      const msg = message ? `${message} (at index ${index})` : `Assertion failed at index ${index}`
      err.message = `${msg}: ${err.message}`
      throw err
    }
  })
}

/**
 * Assert call count for a recorded method
 * Just a semantic wrapper, but clarifies intent
 * @param {any[]} callArray - The calls array from a fake (e.g., fake.calls.sendMessage)
 * @param {number} expected
 * @param {string} [message]
 * @example
 * assertCallCount(fake.calls.sendMessage, 3, 'should send to 3 targets')
 */
export function assertCallCount(callArray, expected, message) {
  const msg = message || `Expected ${expected} calls, got ${callArray.length}`
  assert.strictEqual(callArray.length, expected, msg)
}

/**
 * Assert a property exists on all calls in array
 * @param {any[]} callArray
 * @param {string} property
 * @param {any} expectedValue
 * @param {string} [message]
 * @example
 * assertAllCallsHave(calls.sendMessage, 'options.parse_mode', 'HTML')
 */
export function assertAllCallsHave(callArray, property, expectedValue, message) {
  assertAll(
    callArray,
    (call, i) => {
      const keys = property.split('.')
      let value = call
      for (const key of keys) {
        value = value?.[key]
      }
      const msg = message || `call[${i}].${property} should be ${expectedValue}`
      assert.strictEqual(value, expectedValue, msg)
    },
    message
  )
}
