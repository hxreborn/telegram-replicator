/**
 * Shared test doubles for use across test files
 * Provides consistent fakes/stubs without mocking libraries
 */

export function createLoggerDouble() {
  const entries = []
  return {
    logger: {
      info: (...args) => entries.push({ level: 'info', args }),
      warn: (...args) => entries.push({ level: 'warn', args }),
      error: (...args) => entries.push({ level: 'error', args }),
      debug: (...args) => entries.push({ level: 'debug', args })
    },
    entries
  }
}

export function createFakeAdapter({
  shouldThrow = null,
  retryAfter = null,
  throwOnAttempt = 1
} = {}) {
  const calls = {
    deleteWebhook: [],
    getMe: [],
    sendMessage: [],
    sendPhoto: [],
    sendVideo: [],
    sendAudio: [],
    sendVoice: [],
    sendDocument: []
  }

  let attemptCount = 0
  let fileIdCounter = 0

  const maybeThrow = () => {
    attemptCount++
    if (shouldThrow && attemptCount === throwOnAttempt) {
      if (retryAfter !== null) {
        const err = new Error('Rate limited')
        err.parameters = { retry_after: retryAfter }
        throw err
      }
      throw shouldThrow
    }
  }

  return {
    adapter: {
      async deleteWebhook(options) {
        calls.deleteWebhook.push({ options })
        return true
      },

      async getMe() {
        calls.getMe.push({})
        return { username: 'test_bot', id: 12345 }
      },

      async sendMessage(chatId, text, options) {
        maybeThrow()
        calls.sendMessage.push({ chatId, text, options })
        return { message_id: calls.sendMessage.length }
      },

      async sendPhoto(chatId, photo, options) {
        maybeThrow()
        calls.sendPhoto.push({ chatId, photo, options })
        const fileId = typeof photo === 'string' ? photo : `photo_file_id_${++fileIdCounter}`
        return { photo: [{ file_id: fileId }], message_id: calls.sendPhoto.length }
      },

      async sendVideo(chatId, video, options) {
        maybeThrow()
        calls.sendVideo.push({ chatId, video, options })
        const fileId = typeof video === 'string' ? video : `video_file_id_${++fileIdCounter}`
        return { video: { file_id: fileId }, message_id: calls.sendVideo.length }
      },

      async sendAudio(chatId, audio, options) {
        maybeThrow()
        calls.sendAudio.push({ chatId, audio, options })
        const fileId = typeof audio === 'string' ? audio : `audio_file_id_${++fileIdCounter}`
        return { audio: { file_id: fileId }, message_id: calls.sendAudio.length }
      },

      async sendVoice(chatId, voice, options) {
        maybeThrow()
        calls.sendVoice.push({ chatId, voice, options })
        const fileId = typeof voice === 'string' ? voice : `voice_file_id_${++fileIdCounter}`
        return { voice: { file_id: fileId }, message_id: calls.sendVoice.length }
      },

      async sendDocument(chatId, document, options) {
        maybeThrow()
        calls.sendDocument.push({ chatId, document, options })
        const fileId = typeof document === 'string' ? document : `doc_file_id_${++fileIdCounter}`
        return { document: { file_id: fileId }, message_id: calls.sendDocument.length }
      }
    },
    calls,
    resetAttemptCount: () => {
      attemptCount = 0
    }
  }
}

export function createRecordingAdapter() {
  const calls = {
    deleteWebhook: [],
    getMe: [],
    sendMessage: [],
    sendPhoto: [],
    sendVideo: [],
    sendAudio: [],
    sendVoice: [],
    sendDocument: []
  }

  let fileIdCounter = 0

  return {
    adapter: {
      async deleteWebhook(options) {
        calls.deleteWebhook.push({ options })
        return true
      },

      async getMe() {
        calls.getMe.push({})
        return { username: 'contract_bot', id: 99999 }
      },

      async sendMessage(chatId, text, options) {
        calls.sendMessage.push({ chatId, text, options })
        return { message_id: calls.sendMessage.length }
      },

      async sendPhoto(chatId, photo, options) {
        calls.sendPhoto.push({ chatId, photo, options })
        const fileId = typeof photo === 'string' ? photo : `file_${++fileIdCounter}`
        return { photo: [{ file_id: fileId }], message_id: calls.sendPhoto.length }
      },

      async sendVideo(chatId, video, options) {
        calls.sendVideo.push({ chatId, video, options })
        const fileId = typeof video === 'string' ? video : `file_${++fileIdCounter}`
        return { video: { file_id: fileId }, message_id: calls.sendVideo.length }
      },

      async sendAudio(chatId, audio, options) {
        calls.sendAudio.push({ chatId, audio, options })
        const fileId = typeof audio === 'string' ? audio : `file_${++fileIdCounter}`
        return { audio: { file_id: fileId }, message_id: calls.sendAudio.length }
      },

      async sendVoice(chatId, voice, options) {
        calls.sendVoice.push({ chatId, voice, options })
        const fileId = typeof voice === 'string' ? voice : `file_${++fileIdCounter}`
        return { voice: { file_id: fileId }, message_id: calls.sendVoice.length }
      },

      async sendDocument(chatId, document, options) {
        calls.sendDocument.push({ chatId, document, options })
        const fileId = typeof document === 'string' ? document : `file_${++fileIdCounter}`
        return { document: { file_id: fileId }, message_id: calls.sendDocument.length }
      }
    },
    calls
  }
}


export function snapshotEnv(keys) {
  return keys.reduce((acc, key) => {
    acc[key] = process.env[key]
    return acc
  }, {})
}

export function restoreEnv(snapshot) {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}
