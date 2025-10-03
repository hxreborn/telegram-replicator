# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- **Start**: `npm start` - Runs the replicator daemon
- **Test**: `npm test` - Runs all tests using Node.js built-in test runner
- **Test (watch)**: `npm test -- --watch` - Run tests in watch mode during development
- **Lint**: `npm run lint` - Checks code style with ESLint 9 (must pass before commits)
- **Format**: `npm run format` - Formats all code with Prettier
- **Format check**: `npm run format:check` - Check if code is formatted without modifying files

## Architecture

### Message Pipeline

The replicator follows an event-driven architecture with three main stages:

```
GramJS Listener → Filter/Transform → Telegraf Sender
```

1. **Listener** (`src/bot/listener.js`): GramJS user client that connects to Telegram and emits `'message'` events from the source channel
2. **Filter** (`src/bot/middleware/filter.js`): Pure function that applies regex filtering, stripping, and HTML escaping
3. **Sender** (`src/bot/sender.js`): Telegraf bot that broadcasts filtered messages to multiple targets with chunking and rate-limit handling

The main orchestration is in `src/index.js`, which wires up the pipeline with message deduplication:

```javascript
listener.on('message', async (msg) => {
  // Check for duplicate messages (1-hour TTL cache)
  if (isMessageProcessed(msg.id)) return;

  const filtered = filterMessage(msg, config);
  if (!filtered) return;
  const mediaBuffer = await listener.downloadMedia(msg);
  await sender.send({ text, media, mediaType });
});
```

**Message Deduplication** (`src/index.js`):
- Uses LRU cache (`src/utils/lru-cache.js`) for processed message IDs
- 1-hour TTL with automatic cleanup and size limit (1000 entries)
- Prevents duplicate processing of the same message
- Logs duplicate count for monitoring

### Key Components

**Utilities** (`src/utils/`):
- `retry.js`: Reusable exponential backoff retry logic with jitter for rate-limit handling
- `lru-cache.js`: Simple LRU cache with TTL support for message deduplication (no external dependencies)

**Configuration** (`src/config.js`):
- Validates environment variables at startup
- Compiles regex patterns once (FILTER_REGEX, STRIP_REGEX)
- Exports frozen config object and logger (pino with caller info)
- Use `maskChatId()` utility to safely log chat IDs

**Message Filtering** (`src/bot/middleware/filter.js`):
- Pure function: no side effects, returns null if message should be dropped
- Drop reasons: no text, regex mismatch, empty after strip, unsupported media type, size exceeded
- Returns `{ text, mediaType, sourceId }` for valid messages

**Media Handling**:
- Listener downloads media into Buffer using `listener.downloadMedia(msg, maxBytes)`
- Sender uploads media once to first target, then reuses `file_id` for remaining targets (Telegram optimization)
- Supports photos, documents, videos, and audio (configurable via SUPPORTED_MEDIA_TYPES)
- Media type detection uses GramJS flags (`media.video`, `media.voice`) and document attributes (`documentAttributeAudio`)
- Voice messages detected separately (can be enabled by adding 'voice' to SUPPORTED_MEDIA_TYPES)
- Photos use `messageMediaPhoto`, everything else uses `messageMediaDocument` with type detection

**Text Chunking** (`src/bot/sender.js:splitIntoChunks`):
- Telegram limits: captions 1024 chars, messages 4096 chars
- Splits text at word boundaries, falls back to force-break for long URLs/base64
- If media is present: first 1024 chars as caption, rest as separate messages

**Rate Limiting** (`src/bot/sender.js` + `src/utils/retry.js`):
- Catches `FLOOD_WAIT` errors (HTTP 429 or `retry_after` parameter)
- Uses reusable retry utility with exponential backoff + jitter
- Up to 4 attempts per target, capped at 60s per wait
- Uses Telegram's `retry_after` parameter when available
- Continues to other targets even if one fails after all retries

**Session Management & Resilience**:
- GramJS session persists in `.telegram-session` (plaintext, chmod 600)
- First run prompts for SMS code (and 2FA if enabled)
- Subsequent runs restore session without re-authentication
- **Disconnect handler**: Exits process on connection loss (PM2 auto-restarts)
- Connection health check every 30 seconds to detect zombie connections

## Known Issues & Quirks

**Telegram API Gotchas**:
- GramJS uses `BigInt` for chat IDs internally, Telegraf uses `Number` - conversion happens in between
- Media downloads can hang on network issues - listener implements size checks before downloading
- `FLOOD_WAIT` errors are normal during high-volume broadcasting - sender handles retry automatically
- Session can expire after ~30 days of inactivity - delete `.telegram-session` to re-authenticate
- Private channels require numeric ID (`-100...`) - username lookup only works for public channels
- Rate limits vary by chat type: groups (20 msg/min), channels (30 msg/sec), supergroups (20 msg/min)

**Message Processing**:
- Supports photos, documents, videos, and audio (configurable via SUPPORTED_MEDIA_TYPES env var)
- Voice messages require explicit 'voice' in SUPPORTED_MEDIA_TYPES (separate from regular audio)
- Stickers and polls not supported (limitation of current implementation)
- Media-only messages (no text/caption) are dropped - filter requires text to match against
- Edits to source messages are ignored - only new messages trigger replication
- Message order is not guaranteed when rate-limited - targets may receive messages in different orders
- Duplicate messages automatically filtered using 1-hour TTL cache

**Environment & Deployment**:
- Exits on disconnect for clean restart (use PM2/systemd for auto-restart)
- Disconnect detection: event handler + 30s health check interval
- Both `.env` and `.telegram-session` contain plaintext credentials - NEVER commit these files
- First run is interactive (SMS code prompt) - not suitable for Docker without pre-generated session
- LOG_LEVEL=debug is very verbose - use info/warn in production

## Development Approach

**For Bug Fixes**:
1. Read the relevant source file(s) first to understand current behavior
2. Check if tests exist - run them to verify the bug
3. Fix the bug with minimal changes
4. Update or add tests to prevent regression
5. Run `npm test` and `npm run lint` before completing

**For New Features**:
1. Research existing code patterns (especially in `src/bot/` for similar functionality)
2. Write test cases first with expected input/output (test-driven development)
3. Implement minimal code to pass tests
4. NEVER use mock implementations - test pure functions directly with real data
5. Verify the feature aligns with the "simple event-driven replicator" philosophy

**For Refactoring**:
1. Ensure test coverage exists for the code being refactored
2. Run tests before and after to verify behavior is unchanged
3. Keep commits focused - one refactoring concept per commit
4. Prefer extracting functions over adding complexity

IMPORTANT: This is a minimal, dependency-light project (~550 lines). When adding features, prefer built-in Node.js APIs over npm packages. Question whether the feature aligns with the project's "simple event-driven replicator" philosophy.

## API Gotchas & Best Practices

**GramJS (Listener)**:
- Always check `msg.media._` type before accessing media properties (can be undefined)
- Use optional chaining for nested properties: `msg.media?.document?.size`
- BigInt comparison requires explicit `BigInt()` conversion: `BigInt(size) > BigInt(maxBytes)`
- Event handlers must check `msg.peerId.channelId` to filter by source channel
- Download media with caution - no built-in size limit, always check first

**Telegraf (Sender)**:
- Bot must be admin in target channels to post messages
- File ID caching only works within same bot instance - don't persist to disk
- HTML parse mode requires escaping: `&` → `&amp;`, `<` → `&lt;`, `>` → `&gt;`
- Caption limit (1024) is strictly enforced - excess text causes API error, not truncation
- `retry_after` parameter is in seconds, setTimeout expects milliseconds

**Pino Logger**:
- Use `logger.debug()` for dropped messages (can be noisy in production)
- Use `logger.info()` for successful sends and connection events
- Use `logger.warn()` for rate limits and recoverable errors
- Use `logger.error()` for failed sends and unrecoverable errors
- Always include `msgId` or `sourceId` in log context for traceability

## Dependencies Philosophy

**Why Each Dependency Exists**:
- `telegram` (GramJS): Only full-featured user client for Node.js - needed to listen to channels as user
- `telegraf`: Most popular Telegram bot framework - handles API quirks and provides clean async/await interface
- `pino`: Fastest structured logger - supports caller info and pretty-printing without performance hit
- `pino-pretty`: Dev-only, pretty console output for logs
- `pino-caller`: Adds file:line to logs automatically
- `dotenv`: Standard env var loader - no alternatives needed

**Dependency Rules**:
- NO web frameworks (Express/Fastify) - this is a daemon, not a server
- NO database libraries - stateless by design
- NO test frameworks - Node.js built-in runner is sufficient
- NO build tools - plain ES modules work natively in Node 18+
- Question any new dependency: Can we use built-in Node.js APIs instead?

### Code Style

- ES modules (`"type": "module"` in package.json)
- No semicolons, single quotes, no trailing commas (enforced by Prettier)
- ESLint 9 flat config (`eslint.config.js`) with `@eslint/js` recommended rules and `eslint-config-prettier`
- Prettier configured with 100 char line width, 2 space tabs, `arrowParens: always`, `endOfLine: lf`
- Minimal JSDoc: only complex exported functions keep type signatures
- No magic numbers: extract to named constants at module level
- No redundant comments: code should be self-documenting

### Testing

**Test Infrastructure**:
- Node.js built-in test runner (no external framework like Jest/Mocha)
- Test files co-located with implementation: `filter.test.js` next to `filter.js`, or in `tests/` directory
- Tests use `import { test } from 'node:test'` and `import assert from 'node:assert/strict'`
- Run with `npm test` or `npm test -- --watch` for continuous testing during development

**Test Coverage**:
- Message filtering: 17 test cases covering drop scenarios, media types, size limits
- Text chunking: Multiple cases including word boundaries, long URLs, and edge cases
- Target coverage: Pure functions with no side effects (filter, chunking, escaping)
- No tests for retry/cache utilities (simple, low-risk code)

**Testing Best Practices**:
- Test pure functions directly with real data - NEVER use mocks or stubs
- Use descriptive test names: `test('drops message when text is empty after strip', ...)`
- Test edge cases: empty strings, very long text, special characters, null/undefined
- For new features, write tests FIRST before implementation (TDD approach)
- Keep tests fast - no network calls, no file I/O, no timers (unless testing timing logic)
- Run `npm test` before every commit - CI should fail if tests fail

**What NOT to Test**:
- External library behavior (GramJS, Telegraf) - trust their tests
- Network/API integration - this is a small project, integration tests are overkill
- Configuration validation - tested implicitly by startup process

### Deployment Notes

- No auto-reconnect on disconnect (use process manager like systemd/pm2)
- Graceful shutdown handlers for SIGINT/SIGTERM
- Pino logging with pretty-printing in development, JSON in production
- All credentials in `.env` (never commit)

## Git Workflow

**Commit Format**: `type(scope): message`
- Common types: `feat`, `fix`, `refactor`, `test`, `chore`, `docs`, `style`, `perf`
- Optional scope examples: `(filter)`, `(sender)`, `(listener)`, `(config)`, `(tooling)`
- Use imperative mood, present tense (e.g., "add feature" not "added feature")
- Keep first line under 72 characters

**Atomic Commits**:
- One logical change per commit (one purpose, one concern)
- Split commits when mixing: features + fixes, code + docs, different modules, large diffs
- Each commit should be independently revertable and reviewable

**Split Examples**:
- `feat(filter): add case-sensitive regex support` → `test(filter): add tests for case-sensitive mode`
- `chore(tooling): upgrade eslint` → `style: apply new eslint rules` → `docs: update CLAUDE.md with eslint 9`

**Before Committing**:
1. Run `npm test` - all tests must pass
2. Run `npm run lint` - no linting errors
3. Run `npm run format` - consistent formatting
4. Verify `.env` and `.telegram-session` are NOT staged
5. Review `git diff` - ensure changes match commit message

**Branch Info**:
- Main branch is `master` (not `main`)
- Feature branches: `feature/description` or `fix/description`

## Critical Rules

IMPORTANT: **Never commit sensitive files**
- `.env` contains API keys and tokens
- `.telegram-session` contains authentication session
- Both are in `.gitignore` - verify before every commit

IMPORTANT: **Maintain the minimal philosophy**
- This project is intentionally simple (~550 lines total)
- Don't add features that bloat the codebase
- Question every new dependency
- Extract utilities when code is reusable (retry, cache)
- If a feature needs >100 lines, reconsider the approach

YOU MUST: **Run tests before marking tasks complete**
- Use `npm test` to verify all tests pass
- Don't mark a todo as completed if tests fail
- Don't skip testing "small" changes - they often break things

YOU MUST: **Run lint before marking tasks complete**
- Use `npm run lint` to verify code style
- Don't mark a todo as completed if linting fails
- Prettier formatting should be automatic, but verify with `npm run format:check`
- remove user instructions from code