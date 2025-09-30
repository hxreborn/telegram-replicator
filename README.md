# telegram-replicator

Simple event-driven message replicator for Telegram. Monitors one source channel, applies regex filters, broadcasts to multiple targets.

## How it works

GramJS (user client) listens to source channel → regex filter → Telegraf (bot) broadcasts to N targets. Handles media (photos/documents <10MB), text chunking (Telegram limits), HTML escaping, graceful shutdown.

```
Source → Filter (regex) → Strip (regex) → Broadcast to targets
           ↓
    Download media if present
```

~516 lines total. No DB, no external deps beyond Telegram clients.

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
TG_SOURCE_CHANNEL=@channelname          # or -1001234567890
TG_TARGETS=-1001234567890,-1009876543210

# Optional filtering (defaults shown)
FILTER_REGEX=tech|technology|announcement|news|update  # case-insensitive
STRIP_REGEX=(?:^|\n)Powered by.*$                      # global, case-insensitive
TG_2FA_PASSWORD=your_totp_password                     # optional, for users with Telegram 2FA

# System
MAX_MEDIA_BYTES=10485760  # 10MB
LOG_LEVEL=info            # debug|info|warn|error
```

Regex compiled at startup. Test patterns at regex101.com (JavaScript flavor).

## Troubleshooting

**`Cannot find Telegram channel`**: Your user account must be a member. Use numeric ID for private channels.

**`Invalid chat ID` (positive number)**: Group/channel IDs are negative. Use @userinfobot to get the correct ID.

**`AUTH_KEY_UNREGISTERED`**: Session expired. Delete `.telegram-session` and re-authenticate.

**`FLOOD_WAIT_X`**: Rate limited. The bot waits once (up to 60s) and retries that target; if it still fails the error is logged and processing continues.

**Messages not forwarded**: Check filter matches (`FILTER_REGEX`), strip doesn't empty content (`STRIP_REGEX`), or message has text (media-only dropped). Set `LOG_LEVEL=debug` to see drop reasons.

## Limitations

- No auto-reconnect on disconnect (use process manager: systemd/pm2)
- Only photos and documents (no videos/stickers/polls)
- 2FA support requires setting `TG_2FA_PASSWORD` or responding to the interactive prompt on first run
- Forwards new messages only (edits ignored)

`.telegram-session` and `.env` contain plaintext credentials. Keep them secure.

## Contributing

Personal tool shared as-is. Fork if it doesn't fit your use case—5 files, straightforward to modify.

PRs welcome if minimal and dependency-free. Would be nice: tests, auto-reconnect, rate limit backoff.

## License

MIT
