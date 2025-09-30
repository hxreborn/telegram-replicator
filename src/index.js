import { config, logger, maskChatId } from './config.js'
import { createListener } from './bot/listener.js'
import { createSender } from './bot/sender.js'
import { filterMessage } from './bot/middleware/filter.js'

/**
 * Telegram Message Replicator
 *
 * Event-driven daemon that:
 * 1. Listens to messages from a source Telegram channel (via GramJS)
 * 2. Filters and transforms messages based on regex patterns
 * 3. Forwards filtered messages to multiple target chats (via Telegraf Bot API)
 */

// Message deduplication cache with TTL
const processedMessages = new Set()
const CLEANUP_INTERVAL = 60 * 60 * 1000 // 1 hour
const MESSAGE_TTL = 60 * 60 * 1000 // 1 hour
const messageTimestamps = new Map()

// Cleanup old message IDs to prevent memory leaks
function cleanupOldMessages() {
  const now = Date.now()
  for (const [msgId, timestamp] of messageTimestamps.entries()) {
    if (now - timestamp > MESSAGE_TTL) {
      processedMessages.delete(msgId)
      messageTimestamps.delete(msgId)
    }
  }
  logger.debug(
    {
      cachedCount: processedMessages.size,
      cleanedUp: messageTimestamps.size
    },
    'Message cache cleanup completed'
  )
}

// Check if message was already processed
function isMessageProcessed(msgId) {
  if (processedMessages.has(msgId)) {
    return true
  }

  // Mark as processed
  processedMessages.add(msgId)
  messageTimestamps.set(msgId, Date.now())
  return false
}

async function main() {
  logger.info('Telegram Replicator starting')

  // Log comprehensive configuration summary
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

  // Security warnings for sensitive settings
  if (config.logLevel === 'debug') {
    logger.warn('Debug logging enabled - sensitive information may be logged')
  }

  try {
    // Initialize sender (Telegraf bot)
    const sender = await createSender(config.botToken, config.targets)
    logger.info({ targets: config.targets.map(maskChatId) }, 'Targets configured')

    // Initialize listener (GramJS user client)
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

    // Start cleanup interval for message deduplication
    const cleanupInterval = setInterval(cleanupOldMessages, CLEANUP_INTERVAL)

    // Initialize deduplication statistics
    let duplicateCount = 0

    // Wire up message pipeline: listener → filter → sender
    listener.on('message', async (msg) => {
      try {
        // Check for duplicate messages
        if (isMessageProcessed(msg.id)) {
          duplicateCount++
          logger.debug({ msgId: msg.id, duplicateCount }, 'Duplicate message ignored')
          return
        }

        // Filter and transform message
        const filtered = filterMessage(msg, config)
        if (!filtered) return

        // Download media if present
        let mediaBuffer = null
        if (filtered.mediaType) {
          mediaBuffer = await listener.downloadMedia(msg, config.maxMediaBytes)
          if (!mediaBuffer) {
            logger.debug({ msgId: msg.id }, 'Media download failed or size exceeded')
            return
          }
        }

        // Send to all targets
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

    // Log deduplication stats periodically
    const statsInterval = setInterval(() => {
      logger.info(
        {
          processedCount: processedMessages.size,
          duplicateCount,
          cacheSize: processedMessages.size
        },
        'Message processing statistics'
      )
    }, 5 * 60 * 1000) // Every 5 minutes

    // Graceful shutdown handlers (best practice pattern)
    const shutdown = async (signal) => {
      logger.warn({ signal }, 'Initiating graceful shutdown')
      try {
        clearInterval(cleanupInterval)
        clearInterval(statsInterval)

        logger.info(
          {
            totalProcessed: processedMessages.size,
            duplicateCount,
            cacheSize: processedMessages.size
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
