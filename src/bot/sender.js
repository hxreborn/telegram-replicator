import { Telegraf } from 'telegraf'
import { logger, maskChatId } from '../config.js'

const CAPTION_LIMIT = 1024
const MESSAGE_LIMIT = 4096

/**
 * Creates a Telegraf bot sender that can send messages and media to multiple targets.
 * Handles text chunking, media upload caching, and flood-wait retries.
 *
 * @param {string} token Bot API token
 * @param {number[]} targets Array of target chat IDs
 * @returns {Promise<{ send: Function, stop: Function }>}
 */
export async function createSender(token, targets) {
  const bot = new Telegraf(token)

  // Global error handler
  bot.catch((err) => logger.error({ err }, 'Uncaught bot error'))

  // Clear any existing webhook
  await bot.telegram.deleteWebhook({ drop_pending_updates: true })
  logger.debug('Webhook cleared')

  // Launch bot in long-polling mode
  await bot.launch({
    dropPendingUpdates: true
  })

  const info = await bot.telegram.getMe()
  logger.info({ username: info.username }, 'Sender bot ready')

  return {
    /**
     * Sends a message (with optional media) to all configured targets
     * @param {Object} data Message data
     * @param {string} data.text HTML-formatted text
     * @param {Buffer} [data.media] Media buffer
     * @param {string} [data.mediaType] 'photo' or 'document'
     * @param {number} data.sourceId Original message ID for logging
     */
    async send({ text, media, mediaType, sourceId }) {
      let cachedFileId = null

      for (const chatId of targets) {
        const sendToTarget = async () => {
          if (media && mediaType) {
            // Split text into caption and body
            const caption = text.length <= CAPTION_LIMIT ? text : text.slice(0, CAPTION_LIMIT)

            const bodyChunks =
              text.length > CAPTION_LIMIT
                ? splitIntoChunks(text.slice(CAPTION_LIMIT), MESSAGE_LIMIT)
                : []

            // Send media (upload first time, reuse after)
            if (!cachedFileId) {
              const result = await sendMedia(bot, chatId, media, mediaType, caption)
              cachedFileId = result
            } else {
              await sendCachedMedia(bot, chatId, cachedFileId, mediaType, caption)
            }

            // Send remaining text chunks
            for (const chunk of bodyChunks) {
              await bot.telegram.sendMessage(chatId, chunk, { parse_mode: 'HTML' })
            }
          } else {
            // Text only - split into chunks
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
          // Check for rate limit (FLOOD_WAIT)
          const retryAfterParam =
            err.parameters?.retry_after ?? err.response?.parameters?.retry_after

          let retryAfter =
            typeof retryAfterParam === 'number' && retryAfterParam > 0 ? retryAfterParam : null

          if (!retryAfter && (err.response?.error_code === 429 || err.code === 429)) {
            retryAfter = 30
          }

          if (retryAfter) {
            const clamped = Math.min(retryAfter, 60)
            logger.warn(
              { chatId: maskChatId(chatId), retryAfter: clamped },
              `Rate limited, retrying after ${clamped}s`
            )
            await new Promise((resolve) => setTimeout(resolve, clamped * 1000))

            try {
              await sendToTarget()
              logger.info({ chatId: maskChatId(chatId), sourceId }, 'Message sent (after retry)')
            } catch (retryErr) {
              logger.error(
                { chatId: maskChatId(chatId), sourceId, err: retryErr },
                'Failed after retry'
              )
            }
          } else {
            logger.error({ chatId: maskChatId(chatId), sourceId, err }, 'Failed to send message')
          }
        }
      }
    },

    /**
     * Stops the bot (graceful shutdown)
     * @param {string} signal Signal name for logging
     */
    stop: (signal) => {
      logger.info({ signal }, 'Stopping sender bot')
      bot.stop(signal)
    }
  }
}

/**
 * Sends media and returns file ID for caching
 * @private
 */
async function sendMedia(bot, chatId, buffer, type, caption) {
  const options = caption && caption.length > 0 ? { caption, parse_mode: 'HTML' } : undefined

  if (type === 'photo') {
    const result = await bot.telegram.sendPhoto(
      chatId,
      { source: buffer, filename: 'photo.jpg' },
      options
    )
    return result.photo?.at(-1)?.file_id
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

/**
 * Sends media using cached file ID
 * @private
 */
async function sendCachedMedia(bot, chatId, fileId, type, caption) {
  const options = caption && caption.length > 0 ? { caption, parse_mode: 'HTML' } : undefined

  if (type === 'photo') {
    await bot.telegram.sendPhoto(chatId, fileId, options)
  } else if (type === 'document') {
    await bot.telegram.sendDocument(chatId, fileId, options)
  }
}

/**
 * Splits text into chunks respecting word boundaries.
 * Falls back to force-break if no spaces found (handles URLs, base64, etc.)
 * @private
 */
export function splitIntoChunks(text, limit) {
  const chunks = []
  let start = 0

  while (start < text.length) {
    let end = start + limit

    if (end >= text.length) {
      chunks.push(text.slice(start))
      break
    }

    // Try to break at word boundary
    const chunk = text.slice(start, end)
    const lastSpace = chunk.lastIndexOf(' ')

    if (lastSpace > 0) {
      chunks.push(text.slice(start, start + lastSpace))
      start += lastSpace + 1 // Skip space
    } else {
      // No space found - force break (long URL, base64, etc.)
      chunks.push(chunk)
      start = end
    }
  }

  return chunks
}
