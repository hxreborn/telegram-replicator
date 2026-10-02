import 'dotenv/config'
import pino from 'pino'
import caller from 'pino-caller'

const REQUIRED_VARS = {
  API_ID: 'Get from https://my.telegram.org/apps',
  API_HASH: 'Get from https://my.telegram.org/apps',
  PHONE_NUMBER: 'User account phone in E.164 format (e.g., +1234567890)',
  TELEGRAM_BOT_TOKEN: 'Get from @BotFather on Telegram',
  TG_SOURCE_CHANNEL:
    'Channel usernames (comma-separated, e.g., @channel1,@channel2) or numeric IDs',
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

const BYTES_PER_KB = 1024
const KB_PER_MB = 1024
const DEFAULT_MAX_MEDIA_MB = 10

function validateMaxMediaBytes(envValue) {
  const defaultValue = DEFAULT_MAX_MEDIA_MB * KB_PER_MB * BYTES_PER_KB

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

  const validTypes = ['photo', 'document', 'video', 'audio', 'voice']
  const invalidTypes = types.filter((t) => !validTypes.includes(t))

  if (invalidTypes.length > 0) {
    throw new Error(
      `Invalid media types in SUPPORTED_MEDIA_TYPES: "${invalidTypes.join(', ')}"\n` +
        `  → Valid types: ${validTypes.join(', ')}`
    )
  }

  return types.length > 0 ? types : defaultTypes
}

function parseSources(sourceStr) {
  const sources = sourceStr
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0)

  if (sources.length === 0) {
    throw new Error(
      'TG_SOURCE_CHANNEL cannot be empty\n  → Provide at least one channel username or numeric ID'
    )
  }

  return sources
}

function parseTargets(targetsStr) {
  const ids = targetsStr
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .map((t) => {
      // Validate it's a valid integer string
      if (!/^-?\d+$/.test(t)) {
        throw new Error(
          `Invalid chat ID in TG_TARGETS: "${t}"\n` +
            `  → Must be numeric. Use /getid bots to find chat IDs.`
        )
      }
      // Check if it's negative (groups/channels must be negative)
      if (!t.startsWith('-')) {
        throw new Error(
          `Invalid chat ID in TG_TARGETS: ${t}\n` +
            `  → Group/channel IDs must be negative (e.g., -1001234567890)`
        )
      }
      return t
    })

  if (ids.length === 0) {
    throw new Error(`TG_TARGETS cannot be empty\n` + `  → Provide at least one chat ID`)
  }

  return ids
}

const apiId = isTest ? 12345 : Number(process.env.API_ID)
if (!isTest && (!Number.isInteger(apiId) || apiId <= 0)) {
  throw new Error(
    `Invalid API_ID: "${process.env.API_ID}"\n` +
      `  → Must be a positive integer. Get from https://my.telegram.org/apps`
  )
}

const sources = Object.freeze(
  isTest ? ['@test-channel'] : parseSources(process.env.TG_SOURCE_CHANNEL)
)

export const config = Object.freeze({
  apiId,
  apiHash: isTest ? 'test-hash' : process.env.API_HASH,
  phone: isTest ? '+1234567890' : process.env.PHONE_NUMBER,
  botToken: isTest ? 'test-bot-token' : process.env.TELEGRAM_BOT_TOKEN,
  twoFactorPassword: process.env.TG_2FA_PASSWORD || '',

  sources,
  // Backwards compatibility for older imports expecting single source
  source: sources[0],
  targets: isTest ? ['-1001234567890'] : parseTargets(process.env.TG_TARGETS),

  // Optional configuration (compiled regex)
  filterRegex: compileRegex(
    process.env.FILTER_REGEX ||
      'tech|technology|announcement|news|update|cyber|alert|breach|threat',
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
  logLevel: isTest ? 'silent' : process.env.LOG_LEVEL || 'info',

  githubRepoUrl: process.env.GITHUB_REPO_URL || '',
  dmCooldownSeconds: Number(process.env.DM_COOLDOWN_SECONDS) || 300
})

/**
 * Masks chat ID to prevent leaking private group IDs in logs
 * @param {number|string} chatId Telegram chat ID
 * @returns {string} Masked ID showing only last 4 digits
 */
export function maskChatId(chatId) {
  const idStr = String(chatId)
  return idStr.length > 4 ? `...${idStr.slice(-4)}` : idStr
}

const isDev = process.env.NODE_ENV === 'development'

const SENSITIVE_LOG_PATHS = Object.freeze([
  'botToken',
  'apiHash',
  'phone',
  'twoFactorPassword',
  'TG_2FA_PASSWORD',
  'headers.authorization',
  'request.headers.authorization',
  'response.config.headers.authorization',
  'err.config.headers.authorization',
  'err.request.headers.authorization',
  'err.response.config.headers.authorization'
])

export const logger = caller(
  pino({
    level: config.logLevel,
    redact: {
      paths: SENSITIVE_LOG_PATHS,
      remove: true
    },
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
