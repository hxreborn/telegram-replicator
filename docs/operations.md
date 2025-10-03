# Operations

### Session Management
The `.telegram-session` file stores the authenticated GramJS session. On first run, prompts for SMS code interactively via stdin.

### Resilience & Health Monitoring
- **Disconnect handler**: Process exits on connection loss (PM2/systemd restarts)
- **Health check**: 30-second interval monitors connection state
- **Statistics**: Logs message counts every 5 minutes
- **Deduplication**: LRU cache prevents duplicate processing (1-hour TTL)

### Logging
Uses Pino with `pino-caller` for call-site information. In development (non-production NODE_ENV), logs are formatted with `pino-pretty`.

### Media Handling
- Downloads media via GramJS if under size limit (default: 10MB)
- First upload to Telegram returns `file_id` (cached in memory)
- Subsequent uploads to other targets reuse `file_id`
- Supports photos, documents, videos, audio, and voice (configurable)

### Text Handling
Messages are split to respect Telegram limits with graceful fallback:
- **Caption**: 1024 chars max (for media)
- **Message**: 4096 chars max
- Splits on word boundaries when possible, force-breaks long tokens (URLs/base64) when necessary
