/**
 * Shared test fakes for use across test suites
 * Provides working implementations with shortcuts (no real I/O)
 * Prefer these over mocking libraries to keep tests explicit and portable
 */

/**
 * @typedef {Object} LoggerFake
 * @property {(...args: any[]) => void} info
 * @property {(...args: any[]) => void} warn
 * @property {(...args: any[]) => void} error
 * @property {(...args: any[]) => void} debug
 */

/**
 * @typedef {Object} LogEntry
 * @property {'info' | 'warn' | 'error' | 'debug'} level
 * @property {any[]} args
 */

/**
 * Creates a fake logger that records all calls for inspection
 * @returns {{ logger: LoggerFake, entries: LogEntry[] }}
 * @example
 * const { logger, entries } = createLoggerDouble()
 * logger.info('test', { foo: 'bar' })
 * assert.strictEqual(entries[0].level, 'info')
 * assert.deepEqual(entries[0].args, ['test', { foo: 'bar' }])
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

/**
 * @typedef {Object} TelegrafAdapter
 * @property {(options: any) => Promise<boolean>} deleteWebhook
 * @property {() => Promise<{ username: string, id: number }>} getMe
 * @property {(chatId: number, text: string, options?: any) => Promise<any>} sendMessage
 * @property {(chatId: number, photo: any, options?: any) => Promise<any>} sendPhoto
 * @property {(chatId: number, video: any, options?: any) => Promise<any>} sendVideo
 * @property {(chatId: number, audio: any, options?: any) => Promise<any>} sendAudio
 * @property {(chatId: number, voice: any, options?: any) => Promise<any>} sendVoice
 * @property {(chatId: number, document: any, options?: any) => Promise<any>} sendDocument
 */

/**
 * @typedef {Object} AdapterCalls
 * @property {Array<{ options: any }>} deleteWebhook
 * @property {Array<{}>} getMe
 * @property {Array<{ chatId: number, text: string, options?: any }>} sendMessage
 * @property {Array<{ chatId: number, photo: any, options?: any }>} sendPhoto
 * @property {Array<{ chatId: number, video: any, options?: any }>} sendVideo
 * @property {Array<{ chatId: number, audio: any, options?: any }>} sendAudio
 * @property {Array<{ chatId: number, voice: any, options?: any }>} sendVoice
 * @property {Array<{ chatId: number, document: any, options?: any }>} sendDocument
 */

/**
 * Creates a fake Telegraf adapter with configurable error injection
 * Use for testing error handling, rate limits, and retry logic
 * @param {Object} [options]
 * @param {Error | null} [options.shouldThrow] - Error to throw on specified attempt
 * @param {number | null} [options.retryAfter] - If set, throw rate limit error with retry_after
 * @param {number} [options.throwOnAttempt=1] - Which attempt should throw (1-indexed)
 * @returns {{ adapter: TelegrafAdapter, calls: AdapterCalls, resetAttemptCount: () => void }}
 * @example
 * const fake = createFakeAdapter({
 *   shouldThrow: new Error('Rate limited'),
 *   retryAfter: 5,
 *   throwOnAttempt: 1
 * })
 * // First call throws, retry succeeds
 * await sender.send({ text: 'test' })
 * assert.strictEqual(fake.calls.sendMessage.length, 2)
 */
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

/**
 * Creates a recording-only adapter (never throws, always succeeds)
 * Use for contract tests where you only care about call shapes
 * @returns {{ adapter: TelegrafAdapter, calls: AdapterCalls }}
 * @example
 * const { adapter, calls } = createRecordingAdapter()
 * const sender = await createSender('token', [111], { adapterFactory: () => adapter })
 * await sender.send({ text: 'test' })
 * assert.strictEqual(calls.sendMessage[0].text, 'test')
 */
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

/**
 * Captures a snapshot of environment variables for restoration
 * @param {string[]} keys - Environment variable names to snapshot
 * @returns {Record<string, string | undefined>}
 * @example
 * const snapshot = snapshotEnv(['NODE_ENV', 'LOG_LEVEL'])
 * process.env.NODE_ENV = 'test'
 * // ... run tests ...
 * restoreEnv(snapshot)
 */
export function snapshotEnv(keys) {
  return keys.reduce((acc, key) => {
    acc[key] = process.env[key]
    return acc
  }, {})
}

/**
 * Restores environment variables from a snapshot
 * @param {Record<string, string | undefined>} snapshot
 * @example
 * const snapshot = snapshotEnv(['NODE_ENV'])
 * process.env.NODE_ENV = 'test'
 * restoreEnv(snapshot) // NODE_ENV restored to original value
 */
export function restoreEnv(snapshot) {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}
