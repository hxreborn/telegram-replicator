# Operations Guide

Production deployment and operational best practices for the Telegram replicator.

## Table of Contents

- [Deployment Options](#deployment-options)
- [Session Management](#session-management)
- [Process Management](#process-management)
- [Monitoring](#monitoring)
- [Logging](#logging)
- [Backup and Recovery](#backup-and-recovery)
- [Performance Tuning](#performance-tuning)
- [Troubleshooting](#troubleshooting)

## Deployment Options

### Option 1: PM2 (Recommended for Development)

**Install PM2:**

```bash
npm install -g pm2
```

**Create ecosystem file** (`ecosystem.config.js`):

```javascript
module.exports = {
  apps: [
    {
      name: 'telegram-replicator',
      script: './src/index.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production'
      },
      error_file: './logs/err.log',
      out_file: './logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true
    }
  ]
}
```

**Start with PM2:**

```bash
# Start
pm2 start ecosystem.config.js

# Monitor
pm2 monit

# View logs
pm2 logs telegram-replicator

# Restart
pm2 restart telegram-replicator

# Stop
pm2 stop telegram-replicator

# Startup on boot
pm2 startup
pm2 save
```

### Option 2: systemd (Recommended for Production)

**Create service file** (`/etc/systemd/system/telegram-replicator.service`):

```ini
[Unit]
Description=Telegram Message Replicator
After=network.target

[Service]
Type=simple
User=telegram
Group=telegram
WorkingDirectory=/opt/telegram-replicator
ExecStart=/usr/bin/node src/index.js
Restart=always
RestartSec=10
StandardOutput=append:/var/log/telegram-replicator/output.log
StandardError=append:/var/log/telegram-replicator/error.log

# Environment
Environment=NODE_ENV=production
EnvironmentFile=/opt/telegram-replicator/.env

# Security hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/telegram-replicator

[Install]
WantedBy=multi-user.target
```

**Setup and start:**

```bash
# Create dedicated user
sudo useradd -r -s /bin/false telegram

# Create log directory
sudo mkdir -p /var/log/telegram-replicator
sudo chown telegram:telegram /var/log/telegram-replicator

# Set permissions
sudo chown -R telegram:telegram /opt/telegram-replicator
sudo chmod 600 /opt/telegram-replicator/.env
sudo chmod 600 /opt/telegram-replicator/.telegram-session

# Enable and start service
sudo systemctl daemon-reload
sudo systemctl enable telegram-replicator
sudo systemctl start telegram-replicator

# Check status
sudo systemctl status telegram-replicator

# View logs
sudo journalctl -u telegram-replicator -f
```

### Option 3: Docker

**Dockerfile:**

```dockerfile
FROM node:20-alpine

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy app source
COPY src ./src

# Create non-root user
RUN addgroup -g 1001 -S telegram && \
    adduser -S -D -H -u 1001 -h /app -s /sbin/nologin -G telegram -g telegram telegram

# Switch to non-root user
USER telegram

# Start app
CMD ["node", "src/index.js"]
```

**docker-compose.yml:**

```yaml
version: '3.8'

services:
  telegram-replicator:
    build: .
    container_name: telegram-replicator
    restart: unless-stopped
    env_file:
      - .env
    volumes:
      - ./logs:/app/logs
      - ./.telegram-session:/app/.telegram-session:ro
    logging:
      driver: 'json-file'
      options:
        max-size: '10m'
        max-file: '3'
```

**Important:** Docker requires pre-generated `.telegram-session` file (run locally first for SMS code).

**Run with Docker:**

```bash
# Build
docker-compose build

# Start
docker-compose up -d

# View logs
docker-compose logs -f

# Stop
docker-compose down
```

## Session Management

### Initial Authentication

**Interactive setup:**

```bash
# Run locally to generate session
npm start

# Enter SMS code when prompted
# Enter 2FA password if enabled
# Session saved to .telegram-session
```

**Non-interactive (for automation):**

```bash
# Set 2FA password in .env
TG_2FA_PASSWORD=your_password

# Session file must exist from previous auth
# No SMS prompt on subsequent runs
```

### Session Security

**File permissions:**

```bash
# Automatically enforced by app
chmod 600 .telegram-session
chmod 600 .env
```

**Session lifecycle:**

- Valid for ~30 days of inactivity
- Renewed automatically on each connection
- Expires immediately on password change

**Session rotation:**

```bash
# Delete expired session
rm .telegram-session

# Re-authenticate
npm start
```

### Multi-Instance Sessions

**Not supported:** Telegram allows only one active session per phone number per application. Running multiple instances with the same session will cause disconnections.

**Workaround:** Use different phone numbers or API credentials for each instance.

## Process Management

### Health Monitoring

**Built-in health check:**

- 30-second interval connection check
- Logs connection state changes
- Exits on disconnect (process manager restarts)

**Exit behavior:**

```javascript
// Automatic exit on:
- GramJS disconnection
- Unrecoverable errors
- SIGTERM/SIGINT signals
```

### Graceful Shutdown

**Manual shutdown:**

```bash
# Sends SIGTERM, waits for cleanup
kill -TERM <pid>

# Or via PM2
pm2 stop telegram-replicator
```

**Shutdown sequence:**

1. Stop accepting new messages
2. Complete pending sends
3. Close connections
4. Exit process

**Timeout:** ~5 seconds for cleanup, force exit if exceeded.

### Statistics Logging

**Automatic stats (every 5 minutes):**

```json
{
  "messagesProcessed": 147,
  "messagesFiltered": 23,
  "messagesSent": 124,
  "errors": 2,
  "uptime": 18234
}
```

## Monitoring

### Log-Based Monitoring

**Key log patterns:**

```bash
# Connection issues
grep "disconnect" logs/output.log

# Rate limiting
grep "FLOOD_WAIT" logs/output.log

# Authentication errors
grep "AUTH_KEY" logs/output.log

# Duplicate messages
grep "Duplicate message" logs/output.log

# Filter drops
grep "Message dropped" logs/output.log
```

### Metrics to Track

**Operational metrics:**

- Uptime percentage
- Message processing rate (msgs/min)
- Filter drop rate (%)
- Error rate per target
- Retry frequency
- Average message latency

**System metrics:**

- CPU usage
- Memory usage
- Network I/O
- Disk I/O (session file writes)

### Alerting Recommendations

**Critical alerts:**

- Process down for >5 minutes
- Authentication failures
- Zero messages processed for >1 hour (if expecting traffic)

**Warning alerts:**

- High error rate (>5% of sends)
- Frequent rate limiting (>10 FLOOD_WAIT/hour)
- Memory usage >400MB

### External Monitoring

**Healthcheck endpoint (optional):**

Create a simple HTTP healthcheck:

```javascript
// healthcheck.js
import { createServer } from 'http'

createServer((req, res) => {
  res.writeHead(200)
  res.end('OK')
}).listen(3000)
```

**Monitor with:**

- UptimeRobot
- Pingdom
- DataDog
- Prometheus + Grafana

## Logging

### Log Configuration

**Environment variables:**

```env
LOG_LEVEL=info          # debug|info|warn|error
NODE_ENV=production     # development|production|test
```

**Log levels:**

- `debug` - All events including message content (verbose)
- `info` - Normal operations, stats, connection events
- `warn` - Recoverable errors, rate limits, retries
- `error` - Unrecoverable errors, authentication failures

### Log Format

**Development (pretty-printed):**

```
[2025-10-09 10:23:45] INFO (listener.js:142): Connected to Telegram
[2025-10-09 10:23:47] INFO (index.js:56): Message processed (id=12345)
```

**Production (JSON):**

```json
{
  "level": 30,
  "time": 1696849425000,
  "msg": "Message processed",
  "messageId": 12345,
  "sourceId": -1001234567890
}
```

### Log Rotation

**Using logrotate:**

Create `/etc/logrotate.d/telegram-replicator`:

```
/var/log/telegram-replicator/*.log {
    daily
    rotate 7
    compress
    delaycompress
    missingok
    notifempty
    create 0640 telegram telegram
    sharedscripts
    postrotate
        systemctl reload telegram-replicator > /dev/null 2>&1 || true
    endscript
}
```

**Using PM2:**

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
```

### Sensitive Data Redaction

**Automatically redacted:**

- Bot tokens
- API hashes
- Phone numbers
- Authorization headers

**Manual redaction (if logging full messages):**

```javascript
// Don't log message content in production
logger.info({ messageId: msg.id }, 'Message processed')
// Instead of:
// logger.info({ message: msg.message }, 'Message processed')
```

## Backup and Recovery

### What to Backup

**Critical files:**

- `.env` - Configuration and credentials
- `.telegram-session` - Authenticated session
- `ecosystem.config.js` or systemd service file

**Optional:**

- Logs (for audit trail)
- Application code (if customized)

### Backup Strategy

**Manual backup:**

```bash
# Create encrypted backup
tar -czf backup-$(date +%Y%m%d).tar.gz .env .telegram-session
gpg -c backup-*.tar.gz
rm backup-*.tar.gz

# Verify
gpg -d backup-*.tar.gz.gpg | tar -tzf -
```

**Automated backup (systemd timer):**

Create `/etc/systemd/system/telegram-replicator-backup.service`:

```ini
[Unit]
Description=Backup Telegram Replicator Session

[Service]
Type=oneshot
User=telegram
ExecStart=/usr/local/bin/backup-telegram-session.sh
```

Create `/etc/systemd/system/telegram-replicator-backup.timer`:

```ini
[Unit]
Description=Daily Telegram Replicator Backup

[Timer]
OnCalendar=daily
Persistent=true

[Install]
WantedBy=timers.target
```

### Recovery Procedure

**Restore from backup:**

```bash
# Decrypt backup
gpg -d backup-20251009.tar.gz.gpg > backup.tar.gz

# Extract to new location
tar -xzf backup.tar.gz -C /opt/telegram-replicator/

# Fix permissions
chmod 600 /opt/telegram-replicator/.env
chmod 600 /opt/telegram-replicator/.telegram-session
chown telegram:telegram /opt/telegram-replicator/*

# Restart service
systemctl restart telegram-replicator
```

**Session invalidation:**

If session is compromised:

1. Delete `.telegram-session`
2. Terminate sessions via Telegram app (Settings → Privacy → Active Sessions)
3. Re-authenticate
4. Rotate API credentials if needed

## Performance Tuning

### Resource Limits

**Typical resource usage:**

- CPU: <5% (idle), 10-20% (active)
- Memory: 100-200MB
- Network: Depends on message volume and media

**Adjust limits (systemd):**

```ini
[Service]
MemoryMax=500M
CPUQuota=50%
```

**Adjust limits (PM2):**

```javascript
{
  max_memory_restart: '500M',
  max_restarts: 10,
  min_uptime: 60000
}
```

### Optimization Tips

**High-volume channels:**

- Increase `MAX_MEDIA_BYTES` only if needed
- Use stricter `FILTER_REGEX` to reduce load
- Monitor rate limiting frequency

**Low-latency requirements:**

- Set `LOG_LEVEL=warn` (reduce I/O)
- Disable pretty logging in production
- Use SSD for session file writes

**Multiple sources:**

- Consider separate instances if >10 sources
- Monitor memory usage with many sources

## Troubleshooting

### Common Issues

**Process exits immediately:**

```bash
# Check logs for startup errors
journalctl -u telegram-replicator -n 50

# Common causes:
- Missing .env file
- Invalid credentials
- Session file corruption
```

**High CPU usage:**

```bash
# Check message volume
grep "Message processed" logs/output.log | wc -l

# Profile Node.js
node --prof src/index.js
```

**Memory leaks:**

```bash
# Monitor memory over time
watch -n 5 'ps aux | grep index.js'

# Enable heap snapshots (development only)
node --inspect src/index.js
```

**Rate limiting loops:**

```bash
# Check FLOOD_WAIT frequency
grep "FLOOD_WAIT" logs/output.log | tail -20

# Reduce message rate or add more target bots
```

### Debug Mode

**Enable verbose logging:**

```bash
LOG_LEVEL=debug npm start
```

**Trace specific messages:**

```javascript
// Temporarily add to index.js
logger.debug({ msg }, 'Raw message received')
```

### Support Resources

- **Issues:** https://github.com/hxreborn/telegram-replicator/issues
- **Telegram API Docs:** https://core.telegram.org/api
- **GramJS Docs:** https://gram.js.org/
- **Telegraf Docs:** https://telegraf.js.org/

---

**Last updated:** 2025-10-09
