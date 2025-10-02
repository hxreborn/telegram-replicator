import { logger } from '../../config.js'

/**
 * Pure message filtering and transformation logic.
 * Extracts text, applies regex filters, strips footers, and escapes HTML.
 */

/**
 * Filters and transforms a Telegram message.
 * Returns transformed message data or null if message should be dropped.
 *
 * @param {Object} msg GramJS message object
 * @param {Object} config Configuration object
 * @param {RegExp} config.filterRegex Regex to match (compiled)
 * @param {RegExp} config.stripRegex Regex to remove (compiled)
 * @param {number} config.maxMediaBytes Max media size in bytes
 * @returns {Object|null} Transformed message or null if filtered out
 */
export function filterMessage(msg, config) {
  const text = extractText(msg)
  if (!text) {
    logger.debug({ msgId: msg.id }, 'Drop: no text content')
    return null
  }

  if (!config.filterRegex.test(text)) {
    logger.debug({ msgId: msg.id }, 'Drop: filter regex mismatch')
    return null
  }

  const cleaned = text.replace(config.stripRegex, '').trim()
  if (!cleaned) {
    logger.debug({ msgId: msg.id }, 'Drop: empty after strip')
    return null
  }

  const escapedText = escapeHtml(cleaned)

  let mediaType = null
  if (msg.media) {
    const typeIdentifier = msg.media._ || msg.media.className || msg.media.constructor?.name
    const typeNameLower = String(typeIdentifier || '').toLowerCase()

    if (typeNameLower.includes('photo') || msg.media.photo) {
      mediaType = 'photo'
    } else if (typeNameLower.includes('document') || msg.media.document) {
      if (msg.media.video === true) {
        mediaType = 'video'
      } else if (msg.media.voice === true) {
        mediaType = 'voice'
      } else {
        const attributes = msg.media.document?.attributes || []
        const hasAudioAttr = attributes.some(
          (attr) => attr._ === 'documentAttributeAudio' && attr.voice !== true
        )
        mediaType = hasAudioAttr ? 'audio' : 'document'
      }
    } else {
      logger.debug({ msgId: msg.id, typeIdentifier }, 'Drop: unknown media type')
      return null
    }

    if (!config.supportedMediaTypes.includes(mediaType)) {
      logger.debug(
        { msgId: msg.id, type: mediaType, supported: config.supportedMediaTypes },
        'Drop: media type not supported'
      )
      return null
    }

    const size = msg.media.document?.size
    if (size && BigInt(size) > BigInt(config.maxMediaBytes)) {
      logger.debug({ msgId: msg.id, size, type: mediaType }, 'Drop: media exceeds size limit')
      return null
    }
  }

  return {
    text: escapedText,
    mediaType,
    sourceId: msg.id
  }
}

function extractText(msg) {
  const body = typeof msg?.message === 'string' ? msg.message : undefined
  const caption = typeof msg?.caption === 'string' ? msg.caption : undefined
  const text = (body || caption)?.trim()
  return text && text.length > 0 ? text : null
}

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
