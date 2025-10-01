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
  // Extract visible text from message or caption
  const text = extractText(msg)
  if (!text) {
    logger.debug({ msgId: msg.id }, 'Drop: no text content')
    return null
  }

  // Apply filter regex (already compiled in config)
  if (!config.filterRegex.test(text)) {
    logger.debug({ msgId: msg.id }, 'Drop: filter regex mismatch')
    return null
  }

  // Strip footer patterns (already compiled in config)
  const cleaned = text.replace(config.stripRegex, '').trim()
  if (!cleaned) {
    logger.debug({ msgId: msg.id }, 'Drop: empty after strip')
    return null
  }

  // HTML escape
  const safe = escapeHtml(cleaned)

  // Determine media type if present
  let mediaType = null
  if (msg.media) {
    const mediaKind = msg.media._

    // Handle photo media
    if (mediaKind === 'messageMediaPhoto') {
      mediaType = 'photo'
    }
    // Handle document-based media (videos, audio, files)
    else if (mediaKind === 'messageMediaDocument') {
      // GramJS sets flags directly on media object for video/voice
      if (msg.media.video === true) {
        mediaType = 'video'
      } else if (msg.media.voice === true) {
        // Voice messages - currently treated as separate type
        // Could be supported as 'audio' or 'voice' depending on config
        mediaType = 'voice'
      } else {
        // Check document attributes for audio (non-voice)
        const attributes = msg.media.document?.attributes || []
        const hasAudioAttr = attributes.some(
          (attr) => attr._ === 'documentAttributeAudio' && attr.voice !== true
        )

        if (hasAudioAttr) {
          mediaType = 'audio'
        } else {
          // Regular document (PDF, ZIP, etc.)
          mediaType = 'document'
        }
      }
    } else {
      logger.debug({ msgId: msg.id, type: mediaKind }, 'Drop: unsupported media type')
      return null
    }

    // Check if this media type is enabled in configuration
    if (!config.supportedMediaTypes.includes(mediaType)) {
      logger.debug(
        { msgId: msg.id, type: mediaType, supported: config.supportedMediaTypes },
        'Drop: media type not supported'
      )
      return null
    }

    // Check size limit for document-based media
    const size = msg.media.document?.size
    if (size && BigInt(size) > BigInt(config.maxMediaBytes)) {
      logger.debug({ msgId: msg.id, size, type: mediaType }, 'Drop: media exceeds size limit')
      return null
    }
  }

  return {
    text: safe,
    mediaType,
    sourceId: msg.id
  }
}

// Extract visible text from message body or caption
function extractText(msg) {
  const body = typeof msg?.message === 'string' ? msg.message : undefined
  const caption = typeof msg?.caption === 'string' ? msg.caption : undefined
  const text = (body || caption)?.trim()
  return text && text.length > 0 ? text : null
}

// Escape HTML special characters for Telegram's HTML parse mode
function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
