# Architecture (Event-Driven)

### Structure

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

**Total: 6 files, ~665 lines** (includes utilities, resilience features)

### Data Flow

```
┌──────────────┐        ┌──────────────┐        ┌──────────────┐
│   listener   │ ──────→│    filter    │──────→ │    sender    │
│   (GramJS)   │  msg   │ (transform)  │ data   │  (Telegraf)  │
└──────────────┘        └──────────────┘        └──────────────┘
     EventEmitter            Pure function          Bot API
```

### Key Components

**[src/utils/retry.js](../src/utils/retry.js)** - Retry Utility
- Reusable exponential backoff with jitter
- Handles Telegram rate limits (FLOOD_WAIT)
- 4 max retries, capped at 60s delay

**[src/index.js](../src/index.js)** - Orchestrator
- Initializes listener and sender
- Wires up event pipeline
- Handles graceful shutdown with `SIGINT`/`SIGTERM`

**[src/config.js](../src/config.js)** - Configuration + Logger
- Validates required environment variables
- Exports frozen `config` object
- Exports pino logger with caller info and pretty printing

**[src/bot/listener.js](../src/bot/listener.js)** - GramJS Wrapper
- Returns EventEmitter that emits `'message'` events
- Resolves multiple source channels and tags each event with its origin
- Handles session management (`.telegram-session` file)
- Disconnect handler: exits on connection loss (PM2 restarts)
- Connection health check every 30 seconds
- Provides `downloadMedia(msg, maxBytes)` method
- Provides `stop()` for graceful shutdown

**[src/bot/sender.js](../src/bot/sender.js)** - Telegraf Wrapper
- Returns object with `send({ text, media, mediaType, sourceId })` method
- Uses retry utility for rate-limit handling
- Handles media upload caching (first upload, then reuse file_id)
- Handles text chunking for Telegram limits
- Provides `stop(signal)` for graceful shutdown

**[src/bot/middleware/filter.js](../src/bot/middleware/filter.js)** - Pure Filtering
- Pure function: `filterMessage(msg, config) → data | null`
- Extracts text, applies regex filter, strips footer, escapes HTML
- Returns null if message should be dropped
- No side effects, easily testable

### Design Patterns

1. **EventEmitter Pattern** - Listener emits events, index.js handles them
2. **Factory Functions** - `createListener()` and `createSender()` return objects
3. **Pure Functions** - `filterMessage()` has no side effects
4. **Graceful Shutdown** - Standard Node.js signal handling pattern
