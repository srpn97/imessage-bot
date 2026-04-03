/**
 * Example: Weight Tracker Bot
 *
 * A more real-world example. Members of a group chat log their weight
 * using /w commands. The bot parses the command, stores the data (here
 * in-memory for simplicity), and replies with their history on request.
 *
 * Supported commands:
 *   /w 75.5         → log 75.5 kg
 *   /w 166 lbs      → log in pounds (auto-converted)
 *   /w last 5       → show last 5 entries
 *   /w all          → show full history
 *
 * In a real deployment you'd replace the in-memory store with a database
 * (Supabase, SQLite, Postgres, etc.).
 *
 * Usage:
 *   1. Run `npm run find-chats` to get your chat GUID
 *   2. Replace CHAT_GUID below
 *   3. npx tsx examples/weight-bot.ts
 */
import { createPoller } from "../src/index.js";

const CHAT_GUID = "YOUR_CHAT_GUID_HERE";

// ─── In-memory weight store ───────────────────────────────────────────────────
// Replace this with your actual database calls.

interface WeightEntry {
  date: string; // YYYY-MM-DD
  kg: number;
}

const store = new Map<string, WeightEntry[]>(); // senderId → entries[]

function saveWeight(senderId: string, date: string, kg: number) {
  const entries = store.get(senderId) ?? [];
  // Replace same-day entry if it exists
  const idx = entries.findIndex((e) => e.date === date);
  if (idx >= 0) entries.splice(idx, 1);
  entries.push({ date, kg });
  entries.sort((a, b) => b.date.localeCompare(a.date)); // newest first
  store.set(senderId, entries);
}

function getHistory(senderId: string, limit?: number): WeightEntry[] {
  const entries = store.get(senderId) ?? [];
  return limit ? entries.slice(0, limit) : entries;
}

// ─── Command parser ───────────────────────────────────────────────────────────

type Command =
  | { type: "log"; kg: number }
  | { type: "showLast"; count: number }
  | { type: "showAll" };

function parseCommand(text: string): Command | null {
  const t = text.trim();

  if (/^\/w\s+all\s*$/i.test(t)) return { type: "showAll" };
  if (/^\/w\s+show\s*$/i.test(t)) return { type: "showLast", count: 5 };

  const lastMatch = t.match(/^\/w\s+last\s+(\d+)\s*$/i);
  if (lastMatch) return { type: "showLast", count: parseInt(lastMatch[1]) };

  const logMatch = t.match(/^\/w\s+(\d+(?:\.\d+)?)\s*(kg|kgs|lbs|lb)?\s*$/i);
  if (logMatch) {
    const value = parseFloat(logMatch[1]);
    const unit = (logMatch[2] ?? "kg").toLowerCase();
    const kg =
      unit === "lbs" || unit === "lb"
        ? Math.round(value * 0.453592 * 100) / 100
        : value;
    if (kg < 30 || kg > 300) return null;
    return { type: "log", kg };
  }

  return null;
}

// ─── History formatter ────────────────────────────────────────────────────────

function formatHistory(
  senderId: string,
  entries: WeightEntry[],
  title: string,
): string {
  if (entries.length === 0) return `📭 No entries found for ${senderId}.`;

  const lines = [title, ""];
  for (let i = 0; i < entries.length; i++) {
    const { date, kg } = entries[i];
    const label = new Date(date).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
    let delta = "";
    if (i < entries.length - 1) {
      const diff = kg - entries[i + 1].kg;
      delta = `  ${diff > 0 ? "↑" : diff < 0 ? "↓" : "–"} ${diff > 0 ? "+" : ""}${diff.toFixed(1)}`;
    }
    lines.push(`${label}  ${kg.toFixed(1)} kg${delta}`);
  }
  return lines.join("\n");
}

// ─── Bot ──────────────────────────────────────────────────────────────────────

const bot = createPoller({
  chatGuid: CHAT_GUID,

  onReady: ({ chatGuid }) => {
    console.log(`⚖️  Weight bot started on ${chatGuid}`);
  },

  onMessage: async ({ message, reply }) => {
    const command = parseCommand(message.text);
    if (!command) return;

    const id = message.senderId;
    const dateStr = new Date(message.date).toISOString().split("T")[0];

    if (command.type === "log") {
      saveWeight(id, dateStr, command.kg);
      console.log(`✅ ${id} logged ${command.kg} kg on ${dateStr}`);
      await reply(`✅ Logged ${command.kg} kg for ${dateStr}`);
      return;
    }

    const limit = command.type === "showAll" ? undefined : command.count;
    const history = getHistory(id, limit);
    const title =
      command.type === "showAll"
        ? `📊 Your full history (${history.length} entries):`
        : `📊 Your last ${command.count} entries:`;
    await reply(formatHistory(id, history, title));
  },

  onError: (err) => {
    console.error("❌ Bot error:", err.message);
  },
});

bot.start();
