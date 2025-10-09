# Architecture

Event-driven pipeline with minimal dependencies: **6 files, ~665 lines total**

## Overview

```
┌──────────────┐        ┌──────────────┐        ┌──────────────┐
│   listener   │ ──────→│    filter    │──────→ │    sender    │
│   (GramJS)   │  msg   │ (transform)  │ data   │  (Telegraf)  │
└──────────────┘        └──────────────┘        └──────────────┘
     EventEmitter            Pure function          Bot API
```

**Data flow:**
1. GramJS listener emits `message` events from source channels
2. Filter transforms/validates messages (pure function)
3. Sender broadcasts to target channels with retry logic

## Project Structure

```
src/
├── index.js                    # Main orchestrator (~70 lines)
├── config.js                   # Config + logger (~115 lines)
├── utils/
│   └── retry.js                # Exponential backoff utility (~70 lines)
└── bot/
    ├── listener.js             # GramJS EventEmitter wrapper (~175 lines)
    ├── sender.js               # Telegraf wrapper (~155 lines)
    └── middleware/
        └── filter.js           # Message filtering logic (~80 lines)
```

## Core Components

### [src/index.js](../src/index.js) - Orchestrator

**Responsibilities:**
- Initialize listener and sender
- Wire up event pipeline
- Deduplication via monotonic message ID tracking
- Graceful shutdown on `SIGINT`/`SIGTERM`

**Deduplication strategy:**
```javascript
// Map of sourceId → lastMessageId
// Drops messages where newId <= lastSeen
const processedMessages = new Map()
```

Leverages Telegram's strictly increasing message IDs. Simple, no timers, no cleanup needed.

**Key code:**
```javascript
listener.on('message', async (msg) => {
  const data = filterMessage(msg, config)
  if (!data) return

  await sender.send(data)
})
```

### [src/config.js](../src/config.js) - Configuration + Logger

**Responsibilities:**
- Validate required environment variables
- Compile regex patterns at startup
- Export frozen `config` object
- Configure Pino logger with caller info

**Key features:**
- Fails fast on missing required vars
- Pretty-prints logs in development
- Redacts sensitive data (tokens, API keys)

**Export:**
```javascript
export const config = Object.freeze({
  apiId: parseInt(process.env.API_ID),
  apiHash: process.env.API_HASH,
  // ... more fields
})

export const logger = pino(/* ... */)
```

### [src/utils/retry.js](../src/utils/retry.js) - Retry Utility

**Responsibilities:**
- Reusable exponential backoff with jitter
- Handles Telegram `FLOOD_WAIT` errors
- Configurable max retries and delay cap

**Algorithm:**
```javascript
delay = min(baseDelay * 2^attempt + jitter, maxDelay)
```

**Parameters:**
- Max retries: 4
- Base delay: 1000ms
- Max delay: 60000ms (60s)
- Jitter: ±20% randomization

**Usage:**
```javascript
await retry(
  async () => await bot.telegram.sendMessage(chatId, text),
  { maxRetries: 4, maxDelay: 60000 }
)
```

### [src/bot/listener.js](../src/bot/listener.js) - GramJS Wrapper

**Responsibilities:**
- EventEmitter that emits `message` events
- Resolves multiple source channels
- Session management (`.telegram-session` file)
- Connection health checks (30s interval)
- Media download utility

**Key behaviors:**
- Exits on disconnect (PM2/systemd handles restart)
- Tags each event with source channel ID
- Supports 2FA password via env or interactive prompt
- SMS code prompt on first run

**Session security:**
```javascript
// Auto-enforces 0600 permissions on .telegram-session
fs.chmodSync(sessionPath, 0o600)
```

**API:**
```javascript
const listener = await createListener(config)

listener.on('message', (msg) => {
  // msg.id, msg.message, msg.media, msg.sourceId
})

const buffer = await listener.downloadMedia(msg, maxBytes)
await listener.stop()
```

### [src/bot/sender.js](../src/bot/sender.js) - Telegraf Wrapper

**Responsibilities:**
- Broadcast messages to multiple targets
- Media upload with `file_id` caching
- Text chunking for Telegram limits
- Retry logic with exponential backoff

**Key features:**
- **Upload once, reuse file_id:** First upload returns `file_id`, subsequent sends reuse it
- **Smart chunking:** Splits at word boundaries, force-breaks long tokens (URLs, base64)
- **Per-target retry:** Independent retry logic for each target (4 max retries)

**Telegram limits:**
- Caption: 1024 characters
- Message: 4096 characters

**API:**
```javascript
const sender = await createSender(config)

await sender.send({
  text: 'Message content',
  media: Buffer.from(...),
  mediaType: 'photo',
  sourceId: -1001234567890
})

await sender.stop()
```

**Chunking example:**
```javascript
// Long message (5000 chars) → split into chunks
// "This is a very long message..." (4096 chars)
// "...continuation" (904 chars)
```

### [src/bot/middleware/filter.js](../src/bot/middleware/filter.js) - Pure Filtering

**Responsibilities:**
- Extract text from message
- Apply regex filter (include pattern)
- Strip content (remove pattern)
- Escape HTML entities
- Validate media type/size

**Pure function signature:**
```javascript
function filterMessage(msg, config) {
  // Returns: { text, media, mediaType, sourceId } | null
}
```

**Filter logic:**
1. Drop if no text/caption
2. Drop if `FILTER_REGEX` doesn't match
3. Apply `STRIP_REGEX` to remove patterns
4. Drop if empty after stripping
5. Drop if media type unsupported
6. Drop if media exceeds size limit
7. Escape HTML entities (`<`, `>`, `&`)

**No side effects:** Easy to test, no I/O, no state mutations.

## Design Patterns

### 1. EventEmitter Pattern
Listener emits events, orchestrator handles them. Decouples message receipt from processing.

```javascript
listener.on('message', async (msg) => {
  // Handle message
})
```

### 2. Factory Functions
`createListener()` and `createSender()` return objects with methods. Encapsulates initialization.

```javascript
const listener = await createListener(config)
const sender = await createSender(config)
```

### 3. Pure Functions
`filterMessage()` has no side effects. Given same input, always returns same output.

```javascript
const data = filterMessage(msg, config) // Deterministic
```

### 4. Graceful Shutdown
Standard Node.js signal handling for cleanup.

```javascript
process.on('SIGTERM', async () => {
  await listener.stop()
  await sender.stop()
  process.exit(0)
})
```

### 5. Dependency Injection
Config passed to all components. Easy to test with mock configs.

```javascript
const listener = await createListener(mockConfig)
```

## Data Models

### Message (from listener)
```javascript
{
  id: 12345,              // Telegram message ID (integer)
  message: 'Text...',     // Message text or caption
  media: MediaObject,     // GramJS media object (optional)
  sourceId: -1001234567890 // Source channel ID
}
```

### Filtered Data (from filter)
```javascript
{
  text: 'Filtered text', // Processed, escaped text
  media: Buffer,         // Media buffer (optional)
  mediaType: 'photo',    // 'photo'|'document'|'video'|'audio'|'voice'
  sourceId: -1001234567890 // Source channel ID
}
```

### Config Object
```javascript
{
  apiId: 12345678,
  apiHash: 'abc...',
  phoneNumber: '+1234567890',
  botToken: '123:ABC...',
  sourceChannels: ['@channel1', '@channel2'],
  targetChatIds: [-1001234567890, -1009876543210],
  filterRegex: /tech|news/i,
  stripRegex: /Powered by.*/gi,
  supportedMediaTypes: ['photo', 'document'],
  maxMediaBytes: 10485760,
  logLevel: 'info'
}
```

## Error Handling

### Startup Errors
Fail fast on configuration issues:
- Missing required env vars
- Invalid regex patterns
- Authentication failures

### Runtime Errors
Continue processing on recoverable errors:
- Rate limits (retry with backoff)
- Individual target failures (log and continue)
- Media download failures (skip media, send text)

### Connection Errors
Exit on disconnect (process manager restarts):
- GramJS disconnection
- Unrecoverable network errors
- Session expiration

## Performance Characteristics

### Memory Usage
- **Minimal state:** Only tracks last message ID per source (~10 bytes per channel)
- **No caching:** Beyond file_id reuse during single send operation
- **Streaming media:** Downloads to Buffer, immediately sent/discarded

### Throughput
- **Single-threaded:** Node.js event loop
- **Concurrent sends:** All targets receive messages in parallel
- **Rate limiting:** Exponential backoff prevents overwhelming API

### Latency
- **Typical:** <1s from source to targets
- **Rate-limited:** Up to 60s delay during backoff
- **Media:** +2-5s for download/upload

## Deployment Considerations

### Process Management
Requires external process manager:
- **PM2:** Recommended for development/small deployments
- **systemd:** Recommended for production Linux servers
- **Docker:** Requires pre-generated session file

See [operations.md](operations.md) for deployment guides.

### Scaling
Single-instance design:
- **Vertical scaling:** Increase resources for high-volume channels
- **Horizontal scaling:** Not supported (session conflicts)

For multiple independent pipelines, run separate instances with different configs.

### Monitoring
Key metrics to track:
- Message processing rate
- Drop rate (filtered messages)
- Retry rate (rate limit hits)
- Error rate per target
- Connection uptime

See [operations.md](operations.md) for monitoring setup.

## Testing Strategy

### Unit Tests
Pure functions and isolated components:
- Filter logic (regex matching, HTML escaping)
- Chunking algorithm
- Retry utility

### Integration Tests
Component interactions:
- Listener → Filter → Sender pipeline
- Media download and upload flow

### Contract Tests
External API compliance:
- GramJS message format
- Telegraf API compatibility

See [testing.md](testing.md) for detailed testing guide.

## Dependencies

### Production
- **telegram** (GramJS) - User client for listening
- **telegraf** - Bot client for sending
- **pino** - Structured logging
- **pino-caller** - Call-site information
- **pino-pretty** - Pretty-print development logs
- **dotenv** - Environment variable loading

### Development
- **jest** - Test runner and assertion library
- **eslint** - Code linting
- **prettier** - Code formatting

**Philosophy:** Prefer Node.js built-ins over npm packages. Keep it minimal.

## Future Enhancements

**Potential improvements:**
- Auto-reconnect with exponential backoff
- Album/grouped media support
- Voice messages by default
- Webhook-based sending (vs polling)
- Metrics export (Prometheus/StatsD)

See [IMPROVEMENTS.md](../IMPROVEMENTS.md) for detailed proposals.

---

**Last updated:** 2025-10-09
