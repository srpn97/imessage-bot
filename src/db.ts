import Database from "better-sqlite3";
import { join } from "path";
import { existsSync } from "fs";
import { Unarchiver } from "node-typedstream";

const DB_PATH = join(process.env.HOME || "", "Library/Messages/chat.db");

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ChatInfo {
  guid: string;
  displayName: string | null;
  chatIdentifier: string;
  isGroup: boolean;
}

export interface RawMessage {
  rowid: number;
  text: string;
  date: number; // JS timestamp in ms
  senderId: string; // phone number or "Me"
  isFromMe: boolean;
}

interface RawDbMessage {
  rowid: number;
  text: string | null;
  attributedBody: Buffer | null;
  date: number;
  sender_id: string;
  is_from_me: number;
}

// ─── Internal helpers ────────────────────────────────────────────────────────

function getDb(): Database.Database {
  if (!existsSync(DB_PATH)) {
    throw new Error(
      `iMessage database not found at ${DB_PATH}.\n` +
        `Make sure Full Disk Access is enabled for Terminal (or your IDE) in:\n` +
        `System Settings → Privacy & Security → Full Disk Access`,
    );
  }
  return new Database(DB_PATH, { readonly: true });
}

/**
 * Apple stores timestamps as nanoseconds since 2001-01-01.
 * Convert to a standard JS timestamp (ms since 1970-01-01).
 */
function appleTimestampToMs(ts: number): number {
  const APPLE_EPOCH_OFFSET_S = 978307200; // seconds between Unix and Apple epochs
  return (ts / 1_000_000_000 + APPLE_EPOCH_OFFSET_S) * 1000;
}

/**
 * Decode binary iMessage attributedBody blobs (NSAttributedString).
 * Uses node-typedstream — the same approach used by BlueBubbles server.
 */
function extractTextFromAttributedBody(body: Buffer | null): string | null {
  if (!body || body.length === 0) return null;

  try {
    const decoded = Unarchiver.open(body).decodeAll();
    if (!decoded) return null;

    const items = (Array.isArray(decoded) ? decoded : [decoded]).flat();

    for (const item of items) {
      if (item && typeof item === "object") {
        if (
          "string" in item &&
          typeof item.string === "string" &&
          item.string.trim()
        ) {
          return item.string.trim();
        }
        if ("values" in item && Array.isArray(item.values)) {
          for (const val of item.values) {
            if (
              val &&
              typeof val === "object" &&
              "string" in val &&
              typeof val.string === "string" &&
              val.string.trim()
            ) {
              return val.string.trim();
            }
          }
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * List chats. By default returns all chats.
 * Pass `groupOnly: true` to return only group chats.
 */
export function findChats(
  options: { limit?: number; groupOnly?: boolean } = {},
): ChatInfo[] {
  const { limit = 50, groupOnly = false } = options;
  const db = getDb();

  const query = `
    SELECT c.guid, c.display_name, c.chat_identifier, c.style
    FROM chat c
    LEFT JOIN (
      SELECT cmj.chat_id, MAX(m.date) AS last_date
      FROM message m
      INNER JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
      GROUP BY cmj.chat_id
    ) last ON c.ROWID = last.chat_id
    ${groupOnly ? "WHERE c.style = 43" : ""}
    ORDER BY last.last_date DESC NULLS LAST
    LIMIT ?
  `;

  const rows = db.prepare(query).all(limit) as {
    guid: string;
    display_name: string | null;
    chat_identifier: string;
    style: number;
  }[];
  db.close();

  return rows.map((r) => ({
    guid: r.guid,
    displayName: r.display_name,
    chatIdentifier: r.chat_identifier,
    isGroup: r.style === 43,
  }));
}

/**
 * Fetch messages from a chat.
 *
 * - `lastSeenRowId > 0` → only messages newer than that ROWID (normal polling)
 * - `lastSeenRowId === 0` → messages from the last `weeksBack` weeks (first-run seed)
 */
export function getMessagesFromChat(
  chatGuid: string,
  weeksBack = 1,
  lastSeenRowId = 0,
): RawMessage[] {
  const db = getDb();

  let query: string;
  let params: (string | number)[];

  if (lastSeenRowId > 0) {
    query = `
      SELECT
        m.ROWID          AS rowid,
        m.text,
        m.attributedBody,
        m.date,
        m.is_from_me,
        COALESCE(h.id, 'Me') AS sender_id
      FROM message m
      INNER JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
      INNER JOIN chat c               ON cmj.chat_id = c.ROWID
      LEFT  JOIN handle h             ON m.handle_id = h.ROWID
      WHERE c.guid = ?
        AND m.ROWID > ?
        AND (m.text IS NOT NULL OR m.attributedBody IS NOT NULL)
      ORDER BY m.ROWID ASC
    `;
    params = [chatGuid, lastSeenRowId];
  } else {
    const startMs = Date.now() - weeksBack * 7 * 24 * 60 * 60 * 1000;
    const APPLE_EPOCH_OFFSET_S = 978307200;
    const startApple = (startMs / 1000 - APPLE_EPOCH_OFFSET_S) * 1_000_000_000;

    query = `
      SELECT
        m.ROWID          AS rowid,
        m.text,
        m.attributedBody,
        m.date,
        m.is_from_me,
        COALESCE(h.id, 'Me') AS sender_id
      FROM message m
      INNER JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
      INNER JOIN chat c               ON cmj.chat_id = c.ROWID
      LEFT  JOIN handle h             ON m.handle_id = h.ROWID
      WHERE c.guid = ?
        AND m.date > ?
        AND (m.text IS NOT NULL OR m.attributedBody IS NOT NULL)
      ORDER BY m.ROWID ASC
    `;
    params = [chatGuid, startApple];
  }

  const rows = db.prepare(query).all(...params) as RawDbMessage[];
  db.close();

  return rows
    .map((row): RawMessage | null => {
      const text =
        row.text || extractTextFromAttributedBody(row.attributedBody);
      if (!text?.trim()) return null;

      return {
        rowid: row.rowid,
        text: text.trim(),
        date: appleTimestampToMs(row.date),
        senderId: row.is_from_me ? "Me" : row.sender_id,
        isFromMe: row.is_from_me === 1,
      };
    })
    .filter((m): m is RawMessage => m !== null);
}

/**
 * Get all participant phone numbers for a chat.
 */
export function getChatParticipants(chatGuid: string): string[] {
  const db = getDb();

  const rows = db
    .prepare(
      `SELECT h.id
       FROM handle h
       INNER JOIN chat_handle_join chj ON h.ROWID = chj.handle_id
       INNER JOIN chat c               ON chj.chat_id = c.ROWID
       WHERE c.guid = ?`,
    )
    .all(chatGuid) as { id: string }[];

  db.close();
  return rows.map((r) => r.id);
}
