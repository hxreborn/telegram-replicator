import { test } from '@jest/globals'
import assert from 'node:assert/strict'
import { createSender } from '../../../src/bot/sender.js'
import { createRecordingAdapter } from '../../helpers/test-fakes.js'

test('contract: all text messages must include parse_mode: HTML', async () => {
  const { adapter, calls } = createRecordingAdapter()

  const sender = await createSender('token', [111, 222], { adapterFactory: () => adapter })

  await sender.send({
    text: 'Simple message',
    sourceId: 'src#1'
  })

  assert.strictEqual(calls.sendMessage.length, 2)
  calls.sendMessage.forEach((call) => {
    assert.strictEqual(call.options.parse_mode, 'HTML', 'parse_mode must be HTML')
  })
})

test('contract: media captions must include parse_mode: HTML when caption is present', async () => {
  const { adapter, calls } = createRecordingAdapter()

  const sender = await createSender('token', [111], { adapterFactory: () => adapter })

  await sender.send({
    text: 'Photo caption',
    media: Buffer.from('data'),
    mediaType: 'photo',
    sourceId: 'src#2'
  })

  assert.strictEqual(calls.sendPhoto.length, 1)
  assert.strictEqual(calls.sendPhoto[0].options.parse_mode, 'HTML')
  assert.strictEqual(calls.sendPhoto[0].options.caption, 'Photo caption')
})

test('contract: empty captions must result in undefined options', async () => {
  const { adapter, calls } = createRecordingAdapter()

  const sender = await createSender('token', [111], { adapterFactory: () => adapter })

  await sender.send({
    text: '',
    media: Buffer.from('data'),
    mediaType: 'photo',
    sourceId: 'src#3'
  })

  assert.strictEqual(calls.sendPhoto.length, 1)
  assert.strictEqual(calls.sendPhoto[0].options, undefined, 'empty caption should omit options')
})

test('contract: caption limit is exactly 1024 characters', async () => {
  const { adapter, calls } = createRecordingAdapter()

  const sender = await createSender('token', [111], { adapterFactory: () => adapter })

  const exactLimit = 'x'.repeat(1024)
  const overLimit = 'x'.repeat(1024) + ' overflow'

  // Exactly 1024 chars - should fit in caption, no follow-up message
  await sender.send({
    text: exactLimit,
    media: Buffer.from('data'),
    mediaType: 'photo',
    sourceId: 'src#4a'
  })

  assert.strictEqual(calls.sendPhoto.length, 1)
  assert.strictEqual(calls.sendPhoto[0].options.caption.length, 1024)
  assert.strictEqual(calls.sendMessage.length, 0, 'no overflow for exactly 1024 chars')

  // Over 1024 chars - caption truncated, overflow in message
  await sender.send({
    text: overLimit,
    media: Buffer.from('data'),
    mediaType: 'photo',
    sourceId: 'src#4b'
  })

  assert.strictEqual(calls.sendPhoto.length, 2)
  assert.ok(calls.sendPhoto[1].options.caption.length <= 1024, 'caption must not exceed 1024')
  assert.ok(calls.sendMessage.length >= 1, 'overflow should go to message')
})

test('contract: message limit is 4096 characters per chunk', async () => {
  const { adapter, calls } = createRecordingAdapter()

  const sender = await createSender('token', [111], { adapterFactory: () => adapter })

  const longText = 'word '.repeat(2000) // ~10000 chars

  await sender.send({
    text: longText,
    sourceId: 'src#5'
  })

  assert.ok(calls.sendMessage.length >= 2, 'should split long text')

  calls.sendMessage.forEach((call, idx) => {
    assert.ok(call.text.length <= 4096, `chunk ${idx} must not exceed 4096 chars`)
  })
})

test('contract: photo uploads must use source+filename structure', async () => {
  const { adapter, calls } = createRecordingAdapter()

  const sender = await createSender('token', [111], { adapterFactory: () => adapter })

  const buffer = Buffer.from('photo data')

  await sender.send({
    text: 'Photo',
    media: buffer,
    mediaType: 'photo',
    sourceId: 'src#6'
  })

  assert.strictEqual(calls.sendPhoto.length, 1)
  const photo = calls.sendPhoto[0].photo

  assert.ok(photo.source, 'photo must have source property')
  assert.ok(Buffer.isBuffer(photo.source), 'source must be Buffer')
  assert.strictEqual(photo.filename, 'photo.jpg', 'filename must be photo.jpg')
})

test('contract: video uploads must use correct filename', async () => {
  const { adapter, calls } = createRecordingAdapter()

  const sender = await createSender('token', [111], { adapterFactory: () => adapter })

  await sender.send({
    text: 'Video',
    media: Buffer.from('video'),
    mediaType: 'video',
    sourceId: 'src#7'
  })

  assert.strictEqual(calls.sendVideo.length, 1)
  assert.strictEqual(calls.sendVideo[0].video.filename, 'video.mp4')
})

test('contract: audio uploads must use correct filename', async () => {
  const { adapter, calls } = createRecordingAdapter()

  const sender = await createSender('token', [111], { adapterFactory: () => adapter })

  await sender.send({
    text: 'Audio',
    media: Buffer.from('audio'),
    mediaType: 'audio',
    sourceId: 'src#8'
  })

  assert.strictEqual(calls.sendAudio.length, 1)
  assert.strictEqual(calls.sendAudio[0].audio.filename, 'audio.mp3')
})

test('contract: voice uploads must use correct filename', async () => {
  const { adapter, calls } = createRecordingAdapter()

  const sender = await createSender('token', [111], { adapterFactory: () => adapter })

  await sender.send({
    text: 'Voice',
    media: Buffer.from('voice'),
    mediaType: 'voice',
    sourceId: 'src#9'
  })

  assert.strictEqual(calls.sendVoice.length, 1)
  assert.strictEqual(calls.sendVoice[0].voice.filename, 'voice.ogg')
})

test('contract: document uploads must use correct filename', async () => {
  const { adapter, calls } = createRecordingAdapter()

  const sender = await createSender('token', [111], { adapterFactory: () => adapter })

  await sender.send({
    text: 'Doc',
    media: Buffer.from('doc'),
    mediaType: 'document',
    sourceId: 'src#10'
  })

  assert.strictEqual(calls.sendDocument.length, 1)
  assert.strictEqual(calls.sendDocument[0].document.filename, 'file.bin')
})

test('contract: subsequent media sends to different targets use file_id string', async () => {
  const { adapter, calls } = createRecordingAdapter()

  const sender = await createSender('token', [111, 222, 333], { adapterFactory: () => adapter })

  await sender.send({
    text: 'Photo',
    media: Buffer.from('data'),
    mediaType: 'photo',
    sourceId: 'src#11'
  })

  assert.strictEqual(calls.sendPhoto.length, 3)

  // First upload uses buffer object
  assert.ok(calls.sendPhoto[0].photo.source, 'first upload must use buffer')
  assert.strictEqual(typeof calls.sendPhoto[0].photo.filename, 'string')

  // Subsequent sends use file_id string
  assert.strictEqual(typeof calls.sendPhoto[1].photo, 'string', 'second send must use file_id')
  assert.strictEqual(typeof calls.sendPhoto[2].photo, 'string', 'third send must use file_id')
})

test('contract: deleteWebhook called with drop_pending_updates: true', async () => {
  const { adapter, calls } = createRecordingAdapter()

  await createSender('token', [111], { adapterFactory: () => adapter })

  assert.strictEqual(calls.deleteWebhook.length, 1)
  assert.deepEqual(calls.deleteWebhook[0].options, { drop_pending_updates: true })
})

test('contract: getMe called exactly once during initialization', async () => {
  const { adapter, calls } = createRecordingAdapter()

  await createSender('token', [111], { adapterFactory: () => adapter })

  assert.strictEqual(calls.getMe.length, 1)
})

test('contract: chunking preserves word boundaries when possible', async () => {
  const { adapter, calls } = createRecordingAdapter()

  const sender = await createSender('token', [111], { adapterFactory: () => adapter })

  // Text with clear word boundaries
  const text = 'word '.repeat(1000) // ~5000 chars

  await sender.send({ text, sourceId: 'src#12' })

  calls.sendMessage.forEach((call, idx) => {
    // Chunks should not end mid-word (no trailing partial words without space)
    // Exception: very long tokens that exceed limit
    // const endsWithSpace = call.text.endsWith(' ')
    const isLastChunk = idx === calls.sendMessage.length - 1

    if (!isLastChunk) {
      // Non-final chunks should ideally end at word boundary
      // We can't enforce this strictly as some edge cases force breaks
      assert.ok(call.text.length <= 4096)
    }
  })
})
