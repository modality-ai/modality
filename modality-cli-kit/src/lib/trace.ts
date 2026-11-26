/**
 * `--trace` — the dispatch tracer.
 *
 * A CLI that misbehaves usually misbehaves *before* the handler runs: the wrong
 * command resolved, an env var injected a format flag, an arg coerced to
 * something unexpected, or a `methodsDir` pointed somewhere stale. None of that
 * is visible from the outside — the runner resolves, validates and dispatches
 * silently, and all the reader sees is the result.
 *
 * This module turns that path into output, but only when `--trace` is passed.
 * Silence is the contract: with the flag absent the tracer is inert, `step()`
 * builds no strings, and not one byte reaches the terminal.
 *
 * ## Why stderr
 *
 * Trace lines go to **stderr**, never stdout. A kit CLI's stdout is a data
 * channel — `--json` envelopes, and the `merge` command exists precisely to
 * fold a piped chain of them into one document. Tracing to stdout would corrupt
 * every one of those pipelines, so `cli cmd --json --trace | jq` stays valid and
 * the trace still shows up on the terminal.
 */
import { dim } from "../help/colors";

/** Emits the runner's dispatch path, or does nothing. See the module doc. */
export interface Tracer {
  /** Whether `--trace` was passed. Guard expensive detail construction on it. */
  readonly enabled: boolean;
  /**
   * Record one step of the dispatch path.
   *
   * @param label What happened, e.g. `"resolved command"`.
   * @param detail The value involved. Strings print as-is; anything else is
   *               JSON — so an args object or a string[] reads properly.
   */
  step(label: string, detail?: unknown): void;
}

/** The tracer used whenever `--trace` is absent: every call is a no-op. */
const INERT: Tracer = { enabled: false, step() {} };

/**
 * Key names whose values must never reach the trace. A validated args object
 * carries whatever the CLI declared, and `--token` / `--api-key` values would
 * otherwise be rendered in full onto stderr — which is exactly what gets
 * captured into CI logs and pasted into bug reports.
 */
const SECRET_KEY = /token|key|secret|password|passwd|auth|credential/i;

const REDACTED = "***";

/**
 * Replace the values of secret-looking keys, at any depth, with {@link REDACTED}.
 * Non-objects pass through untouched — only a keyed value can be identified as
 * a secret by its name.
 */
function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, inner]) => [
      key,
      SECRET_KEY.test(key) ? REDACTED : redact(inner),
    ]),
  );
}

/**
 * Render a detail value: strings as themselves, everything else as JSON with
 * secret-looking keys redacted.
 */
function render(detail: unknown): string {
  if (typeof detail === "string") return detail;
  try {
    return JSON.stringify(redact(detail)) ?? String(detail);
  } catch {
    // A circular or otherwise unserializable value must not break a debug aid.
    return String(detail);
  }
}

/**
 * Build a {@link Tracer} for one run.
 *
 * @param enabled Whether `--trace` was present in the pre-terminator flags.
 * @param cliName Prefixed onto every line, so a trace from a piped chain of
 *                CLIs still says which one produced it.
 * @param write   Sink for the lines (default: `console.error`). Tests pass a
 *                buffer; production has no reason to.
 */
export function createTracer(
  enabled: boolean,
  cliName: string,
  write: (line: string) => void = (line) => console.error(line),
): Tracer {
  if (!enabled) return INERT;
  return createLiveTracer(cliName, write);
}

function createLiveTracer(cliName: string, write: (line: string) => void): Tracer {
  return {
    enabled: true,
    step(label: string, detail?: unknown) {
      const suffix = detail === undefined ? "" : ` ${render(detail)}`;
      // `dim` decides on stdout's TTY, but these lines go to stderr — a piped
      // stdout drops the dimming even on a live terminal. Conservative, and
      // cheaper than a second detection path.
      write(dim(`[trace] ${cliName}: ${label}${suffix}`));
    },
  };
}
