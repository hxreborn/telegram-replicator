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

async function main() {
  logger.info('Telegram Replicator starting')

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

    // Wire up message pipeline: listener → filter → sender
    listener.on('message', async (msg) => {
      try {
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

    // Graceful shutdown handlers (best practice pattern)
    const shutdown = async (signal) => {
      logger.warn({ signal }, 'Initiating graceful shutdown')
      try {
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
