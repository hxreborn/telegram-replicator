# CLAUDE.md

Guidance for Claude Code when working with this Telegram message replicator.

## Quick Commands

```bash
npm start                    # Run replicator daemon
npm test                     # Run all tests (Node.js built-in runner)
npm test -- --watch          # Watch mode for TDD
npm run lint                 # ESLint check (required before commit)
npm run format               # Auto-format with Prettier
npm run deploy               # Deploy to remote server (uses .env vars)
```

## Architecture

Event-driven pipeline: `GramJS Listener → Filter → Telegraf Sender`

**Core Files:**
- `src/index.js` - Main orchestration + deduplication (monotonic msg ID tracking)
- `src/bot/listener.js` - GramJS user client, emits message events
- `src/bot/middleware/filter.js` - Pure function: regex filter + strip + HTML escape
- `src/bot/sender.js` - Telegraf bot, broadcasts to targets with retry/chunking
- `src/config.js` - Env validation, regex compilation, pino logger

**Deduplication:** Map of `sourceId → lastMessageId`, drops `newId <= lastSeen`

**Key Behaviors:**
- **Filtering**: Drop if no text, regex mismatch, empty after strip, unsupported media, size exceeded
- **Media**: Download to Buffer, upload once then reuse `file_id` (Telegram optimization)
  - Supported types: photo, document, video, audio (configurable via `SUPPORTED_MEDIA_TYPES`)
- **Chunking**: Caption 1024 chars, message 4096 chars, split at word boundaries
- **Rate limits**: Exponential backoff + jitter, max 4 retries per target (60s cap)
- **Session**: `.telegram-session` file (plaintext), SMS code on first run, 2FA supported
- **Resilience**: Exits on disconnect (PM2/systemd auto-restart)

## Gotchas

**API:**
- GramJS uses `BigInt`, Telegraf uses `Number` for chat IDs
- Private channels need numeric ID (`-100...`), public can use `@username`
- `msg.media._` can be undefined, use optional chaining
- Session expires after ~30 days idle - delete `.telegram-session` to re-auth

**Messages:**
- Media-only (no text/caption) are dropped - filter needs text
- Edits ignored - only new messages replicate
- Order not guaranteed when rate-limited
- Voice messages need explicit `'voice'` in `SUPPORTED_MEDIA_TYPES`

**Deployment:**
- `.env` + `.telegram-session` are plaintext secrets - NEVER commit
- First run is interactive (SMS code) - not Docker-friendly without pre-generated session
- `LOG_LEVEL=debug` is very verbose - use `info` in production

## Code Style

- ES modules, no semicolons, single quotes (Prettier enforced)
- ESLint 9 flat config + prettier
- 100 char lines, 2 spaces, `arrowParens: always`
- Self-documenting code, minimal JSDoc

## Testing

- Jest (`@jest/globals`) + `node:assert/strict`
- Prefer real data over mocks; use shared doubles in `tests/helpers/`
- TDD: write failing test, implement, refactor
- Tests live under `tests/unit`, `tests/integration`, `tests/contract`
- **Must pass before commit**

## Workflow

**Bug Fixes:** Read source → verify with tests → fix → add regression test → `npm test && npm run lint`

**New Features:** Research patterns → TDD → minimal impl → verify alignment with "simple replicator" philosophy

**Dependencies:** Prefer Node.js built-in APIs over npm packages - keep it minimal

## Git

**Commits:** Single-line format `type(scope): message` (imperative mood, <72 chars)
- Types: `feat`, `fix`, `refactor`, `test`, `chore`, `docs`, `style`, `perf`
- Scopes: `(filter)`, `(sender)`, `(listener)`, `(config)`, `(tooling)`
- Atomic: one logical change per commit

**Pre-commit:** `npm test && npm run lint && npm run format` + verify `.env`/`.telegram-session` NOT staged

**Branch:** Main is `master` (not `main`)

## Critical Rules

⚠️ **NEVER commit `.env` or `.telegram-session`** (plaintext secrets)

⚠️ **Keep it minimal** - question new deps, prefer Node.js built-ins

⚠️ **Tests must pass** before marking todos complete
