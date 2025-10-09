import { test } from '@jest/globals'
import assert from 'node:assert/strict'
import { createSender } from '../../../../src/bot/sender.js'
import { createFakeAdapter } from '../../../helpers/test-fakes.js'

test('createSender initializes adapter and clears webhook', async () => {
  const fake = createFakeAdapter()

  const sender = await createSender('fake_token', [111, 222], {
    adapterFactory: () => fake.adapter
  })

  assert.strictEqual(fake.calls.deleteWebhook.length, 1)
  assert.deepEqual(fake.calls.deleteWebhook[0].options, { drop_pending_updates: true })
  assert.strictEqual(fake.calls.getMe.length, 1)
  assert.ok(sender.send)
  assert.ok(sender.stop)
})

test('sender sends text-only message to multiple targets with HTML parse mode', async () => {
  const fake = createFakeAdapter()

  const sender = await createSender('fake_token', [111, 222, 333], {
    adapterFactory: () => fake.adapter
  })

  await sender.send({
    text: '<b>Hello World</b>',
    sourceId: 'source#123'
  })

  assert.strictEqual(fake.calls.sendMessage.length, 3)

  assert.strictEqual(fake.calls.sendMessage[0].chatId, 111)
  assert.strictEqual(fake.calls.sendMessage[0].text, '<b>Hello World</b>')
  assert.deepEqual(fake.calls.sendMessage[0].options, { parse_mode: 'HTML' })

  assert.strictEqual(fake.calls.sendMessage[1].chatId, 222)
  assert.strictEqual(fake.calls.sendMessage[2].chatId, 333)
})

test('sender chunks long text messages at word boundaries', async () => {
  const fake = createFakeAdapter()

  const sender = await createSender('fake_token', [111], { adapterFactory: () => fake.adapter })

  const longText = 'word '.repeat(1000) // ~5000 chars, exceeds 4096 limit

  await sender.send({
    text: longText,
    sourceId: 'source#456'
  })

  assert.ok(fake.calls.sendMessage.length >= 2, 'should split into multiple messages')

  fake.calls.sendMessage.forEach((call) => {
    assert.ok(call.text.length <= 4096, 'each chunk should be under 4096 chars')
    assert.strictEqual(call.options.parse_mode, 'HTML')
  })
})

test('sender uploads media once and reuses file_id for subsequent targets', async () => {
  const fake = createFakeAdapter()

  const sender = await createSender('fake_token', [111, 222, 333], {
    adapterFactory: () => fake.adapter
  })

  const mediaBuffer = Buffer.from('fake image data')

  await sender.send({
    text: 'Photo caption',
    media: mediaBuffer,
    mediaType: 'photo',
    sourceId: 'source#789'
  })

  // Should upload buffer once, then reuse file_id
  assert.strictEqual(fake.calls.sendPhoto.length, 3)

  // First upload uses buffer object
  assert.ok(fake.calls.sendPhoto[0].photo.source)
  assert.strictEqual(fake.calls.sendPhoto[0].photo.filename, 'photo.jpg')
  assert.deepEqual(fake.calls.sendPhoto[0].options, {
    caption: 'Photo caption',
    parse_mode: 'HTML'
  })

  // Subsequent uses file_id string
  assert.strictEqual(typeof fake.calls.sendPhoto[1].photo, 'string')
  assert.strictEqual(typeof fake.calls.sendPhoto[2].photo, 'string')
})

test('sender handles photo with long caption by splitting into caption + body messages', async () => {
  const fake = createFakeAdapter()

  const sender = await createSender('fake_token', [111], { adapterFactory: () => fake.adapter })

  const longCaption = 'a'.repeat(1024) + ' ' + 'b'.repeat(100)
  const mediaBuffer = Buffer.from('image')

  await sender.send({
    text: longCaption,
    media: mediaBuffer,
    mediaType: 'photo',
    sourceId: 'source#long'
  })

  // Should send photo with truncated caption + follow-up text message
  assert.strictEqual(fake.calls.sendPhoto.length, 1)
  assert.ok(fake.calls.sendPhoto[0].options.caption.length <= 1024)

  // Overflow goes to text message
  assert.ok(fake.calls.sendMessage.length >= 1)
  assert.ok(fake.calls.sendMessage[0].text.includes('b'))
})

test('sender handles video, audio, voice, and document media types', async () => {
  const fake = createFakeAdapter()

  const sender = await createSender('fake_token', [111], { adapterFactory: () => fake.adapter })

  const buffer = Buffer.from('data')

  await sender.send({ text: 'v', media: buffer, mediaType: 'video', sourceId: 'src#1' })
  await sender.send({ text: 'a', media: buffer, mediaType: 'audio', sourceId: 'src#2' })
  await sender.send({ text: 'vo', media: buffer, mediaType: 'voice', sourceId: 'src#3' })
  await sender.send({ text: 'd', media: buffer, mediaType: 'document', sourceId: 'src#4' })

  assert.strictEqual(fake.calls.sendVideo.length, 1)
  assert.strictEqual(fake.calls.sendVideo[0].video.filename, 'video.mp4')

  assert.strictEqual(fake.calls.sendAudio.length, 1)
  assert.strictEqual(fake.calls.sendAudio[0].audio.filename, 'audio.mp3')

  assert.strictEqual(fake.calls.sendVoice.length, 1)
  assert.strictEqual(fake.calls.sendVoice[0].voice.filename, 'voice.ogg')

  assert.strictEqual(fake.calls.sendDocument.length, 1)
  assert.strictEqual(fake.calls.sendDocument[0].document.filename, 'file.bin')
})

test('sender handles empty caption by omitting options', async () => {
  const fake = createFakeAdapter()

  const sender = await createSender('fake_token', [111], { adapterFactory: () => fake.adapter })

  await sender.send({
    text: '',
    media: Buffer.from('image'),
    mediaType: 'photo',
    sourceId: 'src#empty'
  })

  // Empty caption should result in undefined options (no caption field)
  assert.strictEqual(fake.calls.sendPhoto[0].options, undefined)
})

test('sender retries on rate limit with retry_after parameter', async () => {
  let callCount = 0

  const fakeAdapter = {
    async deleteWebhook() {
      return true
    },
    async getMe() {
      return { username: 'bot', id: 1 }
    },
    async sendMessage(_chatId, _text, _options) {
      callCount++
      if (callCount === 1) {
        const err = new Error('Rate limited')
        err.parameters = { retry_after: 1 }
        throw err
      }
      return { message_id: 1 }
    }
  }

  const sender = await createSender('fake_token', [111], { adapterFactory: () => fakeAdapter })

  // Note: This test validates that retry logic is invoked
  // The actual retry behavior is tested in retry.unit.test.js
  await sender.send({
    text: 'test',
    sourceId: 'src#retry'
  })

  // Should have attempted twice (initial + 1 retry)
  assert.strictEqual(callCount, 2)
})

test('sender does not retry non-rate-limit errors', async () => {
  let callCount = 0
  const fakeAdapter = {
    async deleteWebhook() {
      return true
    },
    async getMe() {
      return { username: 'bot', id: 1 }
    },
    async sendMessage() {
      callCount++
      const err = new Error('Invalid chat_id')
      err.response = { error_code: 400 }
      throw err
    }
  }

  const sender = await createSender('fake_token', [111], { adapterFactory: () => fakeAdapter })

  await sender.send({
    text: 'test',
    sourceId: 'src#hard'
  })

  // Should only attempt once (no retries for non-rate-limit errors)
  assert.strictEqual(callCount, 1, 'should not retry non-rate-limit errors')
})

test('sender stop method is callable', async () => {
  const fake = createFakeAdapter()

  const sender = await createSender('fake_token', [111], { adapterFactory: () => fake.adapter })

  // Should not throw
  sender.stop('SIGTERM')
})

test('sender handles media upload returning no file_id gracefully', async () => {
  // Adapter that returns malformed photo response (no file_id)
  const brokenAdapter = {
    async deleteWebhook() {
      return true
    },
    async getMe() {
      return { username: 'test', id: 1 }
    },
    async sendPhoto() {
      // Returns response without file_id (edge case)
      return { photo: [{ width: 100, height: 100 }], message_id: 1 }
    }
  }

  const sender = await createSender('fake_token', [111, 222], {
    adapterFactory: () => brokenAdapter
  })

  // Should not throw - handles null fileId gracefully
  await sender.send({
    text: 'Test',
    media: Buffer.from('image'),
    mediaType: 'photo',
    sourceId: 'src#test'
  })

  // If we get here without throwing, the null fileId was handled
  assert.ok(true, 'sender handled null fileId without crashing')
})
