# Testing Guide

Comprehensive testing approach for the Telegram message replicator.

## Table of Contents

- [Testing Philosophy](#testing-philosophy)
- [Test Setup](#test-setup)
- [Unit Tests](#unit-tests)
- [Integration Tests](#integration-tests)
- [Contract Tests](#contract-tests)
- [Test Organization](#test-organization)
- [Best Practices](#best-practices)
- [Coverage Goals](#coverage-goals)
- [Continuous Testing](#continuous-testing)

## Testing Philosophy

**Core principles:**
1. **Tests should be fast** - Unit tests run in <100ms
2. **Tests should be isolated** - No shared state between tests
3. **Tests should be reliable** - No flaky tests, deterministic outcomes
4. **Prefer real data over mocks** - Use actual message objects when possible
5. **Test behavior, not implementation** - Focus on public APIs

**Test pyramid:**
```
       /\
      /  \       E2E (Manual)
     /----\      Integration Tests (~20%)
    /------\     Unit Tests (~80%)
   /--------\
```

## Test Setup

### Install Dependencies

```bash
npm install
```

### Run Tests

```bash
# All tests
npm test

# Watch mode (TDD)
npm test -- --watch

# With coverage
npm run test:coverage

# Specific test file
npm test -- --test-name-pattern="filter"

# Integration tests (requires real Telegram setup)
npm run test:integration
```

### Test Environment

**Environment variables:**
```env
NODE_ENV=test
LOG_LEVEL=error  # Suppress logs during tests
```

**Jest configuration** (`jest.config.js`):
```javascript
export default {
  testEnvironment: 'node',
  transform: {
    '^.+\\.js$': 'babel-jest'
  },
  testMatch: ['**/tests/**/*.test.js'],
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/index.js'  // Integration test only
  ],
  coverageThresholds: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80
    }
  }
}
```

## Unit Tests

### Filter Tests

**Location:** `tests/unit/bot/middleware/filter.test.js`

**Coverage:**
- Text filtering (regex match/no match)
- Content stripping (footer removal)
- HTML escaping (`<`, `>`, `&`)
- Media type validation
- Media size validation
- Empty content handling
- Edge cases (null, undefined, empty strings)

**Example:**
```javascript
import { describe, it } from '@jest/globals'
import assert from 'node:assert/strict'
import { filterMessage } from '../../../../src/bot/middleware/filter.js'

describe('filterMessage', () => {
  const mockConfig = {
    filterRegex: /tech|news/i,
    stripRegex: /Powered by.*/gi,
    supportedMediaTypes: ['photo', 'document'],
    maxMediaBytes: 1024 * 1024
  }

  it('should pass message matching filter', () => {
    const msg = {
      id: 123,
      message: 'Latest tech news',
      sourceId: -1001234567890
    }

    const result = filterMessage(msg, mockConfig)

    assert.ok(result)
    assert.strictEqual(result.text, 'Latest tech news')
    assert.strictEqual(result.sourceId, -1001234567890)
  })

  it('should drop message not matching filter', () => {
    const msg = {
      id: 123,
      message: 'Random spam',
      sourceId: -1001234567890
    }

    const result = filterMessage(msg, mockConfig)

    assert.strictEqual(result, null)
  })

  it('should strip footer text', () => {
    const msg = {
      id: 123,
      message: 'Tech news\nPowered by Example',
      sourceId: -1001234567890
    }

    const result = filterMessage(msg, mockConfig)

    assert.ok(result)
    assert.strictEqual(result.text, 'Tech news')
  })

  it('should escape HTML entities', () => {
    const msg = {
      id: 123,
      message: 'Tech <script>alert("xss")</script> & more',
      sourceId: -1001234567890
    }

    const result = filterMessage(msg, mockConfig)

    assert.ok(result)
    assert.strictEqual(
      result.text,
      'Tech &lt;script&gt;alert("xss")&lt;/script&gt; &amp; more'
    )
  })

  it('should validate media type', () => {
    const msg = {
      id: 123,
      message: 'Tech news',
      media: { _: 'messageMediaPhoto' },
      sourceId: -1001234567890
    }

    const result = filterMessage(msg, mockConfig)

    assert.ok(result)
    assert.strictEqual(result.mediaType, 'photo')
  })

  it('should drop unsupported media type', () => {
    const msg = {
      id: 123,
      message: 'Tech news',
      media: { _: 'messageMediaSticker' },
      sourceId: -1001234567890
    }

    const result = filterMessage(msg, mockConfig)

    assert.strictEqual(result, null)
  })
})
```

### Chunking Tests

**Location:** `tests/unit/bot/sender-chunks.test.js`

**Coverage:**
- Message chunking at word boundaries
- Long token handling (URLs, base64)
- Caption vs message limits (1024 vs 4096 chars)
- Empty content handling
- Single word exceeding limit

**Example:**
```javascript
import { describe, it } from '@jest/globals'
import assert from 'node:assert/strict'
import { chunkText } from '../../../src/bot/sender.js'

describe('chunkText', () => {
  it('should not chunk short text', () => {
    const text = 'Short message'
    const chunks = chunkText(text, 4096)

    assert.strictEqual(chunks.length, 1)
    assert.strictEqual(chunks[0], 'Short message')
  })

  it('should chunk at word boundaries', () => {
    const text = 'a '.repeat(3000)  // 6000 chars
    const chunks = chunkText(text, 4096)

    assert.strictEqual(chunks.length, 2)
    assert.ok(chunks[0].length <= 4096)
    assert.ok(chunks[1].length <= 4096)
    assert.strictEqual(chunks.join(''), text)
  })

  it('should force-break long tokens', () => {
    const longUrl = 'https://example.com/' + 'a'.repeat(5000)
    const chunks = chunkText(longUrl, 4096)

    assert.ok(chunks.length > 1)
    chunks.forEach(chunk => assert.ok(chunk.length <= 4096))
  })

  it('should respect caption limit', () => {
    const text = 'a '.repeat(600)  // 1200 chars
    const chunks = chunkText(text, 1024)

    assert.strictEqual(chunks.length, 2)
    assert.ok(chunks[0].length <= 1024)
    assert.ok(chunks[1].length <= 1024)
  })
})
```

### Retry Utility Tests

**Location:** `tests/unit/utils/retry.test.js`

**Coverage:**
- Successful retry after failures
- Exponential backoff timing
- Max retries exceeded
- Immediate success (no retry needed)
- Non-retryable errors

**Example:**
```javascript
import { describe, it, beforeEach } from '@jest/globals'
import assert from 'node:assert/strict'
import { retry } from '../../../src/utils/retry.js'

describe('retry', () => {
  it('should succeed on first attempt', async () => {
    let attempts = 0
    const fn = async () => {
      attempts++
      return 'success'
    }

    const result = await retry(fn, { maxRetries: 3 })

    assert.strictEqual(result, 'success')
    assert.strictEqual(attempts, 1)
  })

  it('should retry on failure and succeed', async () => {
    let attempts = 0
    const fn = async () => {
      attempts++
      if (attempts < 3) throw new Error('FLOOD_WAIT_5')
      return 'success'
    }

    const result = await retry(fn, { maxRetries: 4, maxDelay: 100 })

    assert.strictEqual(result, 'success')
    assert.strictEqual(attempts, 3)
  })

  it('should throw after max retries', async () => {
    const fn = async () => {
      throw new Error('FLOOD_WAIT_5')
    }

    await assert.rejects(
      async () => await retry(fn, { maxRetries: 2, maxDelay: 10 }),
      /FLOOD_WAIT_5/
    )
  })

  it('should not retry non-retryable errors', async () => {
    let attempts = 0
    const fn = async () => {
      attempts++
      throw new Error('AUTH_KEY_UNREGISTERED')
    }

    await assert.rejects(
      async () => await retry(fn, { maxRetries: 3 }),
      /AUTH_KEY_UNREGISTERED/
    )

    assert.strictEqual(attempts, 1)  // No retries
  })
})
```

## Integration Tests

### Listener → Filter → Sender Pipeline

**Location:** `tests/integration/pipeline.test.js`

**Setup:**
- Mock GramJS client
- Mock Telegraf bot
- Real filter logic
- Real orchestration

**Example:**
```javascript
import { describe, it, beforeEach, afterEach } from '@jest/globals'
import assert from 'node:assert/strict'
import EventEmitter from 'events'
import { createMockListener, createMockSender } from '../helpers/test-fakes.js'

describe('Message Pipeline Integration', () => {
  let listener, sender, messages

  beforeEach(() => {
    listener = createMockListener()
    sender = createMockSender()
    messages = []

    sender.on('send', (data) => messages.push(data))
  })

  afterEach(async () => {
    await listener.stop()
    await sender.stop()
  })

  it('should process message through pipeline', async () => {
    const msg = {
      id: 123,
      message: 'Tech news update',
      sourceId: -1001234567890
    }

    listener.emit('message', msg)

    // Wait for async processing
    await new Promise(resolve => setTimeout(resolve, 100))

    assert.strictEqual(messages.length, 1)
    assert.strictEqual(messages[0].text, 'Tech news update')
  })

  it('should filter out non-matching messages', async () => {
    const msg = {
      id: 123,
      message: 'Random spam',
      sourceId: -1001234567890
    }

    listener.emit('message', msg)

    await new Promise(resolve => setTimeout(resolve, 100))

    assert.strictEqual(messages.length, 0)
  })

  it('should handle media messages', async () => {
    const msg = {
      id: 123,
      message: 'Tech news',
      media: { _: 'messageMediaPhoto' },
      sourceId: -1001234567890
    }

    listener.emit('message', msg)

    await new Promise(resolve => setTimeout(resolve, 100))

    assert.strictEqual(messages.length, 1)
    assert.ok(messages[0].media)
    assert.strictEqual(messages[0].mediaType, 'photo')
  })
})
```

### Sender Integration Tests

**Location:** `tests/integration/bot/sender.integration.test.js`

**Requires:** Real Telegram bot credentials (set `RUN_TELEGRAM_INTEGRATION=1`)

**Coverage:**
- Real API calls to Telegram
- Rate limiting behavior
- Media upload and caching
- Error handling

**Example:**
```javascript
import { describe, it, beforeAll, afterAll } from '@jest/globals'
import assert from 'node:assert/strict'
import { createSender } from '../../../src/bot/sender.js'
import { config } from '../../../src/config.js'

describe('Sender Integration (Telegram API)', () => {
  if (!process.env.RUN_TELEGRAM_INTEGRATION) {
    console.log('Skipping Telegram integration tests (set RUN_TELEGRAM_INTEGRATION=1)')
    return
  }

  let sender

  beforeAll(async () => {
    sender = await createSender(config)
  })

  afterAll(async () => {
    await sender.stop()
  })

  it('should send text message to target', async () => {
    await sender.send({
      text: 'Integration test message',
      sourceId: -1001234567890
    })

    // Should not throw
  })

  it('should handle rate limiting gracefully', async () => {
    // Send many messages rapidly
    const promises = []
    for (let i = 0; i < 30; i++) {
      promises.push(sender.send({
        text: `Rate limit test ${i}`,
        sourceId: -1001234567890
      }))
    }

    await Promise.all(promises)

    // Should complete without throwing (with retries)
  })
})
```

## Contract Tests

### GramJS Message Format

**Location:** `tests/contract/gramjs-message.test.js`

**Purpose:** Verify assumptions about GramJS message structure

**Example:**
```javascript
import { describe, it } from '@jest/globals'
import assert from 'node:assert/strict'

describe('GramJS Message Contract', () => {
  it('should have expected message structure', () => {
    const msg = {
      id: 12345,
      message: 'Text content',
      media: { _: 'messageMediaPhoto' },
      fromId: { userId: 67890 },
      peerId: { channelId: 1234567890 },
      date: 1696849425
    }

    assert.ok(typeof msg.id === 'number')
    assert.ok(typeof msg.message === 'string')
    assert.ok(msg.media._)
    assert.ok(msg.peerId.channelId)
  })

  it('should handle different media types', () => {
    const mediaTypes = [
      'messageMediaPhoto',
      'messageMediaDocument',
      'messageMediaVideo',
      'messageMediaAudio',
      'messageMediaVoice'
    ]

    mediaTypes.forEach(type => {
      const msg = { id: 1, media: { _: type } }
      assert.strictEqual(msg.media._, type)
    })
  })

  it('should have monotonic message IDs', () => {
    const ids = [100, 101, 102, 103, 104]

    for (let i = 1; i < ids.length; i++) {
      assert.ok(ids[i] > ids[i - 1], 'IDs should be strictly increasing')
    }
  })
})
```

### Telegraf API Contract

**Location:** `tests/contract/telegraf-api.test.js`

**Purpose:** Verify assumptions about Telegraf bot API

**Example:**
```javascript
import { describe, it } from '@jest/globals'
import assert from 'node:assert/strict'
import { Telegraf } from 'telegraf'

describe('Telegraf API Contract', () => {
  it('should accept message with text only', async () => {
    const bot = new Telegraf('fake-token')

    // Should not throw during construction
    assert.ok(bot.telegram)
    assert.ok(typeof bot.telegram.sendMessage === 'function')
  })

  it('should accept media with caption', () => {
    const bot = new Telegraf('fake-token')

    // API signature verification
    assert.ok(typeof bot.telegram.sendPhoto === 'function')
    assert.ok(typeof bot.telegram.sendDocument === 'function')
    assert.ok(typeof bot.telegram.sendVideo === 'function')
    assert.ok(typeof bot.telegram.sendAudio === 'function')
  })

  it('should support file_id reuse', () => {
    // Verify file_id is string type
    const fileId = '123ABC'
    assert.ok(typeof fileId === 'string')
  })
})
```

## Test Organization

### Directory Structure

```
tests/
├── unit/                          # Unit tests
│   ├── bot/
│   │   ├── middleware/
│   │   │   └── filter.test.js     # Filter logic
│   │   └── sender-chunks.test.js  # Chunking logic
│   └── utils/
│       └── retry.test.js          # Retry utility
├── integration/                   # Component integration
│   ├── pipeline.test.js           # Full pipeline
│   └── bot/
│       └── sender.integration.test.js  # Real API tests
├── contract/                      # External API contracts
│   ├── gramjs-message.test.js
│   └── telegraf-api.test.js
└── helpers/                       # Test utilities
    ├── test-fakes.js              # Mock factories
    └── assertions.js              # Custom assertions
```

### Test Helpers

**Location:** `tests/helpers/test-fakes.js`

**Purpose:** Reusable mock objects

**Example:**
```javascript
import EventEmitter from 'events'

export function createMockListener() {
  const emitter = new EventEmitter()

  return {
    on: (event, handler) => emitter.on(event, handler),
    emit: (event, data) => emitter.emit(event, data),
    downloadMedia: async (msg, maxBytes) => Buffer.from('fake-media'),
    stop: async () => {}
  }
}

export function createMockSender() {
  const emitter = new EventEmitter()
  const sent = []

  return {
    send: async (data) => {
      sent.push(data)
      emitter.emit('send', data)
    },
    getSent: () => sent,
    on: (event, handler) => emitter.on(event, handler),
    stop: async () => {}
  }
}

export function createMockMessage(overrides = {}) {
  return {
    id: 12345,
    message: 'Default message',
    media: null,
    sourceId: -1001234567890,
    ...overrides
  }
}

export function createMockConfig(overrides = {}) {
  return {
    filterRegex: /tech|news/i,
    stripRegex: /Powered by.*/gi,
    supportedMediaTypes: ['photo', 'document'],
    maxMediaBytes: 10485760,
    targetChatIds: [-1001234567890],
    ...overrides
  }
}
```

**Location:** `tests/helpers/assertions.js`

**Purpose:** Custom assertion helpers

**Example:**
```javascript
import assert from 'node:assert/strict'

export function assertMessageFiltered(result, expected) {
  assert.ok(result, 'Message should not be filtered out')
  assert.strictEqual(result.text, expected.text)
  assert.strictEqual(result.sourceId, expected.sourceId)
}

export function assertMessageDropped(result) {
  assert.strictEqual(result, null, 'Message should be dropped')
}

export function assertValidChunks(chunks, maxLength) {
  assert.ok(Array.isArray(chunks), 'Should return array')
  assert.ok(chunks.length > 0, 'Should have at least one chunk')

  chunks.forEach((chunk, i) => {
    assert.ok(typeof chunk === 'string', `Chunk ${i} should be string`)
    assert.ok(chunk.length <= maxLength, `Chunk ${i} exceeds ${maxLength} chars`)
  })
}
```

## Best Practices

### Writing Good Tests

**1. Arrange-Act-Assert pattern:**
```javascript
it('should filter message', () => {
  // Arrange - set up test data
  const msg = createMockMessage({ message: 'Tech news' })
  const config = createMockConfig()

  // Act - execute function
  const result = filterMessage(msg, config)

  // Assert - verify outcome
  assert.ok(result)
  assert.strictEqual(result.text, 'Tech news')
})
```

**2. Descriptive test names:**
```javascript
// Good
it('should drop message when filter regex does not match')
it('should escape HTML entities in message text')
it('should retry up to 4 times on FLOOD_WAIT error')

// Bad
it('should work')
it('test filter')
it('checks media')
```

**3. Test one thing at a time:**
```javascript
// Good - focused test
it('should escape less-than symbol', () => {
  const result = filterMessage({ message: '<test>' }, config)
  assert.ok(result.text.includes('&lt;'))
})

// Bad - testing multiple things
it('should filter and escape', () => {
  // Tests both filtering AND escaping
})
```

**4. Avoid test interdependence:**
```javascript
// Good - isolated
let msg
beforeEach(() => {
  msg = createMockMessage()
})

// Bad - shared state
const msg = createMockMessage()  // Reused across tests
```

### Common Patterns

**Testing async functions:**
```javascript
it('should handle async operation', async () => {
  const result = await asyncFunction()
  assert.ok(result)
})
```

**Testing errors:**
```javascript
it('should throw on invalid input', async () => {
  await assert.rejects(
    async () => await functionThatThrows(),
    /Expected error message/
  )
})
```

**Testing events:**
```javascript
it('should emit event', (done) => {
  emitter.on('message', (data) => {
    assert.strictEqual(data.text, 'expected')
    done()
  })

  emitter.emit('message', { text: 'expected' })
})
```

**Testing with timeouts:**
```javascript
it('should complete within timeout', async () => {
  const promise = longRunningFunction()
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Timeout')), 1000)
  )

  await Promise.race([promise, timeout])
})
```

## Coverage Goals

### Target Metrics

- **Lines:** 80%+
- **Branches:** 80%+
- **Functions:** 80%+
- **Statements:** 80%+

### Check Coverage

```bash
# Generate coverage report
npm run test:coverage

# View HTML report
open coverage/lcov-report/index.html
```

### Coverage Exceptions

**Acceptable gaps:**
- `src/index.js` - Integration test coverage only
- Error handling branches for rare cases
- Defensive null checks

**Should be covered:**
- All public APIs
- Filter logic
- Chunking algorithm
- Retry logic
- Configuration validation

## Continuous Testing

### Pre-commit Hook

**Install husky:**
```bash
npm install --save-dev husky
npx husky install
npx husky add .git/hooks/pre-commit "npm test && npm run lint"
```

### CI/CD Integration

**GitHub Actions** (`.github/workflows/ci.yml`):
```yaml
name: CI

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'

      - name: Install dependencies
        run: npm ci

      - name: Run tests
        run: npm test

      - name: Run linter
        run: npm run lint

      - name: Check coverage
        run: npm run test:coverage

      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./coverage/lcov.info
```

### Watch Mode (TDD)

```bash
# Auto-run tests on file changes
npm test -- --watch

# Watch specific files
npm test -- --watch --test-name-pattern="filter"
```

### Performance Testing

**Benchmark critical paths:**
```javascript
import { performance } from 'perf_hooks'

it('should filter 1000 messages in <100ms', () => {
  const messages = Array.from({ length: 1000 }, (_, i) =>
    createMockMessage({ id: i, message: 'Tech news' })
  )

  const start = performance.now()

  messages.forEach(msg => filterMessage(msg, config))

  const duration = performance.now() - start

  assert.ok(duration < 100, `Took ${duration}ms, expected <100ms`)
})
```

## Debugging Tests

**Run with Node debugger:**
```bash
node --inspect-brk node_modules/.bin/jest --runInBand
```

**Add debug logs:**
```javascript
it('should do something', () => {
  const result = functionUnderTest()
  console.log('DEBUG:', JSON.stringify(result, null, 2))
  assert.ok(result)
})
```

**Isolate failing test:**
```javascript
it.only('should focus on this test', () => {
  // Only this test runs
})
```

---

**Last updated:** 2025-10-09
