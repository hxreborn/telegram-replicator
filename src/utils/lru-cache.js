const DEFAULT_MAX_SIZE = 1000
const DEFAULT_TTL_MS = 60 * 60 * 1000

export class LRUCache {
  /**
   * @param {Object} options Configuration options
   * @param {number} options.maxSize Maximum number of entries (default: 1000)
   * @param {number} options.ttl Time-to-live in milliseconds (default: 3600000 = 1 hour)
   */
  constructor({ maxSize = DEFAULT_MAX_SIZE, ttl = DEFAULT_TTL_MS } = {}) {
    this.maxSize = maxSize
    this.ttl = ttl
    this.cache = new Map()
  }

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

  get size() {
    return this.cache.size
  }

  clear() {
    this.cache.clear()
  }
}
