/**
 * Adapter interface for Telegraf bot API
 * Provides testable abstraction over Telegraf's telegram methods
 */

/**
 * Creates a TelegrafAdapter from a Telegraf bot instance
 * @param {import('telegraf').Telegraf} bot - Telegraf bot instance
 * @returns {TelegrafAdapter}
 */
export function createTelegrafAdapter(bot) {
  return {
    async deleteWebhook(options) {
      return bot.telegram.deleteWebhook(options)
    },

    async getMe() {
      return bot.telegram.getMe()
    },

    async sendMessage(chatId, text, options) {
      return bot.telegram.sendMessage(chatId, text, options)
    },

    async sendPhoto(chatId, photo, options) {
      return bot.telegram.sendPhoto(chatId, photo, options)
    },

    async sendVideo(chatId, video, options) {
      return bot.telegram.sendVideo(chatId, video, options)
    },

    async sendAudio(chatId, audio, options) {
      return bot.telegram.sendAudio(chatId, audio, options)
    },

    async sendVoice(chatId, voice, options) {
      return bot.telegram.sendVoice(chatId, voice, options)
    },

    async sendDocument(chatId, document, options) {
      return bot.telegram.sendDocument(chatId, document, options)
    }
  }
}

/**
 * @typedef {Object} TelegrafAdapter
 * @property {(options: any) => Promise<boolean>} deleteWebhook
 * @property {() => Promise<any>} getMe
 * @property {(chatId: number|string, text: string, options?: any) => Promise<any>} sendMessage
 * @property {(chatId: number|string, photo: any, options?: any) => Promise<any>} sendPhoto
 * @property {(chatId: number|string, video: any, options?: any) => Promise<any>} sendVideo
 * @property {(chatId: number|string, audio: any, options?: any) => Promise<any>} sendAudio
 * @property {(chatId: number|string, voice: any, options?: any) => Promise<any>} sendVoice
 * @property {(chatId: number|string, document: any, options?: any) => Promise<any>} sendDocument
 */
