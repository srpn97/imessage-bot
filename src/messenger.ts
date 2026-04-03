import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

/**
 * Send a message to an iMessage chat via AppleScript.
 *
 * Requires Messages.app to be signed in and the chat to exist.
 * The `chatGuid` can be obtained from `findChats()` or `npm run find-chats`.
 */
export async function sendMessage(
  chatGuid: string,
  text: string,
): Promise<void> {
  // Escape for AppleScript string literal
  const escaped = text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

  const script = `
    tell application "Messages"
      set targetChat to chat id "${chatGuid}"
      send "${escaped}" to targetChat
    end tell
  `;

  // Escape single quotes for the shell -e argument
  await execAsync(`osascript -e '${script.replace(/'/g, "'\\''")}'`);
}
