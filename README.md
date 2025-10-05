# telegram-replicator

Simple event-driven message replicator for Telegram. Monitors one or many source channels, applies regex filters, broadcasts to multiple targets.

## How it works

GramJS (user client) listens to source channel(s) → regex filter → Telegraf (bot) broadcasts to N targets. Handles media (photos/documents/videos/audio <10MB by default), text chunking (Telegram limits), HTML escaping, exponential backoff for rate limits, graceful shutdown.

```
Source → Filter (regex) → Strip (regex) → Broadcast to targets
           ↓
    Download media if present
```

~665 lines total. No DB, no external deps beyond Telegram clients.

## Setup

```bash
cp .env.example .env  # Edit with your credentials
npm install && npm start
```

**Requirements:**

- Node.js 18+
- Telegram API credentials (https://my.telegram.org/apps)
- Bot token (@BotFather)
- Target chat IDs (@userinfobot, negative for groups/channels)

First run prompts for SMS code. Session persists in `.telegram-session`.

## Configuration

All config via `.env`:

```env
# Required
API_ID=12345678
API_HASH=abcdef...
PHONE_NUMBER=+1234567890
TELEGRAM_BOT_TOKEN=123456:ABC-DEF...
TG_SOURCE_CHANNEL=@channel1,@channel2   # or -1001234567890
TG_TARGETS=-1001234567890,-1009876543210

# Optional filtering (defaults shown)
FILTER_REGEX=tech|technology|announcement|news|update  # case-insensitive
STRIP_REGEX=(?:^|\n)Powered by.*$                      # global, case-insensitive
TG_2FA_PASSWORD=your_totp_password                     # optional, for users with Telegram 2FA

# Media handling
SUPPORTED_MEDIA_TYPES=photo,document,video,audio       # default: photo,document
MAX_MEDIA_BYTES=10485760                               # 10MB default

# System
LOG_LEVEL=info            # debug|info|warn|error
```

`TG_SOURCE_CHANNEL` accepts comma-separated usernames or numeric IDs. Order is preserved.

Regex compiled at startup. Test patterns at regex101.com (JavaScript flavor).

## Troubleshooting

**`Cannot find Telegram channel`**: Your user account must be a member. Use numeric ID for private channels.

**`Invalid chat ID` (positive number)**: Group/channel IDs are negative. Use @userinfobot to get the correct ID.

**`AUTH_KEY_UNREGISTERED`**: Session expired. Delete `.telegram-session` and re-authenticate.

**`FLOOD_WAIT_X`**: Rate limited. The bot implements exponential backoff with jitter (up to 4 retries per target); if all retries fail the error is logged and processing continues.

**Messages not forwarded**: Check filter matches (`FILTER_REGEX`), strip doesn't empty content (`STRIP_REGEX`), or message has text (media-only dropped). Set `LOG_LEVEL=debug` to see drop reasons.

## Features

- **Multi-source Support**: Listen to multiple channels or groups with a single replicator instance
- **Smart Rate Limiting**: Exponential backoff with jitter for handling Telegram rate limits
- **Configurable Media Types**: Support for photos, documents, videos, and audio (configurable via `SUPPORTED_MEDIA_TYPES`)
- **Text Chunking**: Automatically splits long messages respecting word boundaries
- **Session Security**: Enforces secure permissions (0600) on session files

## Limitations

- No auto-reconnect on disconnect (use process manager: systemd/pm2)
- **Duplicate messages may occur** during network retries or process restarts (Telegram's MTProto can replay updates when reconnecting)
- Voice messages require adding 'voice' to `SUPPORTED_MEDIA_TYPES`
- Stickers and polls not supported
- 2FA support requires setting `TG_2FA_PASSWORD` or responding to the interactive prompt on first run
- Forwards new messages only (edits ignored)
- Message order not guaranteed when rate-limited

`.telegram-session` and `.env` contain plaintext credentials. Keep them secure.

## Contributing

Personal tool shared as-is. Fork if it doesn't fit your use case—6 core files, straightforward to modify.

PRs welcome if minimal and dependency-free. Test coverage welcomed. Future ideas: auto-reconnect, voice message support, album/grouped media.

## License

MIT
