import 'dotenv/config'
import pino from 'pino'
import caller from 'pino-caller'

/**
 * Configuration and logger module.
 * Validates required environment variables and exports frozen config + logger.
 */

const REQUIRED_VARS = {
  API_ID: 'Get from https://my.telegram.org/apps',
  API_HASH: 'Get from https://my.telegram.org/apps',
  PHONE_NUMBER: 'User account phone in E.164 format (e.g., +1234567890)',
  TELEGRAM_BOT_TOKEN: 'Get from @BotFather on Telegram',
  TG_SOURCE_CHANNEL: 'Channel username (e.g., @channel) or numeric ID',
  TG_TARGETS: 'Comma-separated chat IDs (e.g., -1001234567890,-1009876543210)'
}

const isTest = process.env.NODE_ENV === 'test'

if (!isTest) {
  for (const [key, hint] of Object.entries(REQUIRED_VARS)) {
    if (!process.env[key]) {
      throw new Error(`Missing required environment variable: ${key}\n  → ${hint}`)
    }
  }
}

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

function validateMaxMediaBytes(envValue) {
  const defaultValue = 10 * 1024 * 1024

  if (!envValue) return defaultValue

  const parsed = Number(envValue)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(
      `Invalid MAX_MEDIA_BYTES: "${envValue}"\n` +
        `  → Must be a positive integer in bytes. Default: ${defaultValue}`
    )
  }

  return parsed
}

function getSupportedMediaTypes(envValue) {
  const defaultTypes = ['photo', 'document']

  if (!envValue) return defaultTypes

  const types = envValue
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 0)

  const validTypes = ['photo', 'document', 'video', 'audio']
  const invalidTypes = types.filter((t) => !validTypes.includes(t))

  if (invalidTypes.length > 0) {
    throw new Error(
      `Invalid media types in SUPPORTED_MEDIA_TYPES: "${invalidTypes.join(', ')}"\n` +
        `  → Valid types: ${validTypes.join(', ')}`
    )
  }

  return types.length > 0 ? types : defaultTypes
}

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
const apiId = isTest ? 12345 : Number(process.env.API_ID)
if (!isTest && (!Number.isInteger(apiId) || apiId <= 0)) {
  throw new Error(
    `Invalid API_ID: "${process.env.API_ID}"\n` +
      `  → Must be a positive integer. Get from https://my.telegram.org/apps`
  )
}

export const config = Object.freeze({
  apiId,
  apiHash: isTest ? 'test-hash' : process.env.API_HASH,
  phone: isTest ? '+1234567890' : process.env.PHONE_NUMBER,
  botToken: isTest ? 'test-bot-token' : process.env.TELEGRAM_BOT_TOKEN,
  twoFactorPassword: process.env.TG_2FA_PASSWORD || '',

  source: isTest ? '@test-channel' : process.env.TG_SOURCE_CHANNEL,
  targets: isTest ? [-1001234567890] : parseTargets(process.env.TG_TARGETS),

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
  maxMediaBytes: validateMaxMediaBytes(process.env.MAX_MEDIA_BYTES),
  supportedMediaTypes: getSupportedMediaTypes(process.env.SUPPORTED_MEDIA_TYPES),
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
const isDev = process.env.NODE_ENV === 'development'

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
