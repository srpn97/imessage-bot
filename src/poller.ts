import { getMessagesFromChat, type RawMessage } from "./db.js";
import { sendMessage } from "./messenger.js";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

// ─── Types ───────────────────────────────────────────────────────────────────

export type { RawMessage };

export interface MessageContext {
  /** The incoming message */
  message: RawMessage;
  /** The GUID of the chat this message was received in */
  chatGuid: string;
  /** Send a reply to the same chat */
  reply: (text: string) => Promise<void>;
}

export interface PollerOptions {
  /** Chat GUID to monitor. Get this by running: npm run find-chats */
  chatGuid: string;

  /**
   * How often to poll for new messages, in milliseconds.
   * @default 10000 (10 seconds)
   */
  pollIntervalMs?: number;

  /**
   * On first run, how many weeks back to seed the ROWID watermark from.
   * Messages in this window are NOT processed — the poller just advances past them
   * so it only reacts to messages sent after it starts.
   * @default 1
   */
  seedWeeksBack?: number;

  /**
   * Where to persist the ROWID watermark between restarts.
   * Defaults to ~/.imessage-bot-<hash>.json (one file per chatGuid).
   */
  stateFile?: string;

  /**
   * Called for every new message received in the chat.
   * Use `context.reply(text)` to respond.
   */
  onMessage: (context: MessageContext) => Promise<void> | void;

  /**
   * Called when an error occurs during a poll cycle.
   * If not provided, errors are logged to stderr.
   */
  onError?: (error: Error) => void;

  /**
   * Called once when the poller starts.
   */
  onReady?: (info: { chatGuid: string; stateFile: string }) => void;
}

export interface Poller {
  /** Start polling. Safe to call once. */
  start(): void;
  /** Stop polling and clear the interval. */
  stop(): void;
}

// ─── State helpers ───────────────────────────────────────────────────────────

function defaultStateFile(chatGuid: string): string {
  // Derive a short stable slug from the chat GUID so multiple bots don't collide
  const slug = Buffer.from(chatGuid).toString("base64url").slice(0, 16);
  return join(process.env.HOME || "", `.imessage-bot-${slug}.json`);
}

function loadState(stateFile: string): number {
  try {
    if (existsSync(stateFile)) {
      const data = JSON.parse(readFileSync(stateFile, "utf-8"));
      return typeof data.lastSeenRowId === "number" ? data.lastSeenRowId : 0;
    }
  } catch {
    // corrupt or missing — start fresh
  }
  return 0;
}

function saveState(stateFile: string, lastSeenRowId: number): void {
  writeFileSync(stateFile, JSON.stringify({ lastSeenRowId }), "utf-8");
}

// ─── createPoller ────────────────────────────────────────────────────────────

/**
 * Create an iMessage bot that polls a chat for new messages.
 *
 * @example
 * ```ts
 * import { createPoller } from 'imessage-bot';
 *
 * const bot = createPoller({
 *   chatGuid: 'iMessage;+;chat123456',
 *   onMessage: async ({ message, reply }) => {
 *     if (message.text === '!ping') {
 *       await reply('pong!');
 *     }
 *   },
 * });
 *
 * bot.start();
 * ```
 */
export function createPoller(options: PollerOptions): Poller {
  const {
    chatGuid,
    pollIntervalMs = 10_000,
    seedWeeksBack = 1,
    onMessage,
    onError,
    onReady,
  } = options;

  const stateFile = options.stateFile ?? defaultStateFile(chatGuid);
  let lastSeenRowId = loadState(stateFile);
  let intervalHandle: ReturnType<typeof setInterval> | null = null;
  let running = false;

  async function poll(): Promise<void> {
    try {
      const isFirstRun = lastSeenRowId === 0;
      const messages = getMessagesFromChat(
        chatGuid,
        seedWeeksBack,
        lastSeenRowId,
      );

      if (isFirstRun) {
        if (messages.length > 0) {
          lastSeenRowId = Math.max(...messages.map((m) => m.rowid));
          saveState(stateFile, lastSeenRowId);
        }
        return;
      }

      if (messages.length === 0) return;

      for (const message of messages) {
        const context: MessageContext = {
          message,
          chatGuid,
          reply: (text: string) => sendMessage(chatGuid, text),
        };

        try {
          await onMessage(context);
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          if (onError) {
            onError(error);
          } else {
            console.error(`[imessage-bot] onMessage error:`, error.message);
          }
        }
      }

      lastSeenRowId = Math.max(...messages.map((m) => m.rowid));
      saveState(stateFile, lastSeenRowId);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      if (onError) {
        onError(error);
      } else {
        console.error(`[imessage-bot] Poll error:`, error.message);
      }
    }
  }

  return {
    start() {
      if (running) return;
      running = true;

      onReady?.({ chatGuid, stateFile });

      // Immediate first poll, then on interval
      poll();
      intervalHandle = setInterval(poll, pollIntervalMs);

      process.on("SIGINT", () => this.stop());
      process.on("SIGTERM", () => this.stop());
    },

    stop() {
      if (!running) return;
      running = false;
      if (intervalHandle !== null) {
        clearInterval(intervalHandle);
        intervalHandle = null;
      }
    },
  };
}
