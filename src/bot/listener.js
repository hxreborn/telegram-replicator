import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import { TelegramClient } from 'telegram'
import { StringSession } from 'telegram/sessions/index.js'
import { NewMessage } from 'telegram/events/index.js'
import { logger } from '../config.js'

const SESSION_FILE = '.telegram-session'
const CONNECTION_RETRIES = 5
const CONNECTION_CHECK_INTERVAL_MS = 30000

export async function createListener({
  apiId,
  apiHash,
  phone,
  sources,
  twoFactorPassword = ''
}) {
  const emitter = new EventEmitter()

  if (!Array.isArray(sources) || sources.length === 0) {
    throw new Error('createListener requires at least one source channel')
  }

  const sessionPath = path.resolve(SESSION_FILE)
  let session = ''
  if (fs.existsSync(sessionPath)) {
    try {
      const stats = fs.statSync(sessionPath)
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

  const client = new TelegramClient(new StringSession(session), apiId, apiHash, {
    connectionRetries: CONNECTION_RETRIES
  })

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

  const channelMap = new Map()

  for (const input of sources) {
    try {
      const entity = await client.getEntity(input)
      const channelId = BigInt(entity.id)
      const username = entity.username ? `@${entity.username}` : null
      const label = username || entity.title || input

      if (channelMap.has(channelId)) {
        logger.warn(
          {
            channelId: channelId.toString(),
            duplicatedInput: input,
            existingInput: channelMap.get(channelId).input
          },
          'Duplicate source channel detected; reusing existing entry'
        )
        continue
      }

      const sourceInfo = {
        id: channelId,
        input,
        label,
        title: entity.title || null,
        username: username
      }

      channelMap.set(channelId, sourceInfo)

      logger.info(
        {
          id: channelId.toString(),
          username: sourceInfo.username,
          title: sourceInfo.title,
          input
        },
        'Source channel resolved'
      )
    } catch (err) {
      const startsWithAt = typeof input === 'string' && input.startsWith('@')
      const hint = startsWithAt
        ? `Ensure you're a member of ${input}, or use numeric ID (-100...)`
        : `Ensure the numeric ID is correct and you're a member`
      logger.error({ source: input, err }, 'Failed to resolve source channel')
      throw new Error(
        `Cannot find Telegram channel: ${input}\n` +
          `  → ${hint}\n` +
          `  → Original error: ${err.message}`
      )
    }
  }

  client.addEventHandler((event) => {
    const msg = event.message
    if (!msg) return

    const msgChannelId = msg.peerId?.channelId
    if (msgChannelId !== undefined && msgChannelId !== null) {
      let lookupId
      if (typeof msgChannelId === 'bigint') {
        lookupId = msgChannelId
      } else if (typeof msgChannelId === 'number') {
        lookupId = BigInt(msgChannelId)
      } else if (typeof msgChannelId === 'string') {
        lookupId = BigInt(msgChannelId)
      } else {
        return
      }

      const sourceInfo = channelMap.get(lookupId)
      if (!sourceInfo) {
        return
      }

      logger.debug(
        {
          msgId: msg.id,
          hasMedia: !!msg.media,
          text: (msg.message || msg.caption || '').slice(0, 50),
          source: sourceInfo.label
        },
        'Message received from source'
      )
      emitter.emit('message', { message: msg, source: sourceInfo })
    }
  }, new NewMessage({}))

  // Handle connection state changes - exit on disconnect to let PM2 restart
  client.on('disconnected', () => {
    logger.error('GramJS connection lost, exiting for clean restart')
    process.exit(1)
  })

  // Additional connection state monitoring
  const connectionState = client._connection?.state
  if (connectionState !== undefined) {
    const checkConnection = setInterval(() => {
      if (!client.connected) {
        logger.error('Connection check failed - client not connected, exiting')
        clearInterval(checkConnection)
        process.exit(1)
      }
    }, CONNECTION_CHECK_INTERVAL_MS)

    emitter.once('stop', () => clearInterval(checkConnection))
  }

  logger.info({ sourceCount: channelMap.size }, 'Listener ready')

  return Object.assign(emitter, {
    stop: async () => {
      logger.info('Stopping listener')
      emitter.emit('stop')
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
