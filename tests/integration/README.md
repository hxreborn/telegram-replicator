# Integration Tests

Integration tests verify the system with partial real dependencies. Unlike unit tests (which use fakes for all external dependencies), integration tests may use real Telegram clients, file systems, or network calls.

## Test Files

- **`bot/sender.integration.test.js`** - Tests sender with real Telegraf adapter (requires credentials)
- **`bot/listener.integration.test.js`** - Tests GramJS listener with fake client (no credentials needed)
- **`index/orchestrator.integration.test.js`** - Tests main orchestration flow end-to-end

## Running Integration Tests

### Quick Start (No Credentials)

Most integration tests use dependency injection and don't require real API credentials:

```bash
npm test tests/integration/bot/listener.integration.test.js
npm test tests/integration/index/orchestrator.integration.test.js
```

### With Real Telegram API

The sender integration test connects to real Telegram servers and requires:

1. A test bot token from [@BotFather](https://t.me/BotFather)
2. A test chat ID where the bot is a member

#### Setup

1. **Create a test bot**:
   - Message [@BotFather](https://t.me/BotFather) on Telegram
   - Send `/newbot` and follow instructions
   - Copy the bot token (format: `123456:ABC-DEF1234ghIkl...`)

2. **Get a test chat ID**:
   - Option A: Create a private group, add your bot, and use [@userinfobot](https://t.me/userinfobot) to get the group ID
   - Option B: Use your personal chat ID (start a chat with your bot, then use the Telegram API to get `updates` and find your chat ID)
   - Format: numeric ID like `123456789` (for users) or `-1001234567890` (for groups/channels)

3. **Set environment variables**:

   ```bash
   export RUN_TELEGRAM_INTEGRATION=1
   export TELEGRAM_BOT_TOKEN="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
   export TELEGRAM_TARGET_ID="-1001234567890"  # Your test chat ID
   ```

4. **Run tests**:

   ```bash
   npm test tests/integration/bot/sender.integration.test.js

   # Or use the dedicated script
   npm run test:integration
   ```

#### What Gets Tested

The real Telegram integration tests will:

- ✅ Send a test text message to your test chat
- ✅ Send a test photo (minimal 1x1 red pixel PNG) to your test chat
- ✅ Test rate limiting gracefully (sends 3 messages rapidly)

**⚠️ Warning**: These tests send **real messages** to Telegram. Use a dedicated test chat to avoid spamming.

### Environment Variables

| Variable                   | Required | Description                | Example             |
| -------------------------- | -------- | -------------------------- | ------------------- |
| `RUN_TELEGRAM_INTEGRATION` | Yes      | Set to `1` to enable tests | `1`                 |
| `TELEGRAM_BOT_TOKEN`       | Yes      | Bot token from @BotFather  | `123456:ABC-DEF...` |
| `TELEGRAM_TARGET_ID`       | Yes      | Chat ID for test messages  | `-1001234567890`    |

## Test Categories

### 1. Listener Integration (`bot/listener.integration.test.js`)

Tests GramJS listener with fake client injection. **No real API calls**.

**What it tests**:

- Event emission from GramJS
- Channel trust metadata (verified/scam flags)
- Media download with size limits
- Session management (file creation, permissions)

**Dependencies**: Uses fake TelegramClient via `clientFactory` injection.

**Run with**: `npm test tests/integration/bot/listener.integration.test.js`

### 2. Orchestrator Integration (`index/orchestrator.integration.test.js`)

Tests the full message pipeline: listener → filter → sender → deduplication.

**What it tests**:

- End-to-end message flow
- Deduplication by message ID
- Signal handlers (SIGINT/SIGTERM)
- Media download and forwarding
- Filter integration

**Dependencies**: Uses fakes for all external systems (no API calls).

**Run with**: `npm test tests/integration/index/orchestrator.integration.test.js`

### 3. Sender Integration (`bot/sender.integration.test.js`)

Tests sender with **real Telegraf** connecting to Telegram servers. **Requires credentials**.

**What it tests**:

- Real message sending via Telegram API
- Photo upload with real media
- Rate limiting with actual server responses
- Telegram API error handling

**Dependencies**: Real Telegraf adapter, real Telegram API.

**Run with**: `RUN_TELEGRAM_INTEGRATION=1 TELEGRAM_BOT_TOKEN=xxx TELEGRAM_TARGET_ID=xxx npm test tests/integration/bot/sender.integration.test.js`

## Skipping Integration Tests

Integration tests that require credentials are **automatically skipped** if environment variables are not set.

You'll see output like:

```
# Subtest: integration: sender sends real message via Telegraf
ok 1 - integration: sender sends real message via Telegraf # SKIP Set RUN_TELEGRAM_INTEGRATION=1 to run integration tests
```

This allows `npm test` to run successfully in CI environments or when credentials aren't available.

## Troubleshooting

### Test times out

**Cause**: Network issues or invalid credentials.

**Fix**:

- Verify your bot token is correct
- Ensure the bot is a member of the target chat
- Check your internet connection
- Try with a different target chat

### Bot forbidden error

**Cause**: Bot is not a member of the target chat, or chat ID is wrong.

**Fix**:

- Add your bot to the test chat
- Verify the chat ID with [@userinfobot](https://t.me/userinfobot)
- For private chats, ensure you've started a conversation with the bot
- For groups/channels, the ID must start with `-100` (e.g., `-1001234567890`)

### Rate limit error

**Cause**: Too many API requests in a short time.

**Fix**:

- Wait 30-60 seconds before re-running tests
- The test suite intentionally triggers rate limits to test retry logic
- This is expected behavior and validates the retry mechanism

### Session file warning

**Cause**: Listener integration test creates a temporary session file.

**Fix**: This is normal. The test cleans up after itself with `t.after()`.

## Best Practices

1. **Use a dedicated test chat** - Don't spam your production channels
2. **Run sparingly** - Integration tests hit real APIs and may trigger rate limits
3. **Check credentials before CI** - Don't commit tokens or chat IDs
4. **Monitor test output** - Real API errors provide useful debugging info
5. **Keep test data minimal** - Use small images (we use 1x1 pixel PNGs)

## CI/CD Integration

For continuous integration:

```yaml
# .github/workflows/test.yml
- name: Run unit and integration tests
  run: npm test
  # Integration tests auto-skip without credentials

- name: Run full integration tests (optional)
  if: github.ref == 'refs/heads/main'
  env:
    RUN_TELEGRAM_INTEGRATION: 1
    TELEGRAM_BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}
    TELEGRAM_TARGET_ID: ${{ secrets.TELEGRAM_TARGET_ID }}
  run: npm run test:integration
```

Store credentials as GitHub Secrets, not in code.

## See Also

- [Main Testing Documentation](../../docs/testing.md) - Overview of test architecture
- [Test Doubles Guide](../helpers/test-doubles.js) - Shared test utilities
- [Contract Tests](../contract/) - API contract verification
