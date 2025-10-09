# Security Guide

Comprehensive security practices for deploying and operating the Telegram replicator.

## Table of Contents

- [Threat Model](#threat-model)
- [Credential Management](#credential-management)
- [Account Security](#account-security)
- [Source Verification](#source-verification)
- [Session Security](#session-security)
- [Bot Security](#bot-security)
- [Deployment Security](#deployment-security)
- [Monitoring and Auditing](#monitoring-and-auditing)
- [Incident Response](#incident-response)
- [Compliance](#compliance)

## Threat Model

### Assets at Risk

1. **Telegram user account** - Full access to your personal Telegram account
2. **Bot token** - Control over the bot's message-sending capabilities
3. **API credentials** - Access to Telegram API services
4. **Target channels** - Potential for spam or malicious content injection
5. **Message content** - Sensitive information passing through the pipeline

### Threat Actors

- **External attackers** - Attempting to compromise credentials or infrastructure
- **Malicious sources** - Compromised or malicious source channels
- **Supply chain attacks** - Malicious npm packages or dependencies
- **Insider threats** - Unauthorized access by operators

### Attack Vectors

- Session file theft → account takeover
- SIM swap → SMS code interception → session generation
- Credential exposure → API abuse
- Malicious message content → XSS or injection attacks
- Man-in-the-middle → credential interception
- Compromised source channels → spam or malware distribution

## Credential Management

### Environment Variables

**Storage:**

```bash
# .env file (NEVER commit)
API_ID=12345678
API_HASH=abcdef1234567890abcdef1234567890
PHONE_NUMBER=+1234567890
TELEGRAM_BOT_TOKEN=123456:ABC-DEF...
TG_2FA_PASSWORD=your_secure_password
```

**File permissions:**

```bash
chmod 600 .env
chown telegram:telegram .env
```

**Best practices:**

- Use unique API credentials per deployment
- Rotate credentials quarterly or after incidents
- Never log or echo credentials
- Use environment-specific `.env` files (`.env.production`, `.env.staging`)

### Secret Management Services

**For production deployments, consider:**

**1. HashiCorp Vault:**

```bash
# Store secrets in Vault
vault kv put secret/telegram-replicator \
  api_id=12345678 \
  api_hash=abcd... \
  bot_token=123:ABC...

# Retrieve in app
export VAULT_ADDR='http://127.0.0.1:8200'
export VAULT_TOKEN='...'
```

**2. AWS Secrets Manager:**

```bash
# Store secret
aws secretsmanager create-secret \
  --name telegram-replicator-credentials \
  --secret-string file://.env

# Retrieve in startup script
aws secretsmanager get-secret-value \
  --secret-id telegram-replicator-credentials \
  --query SecretString --output text > .env
```

**3. Kubernetes Secrets:**

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: telegram-replicator-secrets
type: Opaque
stringData:
  api_id: '12345678'
  api_hash: 'abcd...'
  bot_token: '123:ABC...'
```

### Credential Rotation

**When to rotate:**

- Every 90 days (scheduled)
- After suspected compromise
- After employee departure
- After password change on Telegram account

**How to rotate:**

1. **API credentials:**
   - Generate new credentials at https://my.telegram.org/apps
   - Update `.env` with new values
   - Restart application
   - Revoke old credentials after verification

2. **Bot token:**
   - Use @BotFather to regenerate token (`/token`)
   - Update `.env`
   - Restart application
   - Old token is immediately invalidated

3. **Session:**
   - Delete `.telegram-session`
   - Terminate active sessions in Telegram app
   - Re-authenticate with SMS code

## Account Security

### Two-Factor Authentication (2FA)

**Enable 2FA on Telegram:**

1. Open Telegram app
2. Settings → Privacy and Security → Two-Step Verification
3. Set a strong password
4. Add recovery email

**Configure in replicator:**

```env
TG_2FA_PASSWORD=your_2fa_password
```

**Benefits:**

- Blocks SIM swap attacks
- Prevents SMS code interception exploitation
- Requires password even with valid SMS code

### SIM Swap Protection

**Risks:**

- Attacker ports your phone number
- Receives SMS codes for authentication
- Generates new session without your knowledge

**Mitigations:**

1. **Enable 2FA** - Password required even with SMS code
2. **Carrier PIN** - Add PIN to your mobile carrier account
3. **Monitor sessions** - Check active sessions regularly in Telegram app
4. **Session alerts** - Enable login notifications in Telegram settings

### Session Monitoring

**Check active sessions:**

1. Telegram app → Settings → Privacy and Security → Active Sessions
2. Review location, device, IP address
3. Terminate suspicious sessions immediately

**Automated monitoring:**

```bash
# Alert on new session file changes
watch -n 300 'stat .telegram-session | grep Modify'
```

**Log all session activities:**

```javascript
// Add to listener.js
client.on('session', (session) => {
  logger.warn({ timestamp: Date.now() }, 'Session updated')
})
```

## Source Verification

### Channel Validation

**Telegram verification indicators:**

- **Verified badge** - Official channels (blue checkmark)
- **Scam flag** - Telegram-flagged malicious channels
- **Fake flag** - Impersonation attempts

**Pre-deployment checks:**

```bash
# Log channel metadata on startup
logger.info({
  channelId: channel.id,
  title: channel.title,
  verified: channel.verified,
  scam: channel.scam,
  fake: channel.fake
}, 'Source channel connected')
```

**Monitoring:**

- Review startup logs for `scam` or `fake` flags
- Periodically verify channel authenticity
- Monitor for sudden changes in channel behavior

### Content Validation

**Implement additional filtering for suspicious content:**

```javascript
// Example: URL validation
const suspiciousPatterns = [
  /phishing|malware|trojan/i,
  /free\s+download\s+hack/i,
  /click\s+here\s+to\s+win/i
]

function isContentSuspicious(text) {
  return suspiciousPatterns.some((pattern) => pattern.test(text))
}
```

**Considerations:**

- Implement URL scanning (VirusTotal API)
- Block known malicious domains
- Rate-limit messages from new sources
- Manual review for high-risk channels

## Session Security

### File Protection

**Automatic enforcement (by app):**

```javascript
// In listener.js
fs.chmodSync('.telegram-session', 0o600)
```

**Additional measures:**

```bash
# Immutable flag (Linux)
sudo chattr +i .telegram-session

# SELinux context
sudo chcon -t user_home_t .telegram-session

# Encrypted filesystem
# Store on encrypted volume (LUKS, BitLocker, FileVault)
```

### Session Encryption at Rest

**Encrypt session file:**

```bash
# Encrypt
gpg -c .telegram-session
rm .telegram-session
mv .telegram-session.gpg .telegram-session

# Decrypt on startup (wrapper script)
gpg -d .telegram-session.gpg > .telegram-session
chmod 600 .telegram-session
node src/index.js
rm .telegram-session  # Clean up after exit
```

**Using encrypted volumes:**

```bash
# Create encrypted volume
cryptsetup luksFormat /dev/sdX
cryptsetup luksOpen /dev/sdX telegram-crypt
mkfs.ext4 /dev/mapper/telegram-crypt

# Mount and use
mount /dev/mapper/telegram-crypt /opt/telegram-replicator
```

### Session Lifecycle

**Maximum session lifetime:**

- **Active:** Renewed automatically on each connection
- **Inactive:** ~30 days before expiration
- **Password change:** Immediate invalidation

**Force rotation policy:**

```bash
# Rotate every 30 days
0 0 1 * * rm /opt/telegram-replicator/.telegram-session
```

## Bot Security

### Bot Token Protection

**Best practices:**

- Use dedicated bot per deployment
- Never share bot tokens between environments
- Restrict bot to specific target channels only
- Revoke token immediately if compromised

**Bot permissions:**

- Grant minimum required permissions
- No admin privileges unless necessary
- Regular permission audits

### Bot Isolation

**Separate bots for different risk levels:**

```env
# Production (high-value targets)
TELEGRAM_BOT_TOKEN=prod-bot-token

# Staging (test targets)
TELEGRAM_BOT_TOKEN=staging-bot-token

# Development (local testing)
TELEGRAM_BOT_TOKEN=dev-bot-token
```

### Rate Limiting

**Built-in protection:**

- Exponential backoff on `FLOOD_WAIT`
- Max 4 retries per target
- 60-second delay cap

**Additional measures:**

- Monitor retry frequency
- Alert on repeated rate limiting
- Consider multiple bots for high-volume use cases

## Deployment Security

### System Hardening

**Dedicated user:**

```bash
# Create restricted user
sudo useradd -r -s /bin/false telegram
sudo chmod 700 /opt/telegram-replicator
```

**systemd security directives:**

```ini
[Service]
# Prevent privilege escalation
NoNewPrivileges=true

# Filesystem isolation
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadOnlyPaths=/usr /bin /lib /lib64
ReadWritePaths=/opt/telegram-replicator /var/log/telegram-replicator

# Network isolation (if not needed)
# PrivateNetwork=true

# Capability restrictions
CapabilityBoundingSet=
AmbientCapabilities=

# Deny system calls
SystemCallFilter=@system-service
SystemCallErrorNumber=EPERM
```

### Network Security

**Firewall rules:**

```bash
# Allow outbound HTTPS only (Telegram API)
sudo ufw default deny outgoing
sudo ufw allow out 443/tcp
sudo ufw enable
```

**Telegram API endpoints:**

- `api.telegram.org` (149.154.160.0/20)
- Uses HTTPS (port 443)

**Proxy support (optional):**

```javascript
// Add to config for SOCKS5 proxy
socksProxy: {
  host: '127.0.0.1',
  port: 9050,
  type: 5
}
```

### Container Security

**Docker security best practices:**

```dockerfile
# Use specific version, not latest
FROM node:20-alpine

# Run as non-root
USER telegram

# Read-only root filesystem
# Mount writable volumes for session and logs only
```

**docker-compose security:**

```yaml
services:
  telegram-replicator:
    security_opt:
      - no-new-privileges:true
    read_only: true
    tmpfs:
      - /tmp
    volumes:
      - ./.telegram-session:/app/.telegram-session:ro
      - ./logs:/app/logs:rw
```

## Monitoring and Auditing

### Security Logging

**Log critical events:**

```javascript
// Authentication
logger.warn('Session authentication initiated')
logger.warn('Session authentication successful')

// Authorization
logger.warn({ targetId }, 'Message sent to target')

// Failures
logger.error({ error }, 'Authentication failed')
logger.error({ sourceId }, 'Source channel access denied')
```

**Centralized logging:**

- Forward logs to SIEM (Splunk, ELK, Graylog)
- Set up alerts for authentication failures
- Monitor for unusual patterns

### Security Metrics

**Track:**

- Authentication attempts (successful/failed)
- Session regenerations
- Rate limit hits
- Filter drops (potential malicious content)
- Target send failures
- Connection errors

### Audit Trail

**Log all administrative actions:**

```bash
# Session rotations
logger.audit({ timestamp, user }, 'Session rotated')

# Configuration changes
logger.audit({ field, oldValue, newValue }, 'Config updated')

# Credential rotations
logger.audit({ credential }, 'Credential rotated')
```

## Incident Response

### Detection

**Signs of compromise:**

- Unexpected session file modifications
- Unknown active sessions in Telegram app
- Unauthorized messages from bot
- Authentication failures
- Sudden change in source channel behavior

### Response Procedure

**Immediate actions:**

1. **Isolate:**

   ```bash
   # Stop service immediately
   systemctl stop telegram-replicator

   # Block network access
   ufw deny out 443/tcp
   ```

2. **Invalidate credentials:**

   ```bash
   # Delete session
   rm .telegram-session

   # Terminate sessions via Telegram app
   # Settings → Privacy → Active Sessions → Terminate All
   ```

3. **Assess scope:**
   - Review logs for unauthorized activity
   - Check target channels for malicious messages
   - Identify compromised credentials

4. **Rotate credentials:**
   - Generate new API credentials
   - Regenerate bot token
   - Change Telegram 2FA password
   - Update `.env` with new values

5. **Restore service:**

   ```bash
   # Re-authenticate with new session
   npm start

   # Re-enable network
   ufw allow out 443/tcp

   # Start service
   systemctl start telegram-replicator
   ```

### Post-Incident

- Document timeline and root cause
- Review and update security controls
- Notify affected parties if necessary
- Implement additional monitoring

## Compliance

### Data Protection

**GDPR considerations:**

- Messages may contain personal data
- No persistent storage (in-memory only)
- Data minimization (only text and media)
- Right to be forgotten (delete session)

**Data retention:**

- Logs: 7-30 days (configurable)
- Session: Active only, delete on termination
- No message content storage

### Audit Requirements

**For regulated environments:**

- Enable comprehensive logging (LOG_LEVEL=debug)
- Forward logs to tamper-proof storage
- Implement log integrity verification (signatures)
- Retain audit logs per regulatory requirements

## Security Checklist

**Pre-deployment:**

- [ ] Enable Telegram 2FA
- [ ] Set carrier PIN for SIM protection
- [ ] Generate unique API credentials
- [ ] Use strong, unique 2FA password
- [ ] Verify source channel authenticity
- [ ] Review bot permissions
- [ ] Configure firewall rules
- [ ] Set proper file permissions (0600)
- [ ] Enable encrypted filesystem

**Ongoing:**

- [ ] Monitor active Telegram sessions weekly
- [ ] Review logs for suspicious activity daily
- [ ] Rotate credentials quarterly
- [ ] Update dependencies monthly (npm audit)
- [ ] Test incident response procedure quarterly
- [ ] Audit bot permissions monthly

**Post-incident:**

- [ ] Rotate all credentials immediately
- [ ] Review and update security controls
- [ ] Document incident and lessons learned
- [ ] Notify stakeholders if required

## References

- **Telegram Security:** https://core.telegram.org/api/security
- **OWASP Top 10:** https://owasp.org/www-project-top-ten/
- **NIST Cybersecurity Framework:** https://www.nist.gov/cyberframework
- **CIS Controls:** https://www.cisecurity.org/controls

---

**Last updated:** 2025-10-09
