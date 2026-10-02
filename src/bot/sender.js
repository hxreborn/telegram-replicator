import { Telegraf } from 'telegraf'
import { logger, maskChatId, config } from '../config.js'
import { retryWithBackoff } from '../utils/retry.js'
import { createTelegrafAdapter } from './telegraf-adapter.js'

const CAPTION_LIMIT = 1024
const MESSAGE_LIMIT = 4096
const DEFAULT_FLOOD_WAIT_SECONDS = 30

const REPO_URL = config.githubRepoUrl
const DM_COOLDOWN_MS = config.dmCooldownSeconds * 1000
const userCooldowns = new Map()

// Media type adapters with Telegram API method configuration
const MEDIA_ADAPTERS = {
  photo: {
    method: 'sendPhoto',
    filename: 'photo.jpg',
    extractFileId: (result) => result.photo?.at(-1)?.file_id
  },
  video: {
    method: 'sendVideo',
    filename: 'video.mp4',
    extractFileId: (result) => result.video?.file_id
  },
  audio: {
    method: 'sendAudio',
    filename: 'audio.mp3',
    extractFileId: (result) => result.audio?.file_id
  },
  voice: {
    method: 'sendVoice',
    filename: 'voice.ogg',
    extractFileId: (result) => result.voice?.file_id
  },
  document: {
    method: 'sendDocument',
    filename: 'file.bin',
    extractFileId: (result) => result.document?.file_id
  }
}

export async function createSender(
  token,
  targets,
  { adapterFactory = createTelegrafAdapter } = {}
) {
  const bot = new Telegraf(token)

  bot.catch((err) => logger.error({ err }, 'Uncaught bot error'))

  const adapter = adapterFactory(bot)

  await adapter.deleteWebhook({ drop_pending_updates: true })
  logger.debug('Webhook cleared')

  const info = await adapter.getMe()
  logger.info({ username: info.username }, 'Sender bot ready')

  if (REPO_URL) {
    bot.on('message', (ctx) => {
      if (ctx.chat.type !== 'private') return

      const userId = ctx.from.id
      const now = Date.now()
      const lastResponse = userCooldowns.get(userId)

      if (lastResponse && now - lastResponse < DM_COOLDOWN_MS) {
        logger.debug({ userId }, 'DM ignored (cooldown)')
        return
      }

      userCooldowns.set(userId, now)
      logger.info({ userId }, 'Responding to DM')

      ctx
        .reply(
          `<b>🛡 LeakWatch ES - Automated Relay</b>\n\n` +
            `<i>NOTICE: This bot is a non-interactive instance of an open-source, event-driven message replicator. ` +
            `It is not configured to process inbound messages.</i>\n\n` +
            `<b>System Profile:</b>\n` +
            `• Status: Active [🟢] <code>444 (r--r--r--)</code>\n` +
            `• Powered by: <a href="${REPO_URL}">telegram-replicator</a>\n` +
            `• Developer: 👤 @hxreb0rn\n\n` +
            `<b>📂 Self-Hosting &amp; Source</b>\n` +
            `This project is fully open-source. You can find the source code and deployment guides to host your own instance on <a href="${REPO_URL}">GitHub</a>.`,
          { parse_mode: 'HTML', disable_web_page_preview: true }
        )
        .catch((err) => logger.error({ err, userId }, 'Failed to respond to DM'))

      const cleanupThreshold = now - DM_COOLDOWN_MS * 2
      for (const [id, timestamp] of userCooldowns) {
        if (timestamp < cleanupThreshold) userCooldowns.delete(id)
      }
    })

    bot.launch()
    logger.info('DM responder active')
  }

  return {
    /**
     * Sends a message (with optional media) to all configured targets
     * @param {Object} data Message data
     * @param {string} data.text HTML-formatted text
     * @param {Buffer} [data.media] Media buffer
     * @param {string} [data.mediaType] 'photo' or 'document'
     * @param {string} data.sourceId Original message identifier for logging
     */
    async send({ text, media, mediaType, sourceId }) {
      let cachedFileId = null

      for (const chatId of targets) {
        const sendToTarget = async () => {
          if (media && mediaType) {
            const caption = text.length <= CAPTION_LIMIT ? text : text.slice(0, CAPTION_LIMIT)

            const bodyChunks =
              text.length > CAPTION_LIMIT
                ? splitIntoChunks(text.slice(CAPTION_LIMIT), MESSAGE_LIMIT)
                : []

            if (!cachedFileId) {
              const result = await sendMedia(adapter, chatId, media, mediaType, caption)
              if (!result) {
                logger.warn(
                  { chatId: maskChatId(chatId), mediaType },
                  'Media upload returned no file_id'
                )
              }
              cachedFileId = result
            } else {
              await sendCachedMedia(adapter, chatId, cachedFileId, mediaType, caption)
            }

            for (const chunk of bodyChunks) {
              await adapter.sendMessage(chatId, chunk, { parse_mode: 'HTML' })
            }
          } else {
            const chunks = splitIntoChunks(text, MESSAGE_LIMIT)
            for (const chunk of chunks) {
              await adapter.sendMessage(chatId, chunk, { parse_mode: 'HTML' })
            }
          }
        }

        try {
          await sendToTarget()
          logger.info({ chatId: maskChatId(chatId), sourceId }, 'Message sent')
        } catch (err) {
          const retryAfterParam =
            err.parameters?.retry_after ?? err.response?.parameters?.retry_after

          let retryAfter =
            typeof retryAfterParam === 'number' && retryAfterParam > 0 ? retryAfterParam : null

          if (!retryAfter && (err.response?.error_code === 429 || err.code === 429)) {
            retryAfter = DEFAULT_FLOOD_WAIT_SECONDS
          }

          if (retryAfter) {
            try {
              await retryWithBackoff({
                fn: sendToTarget,
                initialRetryAfter: retryAfter,
                context: { chatId, sourceId }
              })
            } catch (retryErr) {
              logger.error(
                { chatId: maskChatId(chatId), sourceId, err: retryErr },
                'Failed to send message after exhausting retries'
              )
            }
          } else {
            logger.error({ chatId: maskChatId(chatId), sourceId, err }, 'Failed to send message')
          }
        }
      }
    },

    stop: (signal) => {
      logger.info({ signal }, 'Stopping sender bot')
      if (REPO_URL) {
        bot.stop(signal)
      }
    }
  }
}

async function sendMedia(adapter, chatId, buffer, type, caption) {
  const options = caption && caption.length > 0 ? { caption, parse_mode: 'HTML' } : undefined
  const config = MEDIA_ADAPTERS[type]

  if (!config) return null

  const result = await adapter[config.method](
    chatId,
    { source: buffer, filename: config.filename },
    options
  )
  return config.extractFileId(result)
}

async function sendCachedMedia(adapter, chatId, fileId, type, caption) {
  if (!fileId) {
    throw new Error(`Cannot send cached media: fileId is ${fileId}`)
  }

  const options = caption && caption.length > 0 ? { caption, parse_mode: 'HTML' } : undefined
  const config = MEDIA_ADAPTERS[type]

  if (config) {
    await adapter[config.method](chatId, fileId, options)
  }
}

export function splitIntoChunks(text, limit) {
  const chunks = []
  let start = 0

  while (start < text.length) {
    let end = start + limit

    if (end >= text.length) {
      chunks.push(text.slice(start))
      break
    }

    const chunk = text.slice(start, end)
    const lastSpace = chunk.lastIndexOf(' ')

    if (lastSpace > 0) {
      chunks.push(text.slice(start, start + lastSpace))
      start += lastSpace + 1
    } else {
      // No space found - force break (long URL, base64, etc.)
      chunks.push(chunk)
      start = end
    }
  }

  return chunks
}
