// macOS Notification Center backend — osascript banner. Built into every Mac;
// shows even while Warp is focused. Errors are swallowed: a failed notification
// should never crash the caller.

import { spawn } from "node:child_process";

// The payload handed to a notification backend. Defined here so both backends
// share one type definition.
export interface NotifyOpts {
  title:    string;
  subtitle: string;
  message:  string;
}

/** Escape characters that have special meaning in AppleScript string literals
 *  or OSC 777 terminal escape sequences.
 *
 *  - Backslash (\) — escape char in AppleScript and OSC
 *  - Double-quote (") — string delimiter in AppleScript
 *  - Semicolon (;) — field delimiter in OSC 777 (title/body split)
 *  - Newline (\n) — would break AppleScript's single-line `display notification`
 *  - Remaining C0 control chars (ESC \x1b, BEL \x07, …) are stripped: a raw ESC
 *    or BEL in the input could terminate the OSC sequence early and inject
 *    terminal control codes on the legacy formatWarpSequence path.
 */
export function escapeAscii(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/;/g, "\\;")
    .replace(/\n/g, "\\n")
    .replace(/[\x00-\x1f]/g, ""); // newlines already escaped above; strip the rest
}

/** Escape a string for embedding inside an AppleScript double-quoted string
 *  literal. AppleScript does NOT honor backslash escapes inside strings — a
 *  quote is embedded by doubling it (`""`), and a backslash is just a
 *  backslash. Newlines collapse to a space because `display notification` is a
 *  single-line `-e` argument. */
function escapeAppleScript(s: string): string {
  return s
    .replace(/"/g, '""')
    .replace(/\n/g, " ")
    .replace(/[\x00-\x1f\x7f]/g, "");
}

/** macOS Notification Center alert via osascript. Never throws — swallows a
 *  missing osascript (non-macOS) via the child error handler. */
export function sendMacOSNotification(opts: NotifyOpts): void {
  try {
    const child = spawn("osascript", [
      "-e",
      `display notification "${escapeAppleScript(opts.message)}" with title "${escapeAppleScript(opts.title)}" subtitle "${escapeAppleScript(opts.subtitle)}"`,
    ]);
    child.on("error", () => {}); // osascript absent (non-macOS) — swallow
    child.unref();
  } catch {
    // spawn threw synchronously — swallow
  }
}
