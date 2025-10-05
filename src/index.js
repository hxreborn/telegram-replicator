import { config, logger, maskChatId } from './config.js'
import { createListener } from './bot/listener.js'
import { createSender } from './bot/sender.js'
import { filterMessage } from './bot/middleware/filter.js'

async function main() {
  logger.info('Telegram Replicator starting')

  logger.info(
    {
      sources: config.sources,
      sourceCount: config.sources.length,
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
      sources: config.sources,
      twoFactorPassword: config.twoFactorPassword
    })

    logger.info(
      {
        sources: config.sources,
        filterRegex: config.filterRegex,
        stripRegex: config.stripRegex
      },
      'Filters configured'
    )

    listener.on('message', async ({ message: msg, source }) => {
      try {
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
          sourceId: `${source.label}#${filtered.sourceId}`
        })
      } catch (err) {
        logger.error({ err, msgId: msg?.id }, 'Error processing message')
      }
    })

    logger.info('Replicator active - listening for messages')

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
