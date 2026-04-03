/**
 * CLI utility to discover your iMessage chat GUIDs.
 *
 * Run with: npm run find-chats
 *
 * Copy the GUID of your target chat and use it as the `chatGuid` option
 * when calling `createPoller()`.
 *
 * Note: Group chat names are only stored in chat.db when the group has been
 * explicitly named inside Messages.app. Otherwise the name is NULL — this is
 * a macOS limitation, not a bug. Participants are shown so you can identify
 * which chat is which.
 */
import { findChats, getChatParticipants } from "./db.js";

console.log("🔍 Scanning iMessage chats...\n");

const chats = findChats({ limit: 50 });

if (chats.length === 0) {
  console.log(
    "No chats found. Make sure Full Disk Access is enabled for Terminal.",
  );
  console.log("System Settings → Privacy & Security → Full Disk Access");
  process.exit(1);
}

const groups = chats.filter((c) => c.isGroup);
const direct = chats.filter((c) => !c.isGroup);

if (groups.length > 0) {
  console.log(`─── Group Chats (${groups.length}) ─────────────────────────`);
  for (const chat of groups) {
    const participants = getChatParticipants(chat.guid);
    const name = chat.displayName || "(no name set in Messages.app)";
    console.log(`Name         : ${name}`);
    console.log(`GUID         : ${chat.guid}`);
    console.log(
      `Participants : ${participants.length > 0 ? participants.join(", ") : "none found"}`,
    );
    console.log("");
  }
}

if (direct.length > 0) {
  console.log(`─── Direct Messages (${direct.length}) ──────────────────────`);
  for (const chat of direct) {
    console.log(`Contact : ${chat.chatIdentifier}`);
    console.log(`GUID    : ${chat.guid}`);
    console.log("");
  }
}

console.log(
  "💡 Copy the GUID above and pass it as chatGuid to createPoller().",
);
