# imessage-bot

[![npm version](https://img.shields.io/npm/v/imessage-bot)](https://www.npmjs.com/package/imessage-bot)
[![npm downloads](https://img.shields.io/npm/dm/imessage-bot)](https://www.npmjs.com/package/imessage-bot)

> **Use at your own risk.** This project reads from your local iMessage database and sends messages via AppleScript. The author is not liable for any unintended messages sent, data accessed, or consequences arising from use of this software. Review the code before running it.

A Node.js toolkit for reading and responding to iMessages on macOS.

I originally built this to power a weight-tracking accountability bot for a friend group — members log their weight via iMessage commands, the bot parses them and stores the data. Friends wanted to use the polling layer for their own projects, so I extracted it into this standalone toolkit.

Poll any iMessage group chat or direct message, react to commands, and send replies — all from a TypeScript script running on your Mac.

## Requirements

- **macOS** (uses the local Messages database and AppleScript)
- **Node.js 18+**
- **Full Disk Access** granted to Terminal (or your IDE) — see below

---

## ⚠️ Full Disk Access — Read This First

This is the most common setup issue. Without it, Node.js cannot read `~/Library/Messages/chat.db` and you'll get a permission error immediately.

### How to grant it

1. Open **System Settings → Privacy & Security → Full Disk Access**
2. Click the **+** button and add **Terminal.app** (located in `/Applications/Utilities/`)
3. Make sure the toggle next to Terminal is **on**
4. Fully quit and reopen Terminal

### Known UI quirk

On some macOS versions, after adding Terminal via the **+** button it may not appear visually in the list — but it has actually been granted. This is a known display glitch.

**To verify it actually worked**, run this in Terminal:

```bash
sqlite3 ~/Library/Messages/chat.db ".tables"
```

- If you see a list of table names → Full Disk Access is working correctly.
- If you see `unable to open database file` → it was not granted. Try removing and re-adding Terminal, then restart your Mac.

> If you're running your bot from VS Code or another IDE instead of Terminal, you need to grant Full Disk Access to **that app** instead.

## Installation

```bashnpm install imessage-bot
```

Or clone and run locally:

```bashgit clone https://github.com/yourusername/imessage-bot.git
cd imessage-bot
npm install
```

## Quick Start

### 1. Find your chat GUID

```bash
npm run find-chats
```

This lists all your iMessage chats with their GUIDs. Copy the one you want.

### 2. Write your bot

```ts
// my-bot.ts
import { createPoller } from "./src/index.js";

const bot = createPoller({
  chatGuid: "iMessage;+;chat123456789", // paste your GUID here
  onMessage: async ({ message, reply }) => {
    if (message.text === "!ping") {
      await reply("pong!");
    }
  },
});

bot.start();
```

```bash
npx tsx my-bot.ts
```

That's it. Your bot is running.

---

## API

### `createPoller(options)`

The main entry point. Returns a `Poller` with `start()` and `stop()` methods.

```ts
import { createPoller } from "./src/index.js";

const bot = createPoller({
  chatGuid: "iMessage;+;chat123", // required
  pollIntervalMs: 10_000, // default: 10 seconds
  seedWeeksBack: 1, // how far back to look on first run (just for watermarking, not processing)
  stateFile: "~/.my-bot-state.json", // where to persist the ROWID watermark

  onReady: ({ chatGuid, stateFile }) => {
    console.log(`Bot started, state at ${stateFile}`);
  },

  onMessage: async ({ message, reply, chatGuid }) => {
    // message.text     — the message text
    // message.senderId — phone number (e.g. "+15551234567") or "Me"
    // message.isFromMe — boolean
    // message.date     — JS timestamp in ms
    // message.rowid    — iMessage database row ID
    // reply(text)      — send a reply to the same chat
    // chatGuid         — the GUID of the chat
  },

  onError: (err) => {
    console.error("Error:", err.message);
  },
});

bot.start();
// bot.stop(); // gracefully stops polling
```

### `sendMessage(chatGuid, text)`

Send a message to any chat directly, without the poller.

```ts
import { sendMessage } from "./src/index.js";

await sendMessage("iMessage;+;chat123", "Hello from my bot!");
```

### `findChats(options?)`

List chats programmatically.

```ts
import { findChats } from "./src/index.js";

const all = findChats(); // all chats
const groups = findChats({ groupOnly: true, limit: 20 }); // group chats only
```

Returns `ChatInfo[]`:

```ts
interface ChatInfo {
  guid: string;
  displayName: string | null;
  chatIdentifier: string;
  isGroup: boolean;
}
```

### `getChatParticipants(chatGuid)`

Get the phone numbers of all participants in a chat.

```ts
import { getChatParticipants } from "./src/index.js";

const numbers = getChatParticipants("iMessage;+;chat123");
// ['+15551234567', '+15559876543']
```

---

## Examples

Both examples are ready to run after replacing `YOUR_CHAT_GUID_HERE`.

| Example    | Command                          | What it does                     |
| ---------- | -------------------------------- | -------------------------------- |
| Echo bot   | `npx tsx examples/echo-bot.ts`   | `!echo` and `!ping` commands     |
| Weight bot | `npx tsx examples/weight-bot.ts` | `/w` weight logging with history |

---

## Running as a Background Service (launchd)

To keep your bot running permanently on macOS, register it as a launchd agent.

Create `~/Library/LaunchAgents/com.imessage-bot.mybot.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.imessage-bot.mybot</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>--import</string>
    <string>tsx/esm</string>
    <string>/absolute/path/to/my-bot.ts</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/imessage-bot.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/imessage-bot.err</string>
</dict>
</plist>
```

```bash
launchctl load ~/Library/LaunchAgents/com.imessage-bot.mybot.plist
launchctl start com.imessage-bot.mybot
```

---

## How It Works

```
iMessage → chat.db (SQLite, read-only)
               ↓  polled every N seconds via ROWID watermark
          imessage-bot
               ↓  onMessage handler
          your code (store data, call APIs, etc.)
               ↓  reply()
          AppleScript → Messages.app → iMessage reply
```

**ROWID watermark**: The poller tracks the last-seen message row ID in a local state file. On each poll it only fetches rows newer than that ID — no duplicate processing, no re-reading old messages.

**First run**: On first start, the poller seeds the watermark from existing messages without processing them. Your bot only reacts to messages sent _after_ it starts for the first time.

---

## Limitations

- macOS only — relies on `~/Library/Messages/chat.db` and AppleScript
- Requires the Mac to be awake and Messages.app to be running
- Sending messages via AppleScript requires Messages.app to be signed in to the Apple ID that owns the chat
- Polling is not real-time — default latency is up to 10 seconds (configurable)

---

## License

MIT
