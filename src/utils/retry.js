import { logger, maskChatId } from '../config.js'

const MAX_RETRIES = 4
const BASE_DELAY_MS = 1000
const MAX_RETRY_DELAY_SECONDS = 60

export async function retryWithBackoff({ fn, initialRetryAfter = 30, maxRetries = MAX_RETRIES, context = {} }) {
  let attempt = 0
  let retryAfter = Math.min(initialRetryAfter, MAX_RETRY_DELAY_SECONDS)

  while (attempt < maxRetries) {
    attempt++

    const backoffMs = BASE_DELAY_MS * Math.pow(2, attempt - 1)
    const jitterMs = Math.random() * 1000
    const delayMs = Math.max(retryAfter * 1000, backoffMs) + jitterMs

    logger.warn(
      {
        ...context,
        chatId: context.chatId ? maskChatId(context.chatId) : undefined,
        attempt,
        delaySeconds: Math.round(delayMs / 1000),
        initialRetryAfter
      },
      `Rate limited, retry attempt ${attempt}/${maxRetries} after ${Math.round(delayMs / 1000)}s`
    )

    await new Promise((resolve) => setTimeout(resolve, delayMs))

    try {
      await fn()
      logger.info(
        {
          ...context,
          chatId: context.chatId ? maskChatId(context.chatId) : undefined,
          attempt,
          totalDelayMs: Math.round(delayMs / 1000)
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
        logger.error(
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
