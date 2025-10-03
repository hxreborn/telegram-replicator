/**
 * Simple LRU (Least Recently Used) cache with TTL support.
 * No external dependencies - uses built-in Map for O(1) operations.
 *
 * @template T
 */
export class LRUCache {
  /**
   * @param {Object} options Configuration options
   * @param {number} options.maxSize Maximum number of entries (default: 1000)
   * @param {number} options.ttl Time-to-live in milliseconds (default: 3600000 = 1 hour)
   */
  constructor({ maxSize = 1000, ttl = 60 * 60 * 1000 } = {}) {
    this.maxSize = maxSize
    this.ttl = ttl
    this.cache = new Map()
  }

  /**
   * Adds an item to the cache
   * @param {string|number} key Cache key
   * @param {T} value Value to store
   */
  set(key, value) {
    if (this.cache.has(key)) {
      this.cache.delete(key)
    }

    this.cache.set(key, {
      value,
      timestamp: Date.now()
    })

    if (this.cache.size > this.maxSize) {
      const firstKey = this.cache.keys().next().value
      this.cache.delete(firstKey)
    }
  }

  /**
   * Checks if a key exists in the cache (and hasn't expired)
   * @param {string|number} key Cache key
   * @returns {boolean}
   */
  has(key) {
    const entry = this.cache.get(key)
    if (!entry) return false

    const age = Date.now() - entry.timestamp
    if (age > this.ttl) {
      this.cache.delete(key)
      return false
    }

    return true
  }

  /**
   * Gets a value from the cache
   * @param {string|number} key Cache key
   * @returns {T|undefined}
   */
  get(key) {
    const entry = this.cache.get(key)
    if (!entry) return undefined

    const age = Date.now() - entry.timestamp
    if (age > this.ttl) {
      this.cache.delete(key)
      return undefined
    }

    this.cache.delete(key)
    this.cache.set(key, entry)

    return entry.value
  }

  /**
   * Removes expired entries from the cache
   * @returns {Object} Cleanup statistics
   */
  cleanup() {
    const now = Date.now()
    let cleanedUp = 0

    for (const [key, entry] of this.cache.entries()) {
      const age = now - entry.timestamp
      if (age > this.ttl) {
        this.cache.delete(key)
        cleanedUp++
      }
    }

    return {
      size: this.cache.size,
      cleanedUp
    }
  }

  /**
   * Current cache size
   * @returns {number}
   */
  get size() {
    return this.cache.size
  }

  /**
   * Clears all entries
   */
  clear() {
    this.cache.clear()
  }
}
