import { test } from '@jest/globals'
import assert from 'node:assert/strict'
import { createTelegrafAdapter } from '../../../src/bot/telegraf-adapter.js'

test('createTelegrafAdapter wraps deleteWebhook', async () => {
  const calls = []
  const fakeBot = {
    telegram: {
      deleteWebhook: async (options) => {
        calls.push({ method: 'deleteWebhook', options })
        return true
      }
    }
  }

  const adapter = createTelegrafAdapter(fakeBot)
  const result = await adapter.deleteWebhook({ drop_pending_updates: true })

  assert.strictEqual(result, true)
  assert.strictEqual(calls.length, 1)
  assert.deepEqual(calls[0], {
    method: 'deleteWebhook',
    options: { drop_pending_updates: true }
  })
})

test('createTelegrafAdapter wraps getMe', async () => {
  const calls = []
  const fakeBot = {
    telegram: {
      getMe: async () => {
        calls.push({ method: 'getMe' })
        return { id: 123, username: 'testbot' }
      }
    }
  }

  const adapter = createTelegrafAdapter(fakeBot)
  const result = await adapter.getMe()

  assert.deepEqual(result, { id: 123, username: 'testbot' })
  assert.strictEqual(calls.length, 1)
})

test('createTelegrafAdapter wraps sendMessage', async () => {
  const calls = []
  const fakeBot = {
    telegram: {
      sendMessage: async (chatId, text, options) => {
        calls.push({ method: 'sendMessage', chatId, text, options })
        return { message_id: 42 }
      }
    }
  }

  const adapter = createTelegrafAdapter(fakeBot)
  const result = await adapter.sendMessage(123456, 'Hello', { parse_mode: 'HTML' })

  assert.deepEqual(result, { message_id: 42 })
  assert.strictEqual(calls.length, 1)
  assert.deepEqual(calls[0], {
    method: 'sendMessage',
    chatId: 123456,
    text: 'Hello',
    options: { parse_mode: 'HTML' }
  })
})

test('createTelegrafAdapter wraps sendPhoto', async () => {
  const calls = []
  const fakeBot = {
    telegram: {
      sendPhoto: async (chatId, photo, options) => {
        calls.push({ method: 'sendPhoto', chatId, photo, options })
        return { photo: [{ file_id: 'photo123' }], message_id: 1 }
      }
    }
  }

  const adapter = createTelegrafAdapter(fakeBot)
  const buffer = Buffer.from('image')
  const result = await adapter.sendPhoto(123456, buffer, { caption: 'Photo' })

  assert.ok(result.photo)
  assert.strictEqual(result.photo[0].file_id, 'photo123')
  assert.strictEqual(calls.length, 1)
  assert.strictEqual(calls[0].chatId, 123456)
})

test('createTelegrafAdapter wraps sendVideo', async () => {
  const calls = []
  const fakeBot = {
    telegram: {
      sendVideo: async (chatId, video, options) => {
        calls.push({ method: 'sendVideo', chatId, video, options })
        return { video: { file_id: 'video123' }, message_id: 1 }
      }
    }
  }

  const adapter = createTelegrafAdapter(fakeBot)
  const result = await adapter.sendVideo(123456, 'file_id_123', {})

  assert.ok(result.video)
  assert.strictEqual(result.video.file_id, 'video123')
  assert.strictEqual(calls.length, 1)
})

test('createTelegrafAdapter wraps sendAudio', async () => {
  const calls = []
  const fakeBot = {
    telegram: {
      sendAudio: async (chatId, audio, options) => {
        calls.push({ method: 'sendAudio', chatId, audio, options })
        return { audio: { file_id: 'audio123' }, message_id: 1 }
      }
    }
  }

  const adapter = createTelegrafAdapter(fakeBot)
  const result = await adapter.sendAudio(123456, Buffer.from('audio'), {})

  assert.ok(result.audio)
  assert.strictEqual(result.audio.file_id, 'audio123')
  assert.strictEqual(calls.length, 1)
})

test('createTelegrafAdapter wraps sendVoice', async () => {
  const calls = []
  const fakeBot = {
    telegram: {
      sendVoice: async (chatId, voice, options) => {
        calls.push({ method: 'sendVoice', chatId, voice, options })
        return { voice: { file_id: 'voice123' }, message_id: 1 }
      }
    }
  }

  const adapter = createTelegrafAdapter(fakeBot)
  const result = await adapter.sendVoice(123456, Buffer.from('voice'), {})

  assert.ok(result.voice)
  assert.strictEqual(result.voice.file_id, 'voice123')
  assert.strictEqual(calls.length, 1)
})

test('createTelegrafAdapter wraps sendDocument', async () => {
  const calls = []
  const fakeBot = {
    telegram: {
      sendDocument: async (chatId, document, options) => {
        calls.push({ method: 'sendDocument', chatId, document, options })
        return { document: { file_id: 'doc123' }, message_id: 1 }
      }
    }
  }

  const adapter = createTelegrafAdapter(fakeBot)
  const result = await adapter.sendDocument(123456, Buffer.from('doc'), { filename: 'test.pdf' })

  assert.ok(result.document)
  assert.strictEqual(result.document.file_id, 'doc123')
  assert.strictEqual(calls.length, 1)
  assert.deepEqual(calls[0].options, { filename: 'test.pdf' })
})

test('createTelegrafAdapter propagates errors from Telegraf', async () => {
  const fakeBot = {
    telegram: {
      sendMessage: async () => {
        const err = new Error('Rate limit exceeded')
        err.response = { error_code: 429 }
        throw err
      }
    }
  }

  const adapter = createTelegrafAdapter(fakeBot)

  await assert.rejects(
    async () => {
      await adapter.sendMessage(123456, 'test', {})
    },
    {
      message: 'Rate limit exceeded'
    }
  )
})

test('createTelegrafAdapter returns same adapter interface for same bot', () => {
  const fakeBot = {
    telegram: {
      getMe: async () => ({ id: 1 }),
      sendMessage: async () => ({ message_id: 1 })
    }
  }

  const adapter1 = createTelegrafAdapter(fakeBot)
  const adapter2 = createTelegrafAdapter(fakeBot)

  // Adapters are independent wrappers
  assert.ok(adapter1.getMe)
  assert.ok(adapter2.getMe)
  assert.notStrictEqual(adapter1, adapter2)
})
