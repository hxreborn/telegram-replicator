import { logger, maskChatId } from '../config.js'

const MAX_RETRIES = 4
const BASE_DELAY_MS = 1000
const MAX_RETRY_DELAY_SECONDS = 60
const DEFAULT_RETRY_AFTER_SECONDS = 30
const JITTER_MAX_MS = 1000
const MS_PER_SECOND = 1000
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export async function retryWithBackoff({
  fn,
  initialRetryAfter = DEFAULT_RETRY_AFTER_SECONDS,
  maxRetries = MAX_RETRIES,
  context = {},
  sleep = defaultSleep,
  random = Math.random,
  logger: overrideLogger
}) {
  const log = overrideLogger ?? logger
  let attempt = 0
  let retryAfter = Math.min(initialRetryAfter, MAX_RETRY_DELAY_SECONDS)

  while (attempt < maxRetries) {
    attempt++

    const backoffMs = BASE_DELAY_MS * Math.pow(2, attempt - 1)
    const jitterMs = Math.max(0, Math.min(1, random())) * JITTER_MAX_MS
    const delayMs = Math.max(retryAfter * MS_PER_SECOND, backoffMs) + jitterMs

    log.warn(
      {
        ...context,
        chatId: context.chatId ? maskChatId(context.chatId) : undefined,
        attempt,
        delaySeconds: Math.round(delayMs / MS_PER_SECOND),
        initialRetryAfter
      },
      `Rate limited, retry attempt ${attempt}/${maxRetries} after ${Math.round(delayMs / MS_PER_SECOND)}s`
    )

    await sleep(delayMs)

    try {
      await fn()
      log.info(
        {
          ...context,
          chatId: context.chatId ? maskChatId(context.chatId) : undefined,
          attempt,
          totalDelayMs: Math.round(delayMs / MS_PER_SECOND)
        },
        `Operation succeeded after ${attempt} retries`
      )
      return
    } catch (retryErr) {
      const newRetryAfter =
        retryErr.parameters?.retry_after ?? retryErr.response?.parameters?.retry_after

      if (newRetryAfter && typeof newRetryAfter === 'number' && newRetryAfter > 0) {
        retryAfter = Math.min(newRetryAfter, MAX_RETRY_DELAY_SECONDS)
      }

      if (attempt === maxRetries) {
        log.error(
          {
            ...context,
            chatId: context.chatId ? maskChatId(context.chatId) : undefined,
            err: retryErr,
            totalAttempts: maxRetries
          },
          'Failed after all retry attempts'
        )
        throw retryErr
      }
    }
  }
}
