# telegram-replicator

![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)
![Status](https://img.shields.io/badge/status-active-success.svg)
![License](https://img.shields.io/badge/license-MIT-blue.svg)

Event-driven message replicator for Telegram. N→N channel replication with regex filtering.

## Features

- N:N source-to-target mapping
- Regex filtering with strip support
- Media handling (photo, document, video, audio)
- Exponential backoff retry logic
- Message chunking (1024/4096 char limits)
- Deduplication via monotonic ID tracking
- Session file security (0600 perms)
- Graceful SIGINT/SIGTERM handling

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

## Configuration

All configuration via `.env` file:

```env
# === Required ===
API_ID=12345678                                  # From my.telegram.org/apps
API_HASH=abcdef1234567890abcdef1234567890        # From my.telegram.org/apps
PHONE_NUMBER=+1234567890                         # Your phone number
TELEGRAM_BOT_TOKEN=123456:ABC-DEF...             # From @BotFather
TG_SOURCE_CHANNEL=@channel1,@channel2            # Comma-separated (or -1001234567890)
TG_TARGETS=-1001234567890,-1009876543210         # Comma-separated target IDs

# === Optional Filtering ===
FILTER_REGEX=tech|technology|announcement|news   # Case-insensitive include pattern
STRIP_REGEX=(?:^|\n)Powered by.*$                # Global, case-insensitive removal pattern
TG_2FA_PASSWORD=your_totp_password               # If you have 2FA enabled

# === Media Handling ===
SUPPORTED_MEDIA_TYPES=photo,document,video,audio # Default: photo,document
MAX_MEDIA_BYTES=10485760                         # 10MB default

# === System ===
LOG_LEVEL=info                                   # debug|info|warn|error
NODE_ENV=production                              # production|development|test
```

**Notes:**
- `TG_SOURCE_CHANNEL` accepts comma-separated usernames (`@channel`) or numeric IDs (`-1001234567890`)
- Private channels require numeric ID format
- Your user account must be a member of source channels
- Test regex patterns at [regex101.com](https://regex101.com) (JavaScript flavor)

## How It Works

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

## Commands

```bash
npm start              # Start the replicator
npm test               # Run test suite
npm run lint           # Check code style
npm run format         # Auto-format with Prettier
npm run deploy         # Deploy to remote server
```

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

## Architecture

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
        └── filter.js           # Pure filtering function
```

See [docs/architecture.md](docs/architecture.md) for detailed component descriptions.

## Documentation

- [Architecture](docs/architecture.md) - System design and data flow
- [Operations](docs/operations.md) - Deployment and monitoring
- [Security](docs/security.md) - Security best practices
- [Testing](docs/testing.md) - Testing approach and examples

## Limitations

- **No auto-reconnect** - Process exits on disconnect (use PM2/systemd for restarts)
- **Duplicates possible** - May occur during network retries or process restarts (mitigated by monotonic ID tracking)
- **Edits ignored** - Only new messages are replicated
- **Order not guaranteed** - When rate-limited, message order may vary
- **Media types** - Voice messages need explicit `'voice'` in `SUPPORTED_MEDIA_TYPES`
- **Unsupported** - Stickers, polls, and certain media types not supported

## Security Warnings

- `.telegram-session` and `.env` contain **plaintext credentials** (lol)
- **Never commit** these files to version control
- Session file is automatically locked to `0600` permissions
- Enable Telegram 2FA for additional security
- See [docs/security.md](docs/security.md) for comprehensive security guide

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

## License

MIT - See [LICENSE](LICENSE) file for details.

## Support

- **Issues:** https://github.com/hxreborn/telegram-replicator/issues
- **Documentation:** https://github.com/hxreborn/telegram-replicator/tree/master/docs
