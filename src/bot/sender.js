import { Telegraf } from 'telegraf'
import { logger, maskChatId } from '../config.js'
import { retryWithBackoff } from '../utils/retry.js'

const CAPTION_LIMIT = 1024
const MESSAGE_LIMIT = 4096
const DEFAULT_FLOOD_WAIT_SECONDS = 30

export async function createSender(token, targets) {
  const bot = new Telegraf(token)

  bot.catch((err) => logger.error({ err }, 'Uncaught bot error'))

  await bot.telegram.deleteWebhook({ drop_pending_updates: true })
  logger.debug('Webhook cleared')

  const info = await bot.telegram.getMe()
  logger.info({ username: info.username }, 'Sender bot ready')

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
              const result = await sendMedia(bot, chatId, media, mediaType, caption)
              cachedFileId = result
            } else {
              await sendCachedMedia(bot, chatId, cachedFileId, mediaType, caption)
            }

            for (const chunk of bodyChunks) {
              await bot.telegram.sendMessage(chatId, chunk, { parse_mode: 'HTML' })
            }
          } else {
            const chunks = splitIntoChunks(text, MESSAGE_LIMIT)
            for (const chunk of chunks) {
              await bot.telegram.sendMessage(chatId, chunk, { parse_mode: 'HTML' })
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
            } catch {
              // All retries exhausted, already logged by retry utility
            }
          } else {
            logger.error({ chatId: maskChatId(chatId), sourceId, err }, 'Failed to send message')
          }
        }
      }
    },

    stop: (signal) => {
      logger.info({ signal }, 'Stopping sender bot')
    }
  }
}

async function sendMedia(bot, chatId, buffer, type, caption) {
  const options = caption && caption.length > 0 ? { caption, parse_mode: 'HTML' } : undefined

  if (type === 'photo') {
    const result = await bot.telegram.sendPhoto(
      chatId,
      { source: buffer, filename: 'photo.jpg' },
      options
    )
    return result.photo?.at(-1)?.file_id
  } else if (type === 'video') {
    const result = await bot.telegram.sendVideo(
      chatId,
      { source: buffer, filename: 'video.mp4' },
      options
    )
    return result.video?.file_id
  } else if (type === 'audio') {
    const result = await bot.telegram.sendAudio(
      chatId,
      { source: buffer, filename: 'audio.mp3' },
      options
    )
    return result.audio?.file_id
  } else if (type === 'voice') {
    const result = await bot.telegram.sendVoice(
      chatId,
      { source: buffer, filename: 'voice.ogg' },
      options
    )
    return result.voice?.file_id
  } else if (type === 'document') {
    const result = await bot.telegram.sendDocument(
      chatId,
      { source: buffer, filename: 'file.bin' },
      options
    )
    return result.document?.file_id
  }
  return null
}

async function sendCachedMedia(bot, chatId, fileId, type, caption) {
  const options = caption && caption.length > 0 ? { caption, parse_mode: 'HTML' } : undefined

  if (type === 'photo') {
    await bot.telegram.sendPhoto(chatId, fileId, options)
  } else if (type === 'video') {
    await bot.telegram.sendVideo(chatId, fileId, options)
  } else if (type === 'audio') {
    await bot.telegram.sendAudio(chatId, fileId, options)
  } else if (type === 'voice') {
    await bot.telegram.sendVoice(chatId, fileId, options)
  } else if (type === 'document') {
    await bot.telegram.sendDocument(chatId, fileId, options)
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
