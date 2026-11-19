// Warp desktop notification backend — warp://cli-agent OSC 777 protocol (or
// legacy plain-text when the protocol is unavailable). Errors are swallowed:
// a failed notification should never crash the caller.

import { openSync, writeSync, closeSync } from "node:fs";
import { basename } from "node:path";
import { randomUUID } from "node:crypto";
// macOS is the default backend and owns the shared NotifyOpts contract; Warp
// builds on top of it (layering is intentional, not accidental).
import { sendMacOSNotification, escapeAscii } from "./notify-macos";
import type { NotifyOpts } from "./notify-macos";

export type { NotifyOpts } from "./notify-macos";
export { escapeAscii, sendMacOSNotification } from "./notify-macos";

const WARP_AGENT_TITLE = "warp://cli-agent";
const WARP_AGENT_SLUG = "claude";
const WARP_SESSION_ID = process.env.WARP_TERMINAL_SESSION_UUID ?? randomUUID();

/** Join subtitle + message the way every Warp payload expects. */
function warpBody(opts: NotifyOpts): string {
  return opts.subtitle ? `${opts.subtitle} — ${opts.message}` : opts.message;
}

/** Build a legacy plain-text OSC 777 escape sequence. Pure function. */
export function formatWarpSequence(opts: NotifyOpts): string {
  const body = warpBody(opts);
  return `\x1b]777;notify;${escapeAscii(opts.title)};${escapeAscii(body)}\x07`;
}

/** Build a warp://cli-agent structured OSC 777 sequence. */
export function formatWarpAgentSequence(
  event: string,
  extra: Record<string, unknown> = {},
): string {
  const cwd = process.cwd();
  const payload = {
    v: 1,
    agent: WARP_AGENT_SLUG,
    event,
    session_id: WARP_SESSION_ID,
    cwd,
    project: basename(cwd) || "workspace",
    ...extra,
  };
  // Escape semicolons as \u003b so a naive OSC splitter can't break the body field;
  // JSON.parse still yields the original ';'. Quotes/control chars are already
  // handled by JSON.stringify.
  return `\x1b]777;notify;${WARP_AGENT_TITLE};${JSON.stringify(payload).replace(/;/g, "\\u003b")}\x07`;
}

/** Write an OSC sequence to the controlling terminal. */
export function writeOscSequence(seq: string): void {
  let ttyFd: number | undefined;
  try {
    ttyFd = openSync("/dev/tty", "w");
    writeSync(ttyFd, seq);
    return;
  } catch {
    // no controlling tty — fall through to stdout
  } finally {
    if (ttyFd !== undefined) closeSync(ttyFd);
  }
  try {
    process.stdout.write(seq);
  } catch {
    // stdout may be closed during shutdown — swallow
  }
}

export function planWarpSequences(
  opts: NotifyOpts,
  ctx: { hasProtocol: boolean; sessionRegistered: boolean },
): string[] {
  const body = warpBody(opts);
  if (!ctx.hasProtocol) {
    return [formatWarpSequence(opts)];
  }
  const seqs: string[] = [];
  if (!ctx.sessionRegistered) {
    seqs.push(formatWarpAgentSequence("session_start"));
    seqs.push(formatWarpAgentSequence("prompt_submit", { query: opts.title }));
  }
  seqs.push(formatWarpAgentSequence("stop", { query: opts.title, response: body }));
  return seqs;
}

let warpSessionRegistered = false;

/** Reset the session-registered flag (primarily for tests). */
export function resetWarpSession(): void {
  warpSessionRegistered = false;
}

export function sendWarpNotification(opts: NotifyOpts): void {
  try {
    const hasProtocol = !!process.env.WARP_CLI_AGENT_PROTOCOL_VERSION;
    for (const seq of planWarpSequences(opts, {
      hasProtocol,
      sessionRegistered: warpSessionRegistered,
    })) {
      writeOscSequence(seq);
    }
    if (hasProtocol) warpSessionRegistered = true;
  } catch {
    // swallow
  }
}

/** Fire-and-forget notification dispatch. method: "warp" | "macos" (default macos). */
export function sendNotification(opts: NotifyOpts, method: string = "macos"): void {
  if (method === "warp") {
    sendWarpNotification(opts);
  } else {
    sendMacOSNotification(opts);
  }
}
