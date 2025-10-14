import { test } from '@jest/globals'
import assert from 'node:assert/strict'
import { filterMessage } from '../../../../src/bot/middleware/filter.js'

const mockConfig = {
  filterRegex: /tech|update/i,
  stripRegex: /(?:^|\n)(Powered by.*|Discover more at .*)$/gi,
  maxMediaBytes: 10 * 1024 * 1024,
  supportedMediaTypes: ['photo', 'document', 'video', 'audio']
}

test('filterMessage returns null for messages without text', () => {
  const msg = { id: 1, message: '' }
  const result = filterMessage(msg, mockConfig)
  assert.strictEqual(result, null)
})

test('filterMessage returns null when filter regex does not match', () => {
  const msg = { id: 2, message: 'Random content without keywords' }
  const result = filterMessage(msg, mockConfig)
  assert.strictEqual(result, null)
})

test('filterMessage filters and transforms matching message', () => {
  const msg = { id: 3, message: 'New tech update available' }
  const result = filterMessage(msg, mockConfig)
  assert.ok(result)
  assert.strictEqual(result.text, 'New tech update available')
  assert.strictEqual(result.sourceId, 3)
  assert.strictEqual(result.mediaType, null)
})

test('filterMessage strips footer patterns from text', () => {
  const msg = { id: 4, message: 'Tech news\nPowered by Example.com' }
  const result = filterMessage(msg, mockConfig)
  assert.ok(result)
  assert.strictEqual(result.text, 'Tech news')
})

test('filterMessage strips discover more promotional footers', () => {
  const msg = { id: 20, message: 'Tech news\nDiscover more at hackrisk.io' }
  const result = filterMessage(msg, mockConfig)
  assert.ok(result)
  assert.strictEqual(result.text, 'Tech news')
})

test('filterMessage returns null if text is empty after stripping', () => {
  const msg = { id: 5, message: 'Powered by Example.com' }
  const result = filterMessage(msg, mockConfig)
  assert.strictEqual(result, null)
})

test('filterMessage escapes HTML special characters', () => {
  const msg = { id: 6, message: 'Tech update: <script>alert("xss")</script> & more' }
  const result = filterMessage(msg, mockConfig)
  assert.ok(result)
  assert.strictEqual(
    result.text,
    'Tech update: &lt;script&gt;alert("xss")&lt;/script&gt; &amp; more'
  )
})

test('filterMessage handles photo media type', () => {
  const msg = {
    id: 7,
    caption: 'Tech update',
    media: { _: 'messageMediaPhoto' }
  }
  const result = filterMessage(msg, mockConfig)
  assert.ok(result)
  assert.strictEqual(result.mediaType, 'photo')
})

test('filterMessage rejects documents exceeding size limit', () => {
  const msg = {
    id: 8,
    caption: 'Tech update',
    media: {
      _: 'messageMediaDocument',
      document: { size: 20 * 1024 * 1024 } // 20MB > 10MB limit
    }
  }
  const result = filterMessage(msg, mockConfig)
  assert.strictEqual(result, null)
})

test('filterMessage accepts documents within size limit', () => {
  const msg = {
    id: 9,
    caption: 'Tech update',
    media: {
      _: 'messageMediaDocument',
      document: { size: 5 * 1024 * 1024 } // 5MB < 10MB limit
    }
  }
  const result = filterMessage(msg, mockConfig)
  assert.ok(result)
  assert.strictEqual(result.mediaType, 'document')
})

test('filterMessage detects video from media.video flag', () => {
  const msg = {
    id: 10,
    caption: 'Tech video update',
    media: {
      _: 'messageMediaDocument',
      video: true,
      document: { size: 5 * 1024 * 1024 }
    }
  }
  const result = filterMessage(msg, mockConfig)
  assert.ok(result)
  assert.strictEqual(result.mediaType, 'video')
  assert.strictEqual(result.text, 'Tech video update')
})

test('filterMessage detects audio from documentAttributeAudio', () => {
  const msg = {
    id: 11,
    caption: 'Tech podcast update',
    media: {
      _: 'messageMediaDocument',
      document: {
        size: 3 * 1024 * 1024,
        attributes: [{ _: 'documentAttributeAudio', voice: false, duration: 180 }]
      }
    }
  }
  const result = filterMessage(msg, mockConfig)
  assert.ok(result)
  assert.strictEqual(result.mediaType, 'audio')
})

test('filterMessage drops voice messages when not supported', () => {
  const msg = {
    id: 12,
    caption: 'Tech voice note',
    media: {
      _: 'messageMediaDocument',
      voice: true,
      document: { size: 1 * 1024 * 1024 }
    }
  }
  const result = filterMessage(msg, mockConfig)
  assert.strictEqual(result, null)
})

test('filterMessage allows voice messages when supported', () => {
  const voiceConfig = {
    ...mockConfig,
    supportedMediaTypes: [...mockConfig.supportedMediaTypes, 'voice']
  }
  const msg = {
    id: 17,
    caption: 'Tech voice note',
    media: {
      _: 'messageMediaDocument',
      voice: true,
      document: { size: 1 * 1024 * 1024 }
    }
  }
  const result = filterMessage(msg, voiceConfig)
  assert.ok(result)
  assert.strictEqual(result.mediaType, 'voice')
  assert.strictEqual(result.text, 'Tech voice note')
})

test('filterMessage rejects video exceeding size limit', () => {
  const msg = {
    id: 13,
    caption: 'Tech update',
    media: {
      _: 'messageMediaDocument',
      video: true,
      document: { size: 20 * 1024 * 1024 } // 20MB > 10MB limit
    }
  }
  const result = filterMessage(msg, mockConfig)
  assert.strictEqual(result, null)
})

test('filterMessage rejects audio exceeding size limit', () => {
  const msg = {
    id: 14,
    caption: 'Tech update',
    media: {
      _: 'messageMediaDocument',
      document: {
        size: 15 * 1024 * 1024, // 15MB > 10MB limit
        attributes: [{ _: 'documentAttributeAudio', voice: false, duration: 600 }]
      }
    }
  }
  const result = filterMessage(msg, mockConfig)
  assert.strictEqual(result, null)
})

test('filterMessage rejects unsupported media types', () => {
  const restrictiveConfig = {
    ...mockConfig,
    supportedMediaTypes: ['photo'] // Only photos
  }
  const msg = {
    id: 15,
    caption: 'Tech update',
    media: {
      _: 'messageMediaDocument',
      video: true,
      document: { size: 5 * 1024 * 1024 }
    }
  }
  const result = filterMessage(msg, restrictiveConfig)
  assert.strictEqual(result, null)
})

test('filterMessage handles audio with voice:true in attributes as voice', () => {
  const msg = {
    id: 16,
    caption: 'Tech update',
    media: {
      _: 'messageMediaDocument',
      document: {
        size: 2 * 1024 * 1024,
        attributes: [{ _: 'documentAttributeAudio', voice: true, duration: 60 }]
      }
    }
  }
  const result = filterMessage(msg, mockConfig)
  // Should be detected as document, not audio (since voice:true in attribute)
  assert.ok(result)
  assert.strictEqual(result.mediaType, 'document')
})

test('filterMessage rejects messages with unknown media types', () => {
  const msg = {
    id: 18,
    caption: 'Tech update',
    media: {
      _: 'messageMediaWebPage',
      webpage: { url: 'https://example.com' }
    }
  }
  const result = filterMessage(msg, mockConfig)
  assert.strictEqual(result, null, 'should reject unknown media types')
})

test('filterMessage handles media with missing type identifier gracefully', () => {
  const msg = {
    id: 19,
    caption: 'Tech update',
    media: {
      // No _, className, or constructor.name
      someOtherField: 'value'
    }
  }
  const result = filterMessage(msg, mockConfig)
  assert.strictEqual(result, null, 'should reject media with no type identifier')
})
