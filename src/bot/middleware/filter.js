import { logger } from '../../config.js'

// Media type detection strategies
const MEDIA_TYPE_DETECTORS = [
  {
    type: 'photo',
    detect: (media, typeNameLower) => typeNameLower.includes('photo') || media.photo
  },
  {
    type: 'video',
    detect: (media, typeNameLower) =>
      (typeNameLower.includes('document') || media.document) && media.video === true
  },
  {
    type: 'voice',
    detect: (media, typeNameLower) =>
      (typeNameLower.includes('document') || media.document) && media.voice === true
  },
  {
    type: 'audio',
    detect: (media, typeNameLower) => {
      if (!typeNameLower.includes('document') && !media.document) return false
      const attributes = media.document?.attributes || []
      return attributes.some((attr) => attr._ === 'documentAttributeAudio' && attr.voice !== true)
    }
  },
  {
    type: 'document',
    detect: (media, typeNameLower) => typeNameLower.includes('document') || media.document
  }
]

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

    // Detect media type using lookup table (order matters: check specific types first)
    mediaType = detectMediaType(msg.media, typeNameLower)

    if (!mediaType) {
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

function detectMediaType(media, typeNameLower) {
  for (const detector of MEDIA_TYPE_DETECTORS) {
    if (detector.detect(media, typeNameLower)) {
      return detector.type
    }
  }
  return null
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
