# telegram-replicator

![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)
![Status](https://img.shields.io/badge/status-active-success.svg)
![Coverage](https://codecov.io/gh/hxreborn/telegram-replicator/branch/master/graph/badge.svg)
![License](https://img.shields.io/badge/license-MIT-blue.svg)

Event-driven message replicator for Telegram. Monitors one or many source channels, applies regex filters, broadcasts to multiple targets.

## Features

- Many-to-many channel replication with configurable source/target mapping
- Regex include/strip filters with HTML escaping for content transformation
- Media reuse via Telegram file IDs (photo, document, video, audio)
- Automatic retry with exponential backoff for rate-limit handling
- Message deduplication using monotonic ID tracking
- Secure session management with enforced 0600 permissions

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/hxreborn/telegram-replicator.git
cd telegram-replicator
npm install

# 2. Configure
cp .env.example .env
# Edit .env with your credentials (see Configuration section)

# 3. Run
npm start
```

**First-time setup**: The app will prompt for an SMS code sent to your phone. After authentication, the session is saved to `.telegram-session` for subsequent runs.

## Prerequisites

- **Node.js** 20.0.0 or higher
- **Telegram API credentials** - Get from https://my.telegram.org/apps
- **Bot token** - Create a bot via @BotFather on Telegram
- **Target chat IDs** - Use @userinfobot to get IDs (negative for groups/channels)

## Architecture Overview

```
┌─────────────┐      ┌─────────────┐      ┌─────────────┐
│  Listener   │─────▶│   Filter    │─────▶│   Sender    │
│  (GramJS)   │ msg  │ (transform) │ data │ (Telegraf)  │
└─────────────┘      └─────────────┘      └─────────────┘
  User Client        Middleware           Bot API
```

**Pipeline:**

1. **Listener** - GramJS user client monitors source channels
2. **Filter** - Applies regex matching, strips content, escapes HTML
3. **Sender** - Telegraf bot broadcasts to all target channels with retry logic

**Deduplication:** Tracks last message ID per source channel, drops messages with ID ≤ last seen (leverages Telegram's monotonic message IDs).

**Media:** Downloads to Buffer, uploads once, then reuses `file_id` for remaining targets (Telegram optimization).

**Chunking:** Respects Telegram limits (1024 chars for captions, 4096 for messages), splits at word boundaries.

## Configuration

All configuration via `.env` file:

| Variable                | Required | Default          | Notes                                                     |
| ----------------------- | -------- | ---------------- | --------------------------------------------------------- |
| `API_ID`                | ✓        | -                | From my.telegram.org/apps                                 |
| `API_HASH`              | ✓        | -                | From my.telegram.org/apps                                 |
| `PHONE_NUMBER`          | ✓        | -                | Your phone number (e.g., +1234567890)                     |
| `TELEGRAM_BOT_TOKEN`    | ✓        | -                | From @BotFather                                           |
| `TG_SOURCE_CHANNEL`     | ✓        | -                | Comma-separated: `@channel` or `-1001234567890`           |
| `TG_TARGETS`            | ✓        | -                | Comma-separated target IDs (negative for groups/channels) |
| `FILTER_REGEX`          |          | `''`             | Case-insensitive include pattern (empty = all messages)   |
| `STRIP_REGEX`           |          | `''`             | Global, case-insensitive removal pattern                  |
| `TG_2FA_PASSWORD`       |          | -                | Required if 2FA is enabled                                |
| `SUPPORTED_MEDIA_TYPES` |          | `photo,document` | Comma-separated: photo, document, video, audio, voice     |
| `MAX_MEDIA_BYTES`       |          | `10485760`       | 10MB default                                              |
| `LOG_LEVEL`             |          | `info`           | debug, info, warn, error                                  |
| `NODE_ENV`              |          | `production`     | production, development, test                             |

**Notes:**

- `TG_SOURCE_CHANNEL` accepts comma-separated usernames (`@channel`) or numeric IDs (`-1001234567890`)
- Private channels require numeric ID format
- Your user account must be a member of source channels
- Test regex patterns at [regex101.com](https://regex101.com) (JavaScript flavor)

## Scripts & Testing

```bash
npm start              # Start the replicator
npm test               # Run test suite (Node.js built-in runner)
npm run lint           # Check code style (ESLint)
npm run format         # Auto-format with Prettier
npm run deploy         # Deploy to remote server
```

**CI/CD:** Two GitHub Actions workflows run on push/PR:

- `ci.yml` - Runs lint + tests on Node 20
- `pr-preview.yml` - Generates coverage reports and uploads artifacts

## Troubleshooting

### Authentication Issues

**`AUTH_KEY_UNREGISTERED`**

- Session expired. Delete `.telegram-session` and re-authenticate.

**`Cannot find Telegram channel`**

- Your user account must join the channel first
- Use numeric ID for private channels (`-1001234567890`)

### Message Issues

**`Invalid chat ID` (positive number)**

- Group/channel IDs must be negative
- Use @userinfobot to get correct ID

**Messages not forwarded**

- Check `FILTER_REGEX` matches the message text
- Ensure `STRIP_REGEX` doesn't remove all content
- Media-only messages (no text/caption) are dropped
- Set `LOG_LEVEL=debug` to see drop reasons

### Rate Limiting

**`FLOOD_WAIT_X`**

- Telegram rate limit triggered
- Bot automatically retries with exponential backoff (max 4 retries)
- If all retries fail, error is logged and processing continues

### Production Issues

**Process exits on disconnect**

- Expected behavior for resilience
- Use a process manager (PM2, systemd) for auto-restart
- See [docs/operations.md](docs/operations.md) for deployment guides

## Limitations

- Does not forward message edits (only new messages)
- No automatic reconnection (use PM2/systemd for restarts)
- Duplicates possible during network retries or restarts (mitigated by monotonic ID tracking)
- Message order not guaranteed when rate-limited
- Voice messages require explicit `'voice'` in `SUPPORTED_MEDIA_TYPES`
- Stickers, polls, and certain media types not supported

## Security

`.telegram-session` and `.env` contain plaintext credentials (lol); exclude them from version control.

- Session file is automatically locked to `0600` permissions
- Enable Telegram 2FA for additional security
- Never commit `.env` or `.telegram-session` to git
- Consider using secret managers for production deployments

See [docs/security.md](docs/security.md) for comprehensive security guide.

## Project Structure

```
src/
├── index.js                    # Main orchestrator
├── config.js                   # Config validation + logger
├── utils/
│   └── retry.js                # Exponential backoff utility
└── bot/
    ├── listener.js             # GramJS EventEmitter wrapper
    ├── sender.js               # Telegraf wrapper
    └── middleware/
        └── filter.js           # Message filtering function
```

## Further Reading

- [Architecture](docs/architecture.md) - System design and data flow
- [Operations](docs/operations.md) - Deployment and monitoring
- [Security](docs/security.md) - Security best practices
- [Testing](docs/testing.md) - Testing approach and examples

## Contributing

This is a personal tool shared as-is. PRs welcome if:

- Minimal and dependency-free
- Tests included
- Follows existing code style (ES modules, no semicolons)

Run before submitting:

```bash
npm test && npm run lint && npm run format
```

**Future ideas:** Auto-reconnect, album/grouped media support, voice messages by default.

## Support

- **Issues:** https://github.com/hxreborn/telegram-replicator/issues
- **Documentation:** https://github.com/hxreborn/telegram-replicator/tree/master/docs

## License

MIT - See [LICENSE](LICENSE) file for details.
