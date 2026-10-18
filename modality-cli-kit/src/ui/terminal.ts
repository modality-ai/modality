/**
 * Shared terminal escape sequences and helpers for interactive CLI modes.
 *
 * Consumed by interactive `--watch` loops that redraw in place — these are
 * **not** for general CLI output (use the color helpers in `modality-cli-kit/help`).
 */

// ── ANSI escape codes ───────────────────────────────────────────────────────

/** Move cursor to top-left (home). */
export const CURSOR_HOME = "\x1b[H";

/** Hide cursor (restore with `SHOW_CURSOR`). */
export const HIDE_CURSOR = "\x1b[?25l";

/** Show cursor. */
export const SHOW_CURSOR = "\x1b[?25h";

/** Clear entire screen. */
export const CLEAR_SCREEN = "\x1b[2J";

/** Clear from cursor to end of screen. */
export const CLEAR_BELOW = "\x1b[0J";

/** OSC 0 prefix — sets the terminal's icon name + window title. */
export const SET_TITLE = "\x1b]0;";

/** ASCII BEL — terminates an OSC sequence. */
export const BELL = "\x07";

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Usable terminal width in columns. Subtracts 1 because many terminals clip
 * the last column (pushing right borders off-screen). Falls back to 120 when
 * stdout is not a TTY.
 */
export function termWidth(): number {
  return Math.max(40, (process.stdout.columns ?? 120) - 1);
}

/**
 * Async sleep. Returns a promise that resolves after `ms` milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Draw content to the terminal: prepend `CURSOR_HOME`, per-line `\x1b[K` to
 * clear trailing debris from shorter lines, then `CLEAR_BELOW`.
 */
export function draw(content: string): void {
  const cleared = content
    .split("\n")
    .map((l) => l + "\x1b[K")
    .join("\n");
  process.stdout.write(CURSOR_HOME + cleared + "\n" + CLEAR_BELOW);
}

/**
 * Set the terminal's title bar (icon name + window title) — used by watch-mode
 * loops to surface live status in the tab/title bar, e.g.
 * `writeTitle("🔴 🟡  XXX  DAY  09:28:00")`.
 */
export function writeTitle(title: string): void {
  process.stdout.write(`${SET_TITLE}${title}${BELL}`);
}

// ── Watch-cycle timer ────────────────────────────────────────────────────────

/**
 * Status line for the wait-state frame a watch loop draws while its data
 * fetch runs: the countdown stops here, the stale frame is relabeled
 * [Refreshing...], and counting resumes only after the fresh render lands.
 * `ts` (a HH:MM:SS clock string) is appended by timestamped loops; loops
 * without a clock use the plain form.
 */
export function refreshingStatus(ts?: string): string {
  return ts === undefined ? "[Refreshing...]" : `[Refreshing  ${ts}]`;
}

/**
 * Compose a countdown tick line: `${statusLine}  next: Ns`, with N
 * right-padded to the interval's width so "next: 10s" and "next:  2s" align.
 */
export function nextTickStatus(
  statusLine: string,
  remaining: number,
  interval: number
): string {
  const width = String(interval).length;
  return `${statusLine}  next: ${String(remaining).padStart(width, " ")}s`;
}

/**
 * Taipei HH:MM:SS clock string — stamped onto every frame status line by
 * timestamped watch loops.
 */
export function taipeiClock(): string {
  return new Date().toLocaleTimeString("en-GB", {
    timeZone: "Asia/Taipei",
    hour12: false,
  });
}

/**
 * Live status line — `[Live  ${ts}]`, stamped with the clock string captured
 * AFTER the fetch (the wait-state frame above used the pre-fetch clock).
 */
export function liveStatus(ts: string): string {
  return `[Live  ${ts}]`;
}

/**
 * Error status line — the message is truncated to 50 chars so a long error
 * can't blow out the frame width, then stamped with the cycle clock string.
 */
export function errorStatus(msg: string, ts: string): string {
  return `[Error: ${msg.slice(0, 50)}  ${ts}]`;
}

/**
 * One countdown between refresh cycles — the shared timer contract for every
 * `--watch` loop: ticks once per second from `interval` down to 1, invoking
 * `onTick(remaining)` so the caller redraws its frame with the "next: Ns"
 * suffix. The fetch happens OUTSIDE this helper (after the last tick, before
 * the next fresh render), so the timer never counts during a fetch.
 */
export async function watchCountdown(
  interval: number,
  onTick: (remaining: number) => void
): Promise<void> {
  for (let t = interval; t > 0; t--) {
    onTick(t);
    await sleep(1000);
  }
}
