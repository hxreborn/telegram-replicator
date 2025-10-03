import { config, logger, maskChatId } from './config.js'
import { createListener } from './bot/listener.js'
import { createSender } from './bot/sender.js'
import { filterMessage } from './bot/middleware/filter.js'
import { LRUCache } from './utils/lru-cache.js'

const MESSAGE_TTL_MS = 60 * 60 * 1000
const MESSAGE_CACHE_MAX_SIZE = 1000
const STATS_INTERVAL_MS = 5 * 60 * 1000

const messageCache = new LRUCache({ maxSize: MESSAGE_CACHE_MAX_SIZE, ttl: MESSAGE_TTL_MS })

function isMessageProcessed(msgId) {
  if (messageCache.has(msgId)) {
    return true
  }

  messageCache.set(msgId, true)
  return false
}

async function main() {
  logger.info('Telegram Replicator starting')

  logger.info(
    {
      source: config.source,
      targets: config.targets.map(maskChatId),
      targetCount: config.targets.length,
      filterRegex: config.filterRegex.source,
      stripRegex: config.stripRegex.source,
      maxMediaBytes: config.maxMediaBytes,
      logLevel: config.logLevel,
      twoFactorEnabled: !!config.twoFactorPassword
    },
    'Configuration loaded'
  )

  if (config.logLevel === 'debug') {
    logger.warn('Debug logging enabled - sensitive information may be logged')
  }

  try {
    const sender = await createSender(config.botToken, config.targets)
    logger.info({ targets: config.targets.map(maskChatId) }, 'Targets configured')

    const listener = await createListener({
      apiId: config.apiId,
      apiHash: config.apiHash,
      phone: config.phone,
      source: config.source,
      twoFactorPassword: config.twoFactorPassword
    })

    logger.info(
      {
        source: config.source,
        filterRegex: config.filterRegex,
        stripRegex: config.stripRegex
      },
      'Filters configured'
    )

    const cleanupInterval = setInterval(() => {
      const stats = messageCache.cleanup()
      logger.debug({ ...stats }, 'Message cache cleanup completed')
    }, MESSAGE_TTL_MS)

    let duplicateCount = 0

    // Wire up message pipeline: listener → filter → sender
    listener.on('message', async (msg) => {
      try {
        if (isMessageProcessed(msg.id)) {
          duplicateCount++
          logger.debug({ msgId: msg.id, duplicateCount }, 'Duplicate message ignored')
          return
        }

        const filtered = filterMessage(msg, config)
        if (!filtered) return

        let mediaBuffer = null
        if (filtered.mediaType) {
          mediaBuffer = await listener.downloadMedia(msg, config.maxMediaBytes)
          if (!mediaBuffer) {
            logger.debug({ msgId: msg.id }, 'Media download failed or size exceeded')
            return
          }
        }

        await sender.send({
          text: filtered.text,
          media: mediaBuffer,
          mediaType: filtered.mediaType,
          sourceId: filtered.sourceId
        })
      } catch (err) {
        logger.error({ err, msgId: msg?.id }, 'Error processing message')
      }
    })

    logger.info('Replicator active - listening for messages')

    const statsInterval = setInterval(() => {
      logger.info(
        {
          processedCount: messageCache.size,
          duplicateCount,
          cacheSize: messageCache.size
        },
        'Message processing statistics'
      )
    }, STATS_INTERVAL_MS)

    // Graceful shutdown handlers (best practice pattern)
    const shutdown = async (signal) => {
      logger.warn({ signal }, 'Initiating graceful shutdown')
      try {
        clearInterval(cleanupInterval)
        clearInterval(statsInterval)

        logger.info(
          {
            totalProcessed: messageCache.size,
            duplicateCount,
            cacheSize: messageCache.size
          },
          'Final deduplication statistics'
        )

        await listener.stop()
        sender.stop(signal)
        logger.info('Shutdown complete')
        process.exit(0)
      } catch (err) {
        logger.error({ err }, 'Error during shutdown')
        process.exit(1)
      }
    }

    process.once('SIGINT', () => shutdown('SIGINT'))
    process.once('SIGTERM', () => shutdown('SIGTERM'))
  } catch (error) {
    logger.error({ err: error }, 'Fatal error during bootstrap')
    process.exit(1)
  }
}

main()
