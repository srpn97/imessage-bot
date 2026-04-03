/**
 * Example: Echo Bot
 *
 * Responds to any message starting with "!echo" by repeating it back.
 * The simplest possible demonstration of imessage-bot.
 *
 * Usage:
 *   1. Run `npm run find-chats` to get your chat GUID
 *   2. Replace CHAT_GUID below
 *   3. npx tsx examples/echo-bot.ts
 */
import { createPoller } from "../src/index.js";

const CHAT_GUID = "YOUR_CHAT_GUID_HERE"; // e.g. "iMessage;+;chat123456789"

const bot = createPoller({
  chatGuid: CHAT_GUID,

  onReady: ({ chatGuid, stateFile }) => {
    console.log(`🤖 Echo bot started`);
    console.log(`   Chat  : ${chatGuid}`);
    console.log(`   State : ${stateFile}`);
  },

  onMessage: async ({ message, reply }) => {
    const text = message.text.trim();

    if (text.toLowerCase().startsWith("!echo ")) {
      const response = text.slice(6).trim();
      await reply(response);
    }

    if (text.toLowerCase() === "!ping") {
      await reply("pong!");
    }
  },

  onError: (err) => {
    console.error("❌ Bot error:", err.message);
  },
});

bot.start();
