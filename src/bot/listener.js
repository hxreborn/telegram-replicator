import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import { TelegramClient } from 'telegram'
import { StringSession } from 'telegram/sessions/index.js'
import { NewMessage } from 'telegram/events/index.js'
import { logger } from '../config.js'

const SESSION_FILE = '.telegram-session'

/**
 * Creates a GramJS listener that emits 'message' events for messages from the source channel.
 * Returns an EventEmitter with additional methods: stop() and downloadMedia().
 *
 * @param {Object} options Configuration options
 * @param {number} options.apiId Telegram API ID
 * @param {string} options.apiHash Telegram API hash
 * @param {string} options.phone Phone number for authentication
 * @param {string} options.source Source channel username or ID
 * @param {string} [options.twoFactorPassword] Optional 2FA password
 * @returns {Promise<EventEmitter & { stop: Function, downloadMedia: Function }>}
 */
export async function createListener({ apiId, apiHash, phone, source, twoFactorPassword = '' }) {
  const emitter = new EventEmitter()

  // Load existing session or create empty
  const sessionPath = path.resolve(SESSION_FILE)
  let session = ''
  if (fs.existsSync(sessionPath)) {
    try {
      const stats = fs.statSync(sessionPath)
      // Ensure session file has correct permissions (owner read/write only)
      if (stats.mode & 0o077) {
        logger.warn(
          { file: SESSION_FILE, currentMode: stats.mode.toString(8) },
          'Session file has insecure permissions, fixing to 0600'
        )
        fs.chmodSync(sessionPath, 0o600)
      }
      session = fs.readFileSync(sessionPath, 'utf8')
    } catch (err) {
      logger.error({ err, file: SESSION_FILE }, 'Failed to read session file')
      throw new Error(`Cannot read session file: ${err.message}`)
    }
  }

  // Initialize Telegram client
  const client = new TelegramClient(new StringSession(session), apiId, apiHash, {
    connectionRetries: 5
  })

  // Authentication flow
  if (!session) {
    logger.info('No session found, starting authentication')
    await client.start({
      phoneNumber: phone,
      password: async () => {
        if (twoFactorPassword) {
          return twoFactorPassword
        }

        const envPassword = process.env.TG_2FA_PASSWORD
        if (envPassword) {
          return envPassword
        }

        // Prompt for 2FA if needed
        return new Promise((resolve) => {
          process.stdout.write('Enter 2FA password (press Enter to skip): ')
          process.stdin.once('data', (data) => resolve(data.toString().trim()))
        })
      },
      phoneCode: async () =>
        new Promise((resolve) => {
          process.stdout.write('Enter SMS code: ')
          process.stdin.once('data', (data) => resolve(data.toString().trim()))
        }),
      onError: (err) => logger.error({ err }, 'Authentication error')
    })
    const sessionData = client.session.save()
    fs.writeFileSync(sessionPath, sessionData, { mode: 0o600 })
    // Verify file was written with correct permissions
    const stats = fs.statSync(sessionPath)
    if (stats.mode & 0o077) {
      logger.error(
        { file: SESSION_FILE, currentMode: stats.mode.toString(8) },
        'Failed to set secure permissions on session file'
      )
      throw new Error('Security check failed: session file permissions are insecure')
    }
    logger.info({ file: SESSION_FILE }, 'Session saved')
    logger.warn('Session file contains auth token - keep it secure (chmod 600)')
  } else {
    await client.connect()
    logger.debug('Session restored from file')
  }

  // Get dialogs to ensure connection is ready
  await client.getDialogs({ limit: 1 })

  // Resolve source channel entity
  let channelId
  try {
    const entity = await client.getEntity(source)
    channelId = BigInt(entity.id)
    logger.info(
      {
        id: entity.id.toString(),
        username: entity.username,
        title: entity.title
      },
      'Source channel resolved'
    )
  } catch (err) {
    const hint = source.startsWith('@')
      ? `Ensure you're a member of ${source}, or use numeric ID (-100...)`
      : `Ensure the numeric ID is correct and you're a member`
    logger.error({ source, err }, 'Failed to resolve source channel')
    throw new Error(
      `Cannot find Telegram channel: ${source}\n` +
        `  → ${hint}\n` +
        `  → Original error: ${err.message}`
    )
  }

  // Attach event handler for new messages
  client.addEventHandler((event) => {
    const msg = event.message
    if (!msg) return

    // Check if message is from our source channel
    const msgChannelId = msg.peerId?.channelId
    if (msgChannelId && BigInt(msgChannelId) === channelId) {
      logger.debug(
        {
          msgId: msg.id,
          hasMedia: !!msg.media,
          text: (msg.message || msg.caption || '').slice(0, 50)
        },
        'Message received from source'
      )
      emitter.emit('message', msg)
    }
  }, new NewMessage({}))

  logger.info('Listener ready')

  // Return EventEmitter with additional methods
  return Object.assign(emitter, {
    /**
     * Disconnects the Telegram client
     */
    stop: async () => {
      logger.info('Stopping listener')
      await client.disconnect()
    },

    /**
     * Downloads media from a message
     * @param {Object} msg Message object
     * @param {number} maxBytes Maximum file size in bytes
     * @returns {Promise<Buffer|null>}
     */
    downloadMedia: async (msg, maxBytes) => {
      if (!msg.media) return null

      // Check size for documents
      const size = msg.media.document?.size
      if (size && BigInt(size) > BigInt(maxBytes)) {
        logger.debug({ msgId: msg.id, size }, 'Media exceeds size limit')
        return null
      }

      // Approximate size check for photos
      const photoSizes = msg.media.photo?.sizes ?? []
      if (photoSizes.length) {
        const possibleSizes = photoSizes
          .map((entry) => {
            if (typeof entry.size === 'number') return entry.size
            if (typeof entry.size === 'bigint') return Number(entry.size)
            if (typeof entry.bytes === 'number') return entry.bytes
            if (typeof entry.bytes === 'bigint') return Number(entry.bytes)
            return null
          })
          .filter((value) => Number.isFinite(value) && value > 0)

        if (possibleSizes.length) {
          const maxPhotoSize = Math.max(...possibleSizes)
          if (BigInt(maxPhotoSize) > BigInt(maxBytes)) {
            logger.debug({ msgId: msg.id, size: maxPhotoSize }, 'Photo exceeds size limit')
            return null
          }
        }
      }

      try {
        const buffer = await client.downloadMedia(msg, {})
        return Buffer.isBuffer(buffer) ? buffer : null
      } catch (err) {
        logger.error({ msgId: msg.id, err }, 'Media download failed')
        return null
      }
    }
  })
}
