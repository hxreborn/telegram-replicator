import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import { TelegramClient } from 'telegram'
import { StringSession } from 'telegram/sessions/index.js'
import { NewMessage } from 'telegram/events/index.js'
import { logger as baseLogger } from '../config.js'

const SESSION_FILE = '.telegram-session'
const CONNECTION_RETRIES = 5
const CONNECTION_CHECK_INTERVAL_MS = 30000

/**
 * Safely converts various channelId types to BigInt
 * Handles GramJS's polymorphic channelId representation
 * @param {bigint|number|string|object} channelId - Channel ID in various formats
 * @returns {bigint|null} BigInt representation or null if conversion fails
 */
function toBigIntSafe(channelId) {
  if (channelId === undefined || channelId === null) {
    return null
  }

  if (typeof channelId === 'bigint') {
    return channelId
  }

  if (typeof channelId === 'number') {
    return BigInt(channelId)
  }

  if (typeof channelId === 'string') {
    try {
      return BigInt(channelId)
    } catch {
      return null
    }
  }

  // GramJS sometimes returns channelId as object with toString()
  if (typeof channelId === 'object' && typeof channelId.toString === 'function') {
    try {
      return BigInt(channelId.toString())
    } catch {
      return null
    }
  }

  return null
}

export async function createListener(
  { apiId, apiHash, phone, sources, twoFactorPassword = '' },
  {
    clientFactory,
    sessionFile = SESSION_FILE,
    fs: fsModule = fs,
    logger: overrideLogger,
    process: proc = process,
    eventClass = NewMessage
  } = {}
) {
  const log = overrideLogger ?? baseLogger
  const emitter = new EventEmitter()

  if (!Array.isArray(sources) || sources.length === 0) {
    throw new Error('createListener requires at least one source channel')
  }

  const sessionPath = path.resolve(sessionFile)
  let session = ''
  if (fsModule.existsSync(sessionPath)) {
    try {
      const stats = fsModule.statSync(sessionPath)
      if (stats.mode & 0o077) {
        log.warn(
          { file: sessionFile, currentMode: stats.mode.toString(8) },
          'Session file has insecure permissions, fixing to 0600'
        )
        fsModule.chmodSync(sessionPath, 0o600)
      }
      session = fsModule.readFileSync(sessionPath, 'utf8')
    } catch (err) {
      log.error({ err, file: sessionFile }, 'Failed to read session file')
      throw new Error(`Cannot read session file: ${err.message}`)
    }
  }

  const defaultClientFactory = (sessionString) =>
    new TelegramClient(new StringSession(sessionString), apiId, apiHash, {
      connectionRetries: CONNECTION_RETRIES
    })

  const client = (clientFactory ?? defaultClientFactory)(session)

  if (!session) {
    log.info('No session found, starting authentication')
    await client.start({
      phoneNumber: phone,
      password: async () => {
        if (twoFactorPassword) {
          return twoFactorPassword
        }

        const envPassword = proc.env?.TG_2FA_PASSWORD
        if (envPassword) {
          return envPassword
        }

        return new Promise((resolve) => {
          proc.stdout?.write?.('Enter 2FA password (press Enter to skip): ')
          proc.stdin?.once?.('data', (data) => resolve(data.toString().trim()))
        })
      },
      phoneCode: async () =>
        new Promise((resolve) => {
          proc.stdout?.write?.('Enter SMS code: ')
          proc.stdin?.once?.('data', (data) => resolve(data.toString().trim()))
        }),
      onError: (err) => log.error({ err }, 'Authentication error')
    })
    const sessionData = client.session.save()
    fsModule.writeFileSync(sessionPath, sessionData, { mode: 0o600 })
    const stats = fsModule.statSync(sessionPath)
    if (stats.mode & 0o077) {
      log.error(
        { file: sessionFile, currentMode: stats.mode.toString(8) },
        'Failed to set secure permissions on session file'
      )
      throw new Error('Security check failed: session file permissions are insecure')
    }
    log.info({ file: sessionFile }, 'Session saved')
    log.warn('Session file contains auth token - keep it secure (chmod 600)')
  } else {
    await client.connect()
    log.debug('Session restored from file')
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
        log.warn(
          {
            channelId: channelId.toString(),
            duplicatedInput: input,
            existingLabel: channelMap.get(channelId).label
          },
          'Duplicate source channel detected; reusing existing entry'
        )
        continue
      }

      const isVerified = Boolean(entity.verified)
      const isScam = Boolean(entity.scam)
      const isFake = Boolean(entity.fake)

      log.info(
        {
          id: channelId.toString(),
          username,
          title: entity.title || null,
          input,
          verified: isVerified,
          scam: isScam,
          fake: isFake
        },
        'Source channel resolved'
      )

      if (isScam || isFake) {
        log.error(
          {
            id: channelId.toString(),
            input,
            title: entity.title || null,
            scam: isScam,
            fake: isFake
          },
          'Source channel flagged by Telegram metadata; review before replicating'
        )
      } else if (!isVerified) {
        log.warn(
          {
            id: channelId.toString(),
            input,
            title: entity.title || null
          },
          'Source channel is not verified; confirm authenticity before replicating'
        )
      }

      channelMap.set(channelId, {
        id: channelId,
        input,
        label
      })
    } catch (err) {
      const startsWithAt = typeof input === 'string' && input.startsWith('@')
      const hint = startsWithAt
        ? `Ensure you're a member of ${input}, or use numeric ID (-100...)`
        : `Ensure the numeric ID is correct and you're a member`
      log.error({ source: input, err }, 'Failed to resolve source channel')
      throw new Error(
        `Cannot find Telegram channel: ${input}\n` +
          `  → ${hint}\n` +
          `  → Original error: ${err.message}`
      )
    }
  }

  client.addEventHandler((event) => {
    const msg = event.message
    if (!msg) {
      log.debug({ event: event.className }, 'Event received without message')
      return
    }

    log.debug(
      {
        msgId: msg.id,
        peerId: msg.peerId,
        channelId: msg.peerId?.channelId,
        channelIdType: typeof msg.peerId?.channelId
      },
      'Raw event received'
    )

    const msgChannelId = msg.peerId?.channelId
    const lookupId = toBigIntSafe(msgChannelId)

    if (!lookupId) {
      if (msgChannelId !== undefined && msgChannelId !== null) {
        log.debug({ msgChannelId, type: typeof msgChannelId }, 'Failed to convert channelId to BigInt')
      }
      return
    }

    const sourceInfo = channelMap.get(lookupId)
    if (!sourceInfo) {
      return
    }

    log.debug(
      {
        msgId: msg.id,
        hasMedia: !!msg.media,
        text: (msg.message || msg.caption || '').slice(0, 50),
        source: sourceInfo.label
      },
      'Message received from source'
    )
    emitter.emit('message', { message: msg, source: sourceInfo })
  }, new eventClass({}))

  // Handle connection state changes - exit on disconnect to let PM2 restart
  client.on('disconnected', () => {
    log.error('GramJS connection lost, exiting for clean restart')
    proc.exit?.(1)
  })

  // Additional connection state monitoring
  // NOTE: Accessing client._connection is a private API, may break in future GramJS versions
  // Wrapped in try-catch for graceful degradation
  try {
    const connectionState = client._connection?.state
    if (connectionState !== undefined) {
      const checkConnection = setInterval(() => {
        if (!client.connected) {
          log.error('Connection check failed - client not connected, exiting')
          clearInterval(checkConnection)
          proc.exit?.(1)
        }
      }, CONNECTION_CHECK_INTERVAL_MS)

      emitter.once('stop', () => clearInterval(checkConnection))
    }
  } catch (err) {
    log.warn({ err }, 'Failed to setup connection monitoring (private API unavailable)')
  }

  log.info({ sourceCount: channelMap.size }, 'Listener ready')

  return Object.assign(emitter, {
    stop: async () => {
      log.info('Stopping listener')
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
        log.debug({ msgId: msg.id, size }, 'Media exceeds size limit')
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
            log.debug({ msgId: msg.id, size: maxPhotoSize }, 'Photo exceeds size limit')
            return null
          }
        }
      }

      try {
        const buffer = await client.downloadMedia(msg, {})
        if (!Buffer.isBuffer(buffer)) return null

        // Verify actual size after download (metadata can be inaccurate)
        if (buffer.length > maxBytes) {
          log.debug(
            { msgId: msg.id, actualSize: buffer.length, limit: maxBytes },
            'Media exceeds size limit after download'
          )
          return null
        }

        return buffer
      } catch (err) {
        log.error({ msgId: msg.id, err }, 'Media download failed')
        return null
      }
    }
  })
}
