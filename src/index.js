import {
  config as baseConfig,
  logger as baseLogger,
  maskChatId as baseMaskChatId
} from './config.js'
import { createListener as baseCreateListener } from './bot/listener.js'
import { createSender as baseCreateSender } from './bot/sender.js'
import { filterMessage as baseFilterMessage } from './bot/middleware/filter.js'

export async function main({
  config = baseConfig,
  logger = baseLogger,
  maskChatId = baseMaskChatId,
  createListener = baseCreateListener,
  createListenerOverrides,
  createSender = baseCreateSender,
  filterMessage = baseFilterMessage,
  nodeProcess = globalThis.process
} = {}) {
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
    const sender = await createSender(config.botToken, config.targets, {})
    logger.info({ targets: config.targets.map(maskChatId) }, 'Targets configured')

    const listener = await createListener(
      {
        apiId: config.apiId,
        apiHash: config.apiHash,
        phone: config.phone,
        sources: config.sources,
        twoFactorPassword: config.twoFactorPassword
      },
      createListenerOverrides
    )

    logger.info(
      {
        sources: config.sources,
        filterRegex: config.filterRegex,
        stripRegex: config.stripRegex
      },
      'Filters configured'
    )

    // In-memory deduplication: tracks last seen message ID per source
    // LIMITATION: State is lost on restart → duplicates may be replicated after restart
    // For production: consider file-backed persistence or external state store
    const lastMessageId = new Map()

    listener.on('message', async ({ message: msg, source }) => {
      try {
        const lastSeen = lastMessageId.get(source.id)
        if (lastSeen !== undefined && msg.id <= lastSeen) {
          logger.debug({ msgId: msg.id, source: source.label, lastSeen }, 'Duplicate message')
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
          sourceId: `${source.label}#${filtered.sourceId}`
        })

        lastMessageId.set(source.id, msg.id)
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
        nodeProcess.exit(0)
      } catch (err) {
        logger.error({ err }, 'Error during shutdown')
        nodeProcess.exit(1)
      }
    }

    nodeProcess.once('SIGINT', () => shutdown('SIGINT'))
    nodeProcess.once('SIGTERM', () => shutdown('SIGTERM'))
  } catch (error) {
    logger.error({ err: error }, 'Fatal error during bootstrap')
    nodeProcess.exit(1)
  }
}

if (process.env.NODE_ENV !== 'test') {
  main()
}
