import 'dotenv/config'
import pino from 'pino'
import caller from 'pino-caller'

/**
 * Configuration and logger module.
 * Validates required environment variables and exports frozen config + logger.
 */

// Required environment variables with helpful context
const REQUIRED_VARS = {
  API_ID: 'Get from https://my.telegram.org/apps',
  API_HASH: 'Get from https://my.telegram.org/apps',
  PHONE_NUMBER: 'User account phone in E.164 format (e.g., +1234567890)',
  TELEGRAM_BOT_TOKEN: 'Get from @BotFather on Telegram',
  TG_SOURCE_CHANNEL: 'Channel username (e.g., @channel) or numeric ID',
  TG_TARGETS: 'Comma-separated chat IDs (e.g., -1001234567890,-1009876543210)'
}

// Validate all required vars are present
for (const [key, hint] of Object.entries(REQUIRED_VARS)) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}\n  → ${hint}`)
  }
}

// Validate and compile regex patterns
function compileRegex(pattern, flags, name) {
  try {
    return new RegExp(pattern, flags)
  } catch (err) {
    throw new Error(
      `Invalid regex in ${name}: ${err.message}\n` +
        `  Pattern: ${pattern}\n` +
        `  → Check syntax at https://regex101.com`
    )
  }
}

// Validate and parse target chat IDs
function parseTargets(targetsStr) {
  const ids = targetsStr
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .map((t) => {
      const id = Number(t)
      if (isNaN(id)) {
        throw new Error(
          `Invalid chat ID in TG_TARGETS: "${t}"\n` +
            `  → Must be numeric. Use /getid bots to find chat IDs.`
        )
      }
      if (id > 0) {
        throw new Error(
          `Invalid chat ID in TG_TARGETS: ${id}\n` +
            `  → Group/channel IDs must be negative (e.g., -1001234567890)`
        )
      }
      return id
    })

  if (ids.length === 0) {
    throw new Error(`TG_TARGETS cannot be empty\n` + `  → Provide at least one chat ID`)
  }

  return ids
}

/**
 * Application configuration object (frozen for immutability)
 */
export const config = Object.freeze({
  // Telegram API credentials
  apiId: Number(process.env.API_ID),
  apiHash: process.env.API_HASH,
  phone: process.env.PHONE_NUMBER,
  botToken: process.env.TELEGRAM_BOT_TOKEN,
  twoFactorPassword: process.env.TG_2FA_PASSWORD || '',

  // Channel configuration
  source: process.env.TG_SOURCE_CHANNEL,
  targets: parseTargets(process.env.TG_TARGETS),

  // Optional configuration (compiled regex)
  filterRegex: compileRegex(
    process.env.FILTER_REGEX || 'tech|technology|announcement|news|update',
    'i',
    'FILTER_REGEX'
  ),
  stripRegex: compileRegex(
    process.env.STRIP_REGEX || '(?:^|\\n)Powered by.*$',
    'gi',
    'STRIP_REGEX'
  ),
  maxMediaBytes: Number(process.env.MAX_MEDIA_BYTES || 10 * 1024 * 1024), // 10 MiB default
  logLevel: process.env.LOG_LEVEL || 'info'
})

/**
 * Masks chat ID to prevent leaking private group IDs in logs
 * @param {number} chatId Telegram chat ID
 * @returns {string} Masked ID showing only last 4 digits
 */
export function maskChatId(chatId) {
  const idStr = String(chatId)
  return idStr.length > 4 ? `...${idStr.slice(-4)}` : idStr
}

/**
 * Pino logger with caller information and pretty printing in development
 */
const isDev = process.env.NODE_ENV !== 'production'

export const logger = caller(
  pino({
    level: config.logLevel,
    ...(isDev && {
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'yyyy-mm-dd HH:MM:ss.l',
          ignore: 'pid,hostname'
        }
      }
    })
  })
)
