/**
 * Shared CLI output types for JSON, human-readable, and JSONL formats.
 *
 * Provides a consistent envelope for CLI commands to return structured
 * output that can be consumed by both humans and machines.
 *
 * ## Quick start
 *
 * ```ts
 * import { formatJSON, formatJSONL, formatHuman, type CLIResult } from "modality-cli-kit";
 *
 * const envelope: CLIResult = { success: true, result: { id: 1 } };
 * console.log(formatJSON(envelope, { pretty: true }));
 * ```
 */

// ── Format enum ──────────────────────────────────────────────────────────────

/** Supported output formats. */
export type OutputFormat = "json" | "human" | "jsonl";

/** Every format an `OUTPUT` env var may name. */
const OUTPUT_FORMATS: readonly OutputFormat[] = ["human", "json", "jsonl"];

/**
 * Environment variables consulted for a default output format, most specific
 * first: a CLI-scoped name (`use-stock` → `USE_STOCK_OUTPUT`) so one tool's
 * setting can't leak into another's, then the shared `OUTPUT`.
 */
export function outputFormatEnvNames(cliName: string): string[] {
  // Collapse separator runs, then trim the edges so a leading or trailing
  // separator can't double up against the suffix ("use stock v2!" → USE_STOCK_V2_OUTPUT).
  const scoped = cliName
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
  return [`${scoped}_OUTPUT`, "OUTPUT"];
}

/**
 * Read the default output format from the environment, or `undefined` when
 * nothing is set. An unrecognized value is reported to `onInvalid` and ignored,
 * so a typo degrades to the normal default instead of failing the run.
 */
export function resolveOutputFormatFromEnv(
  cliName: string,
  env: Record<string, string | undefined>,
  onInvalid?: (message: string) => void,
): OutputFormat | undefined {
  for (const name of outputFormatEnvNames(cliName)) {
    const raw = env[name]?.trim();
    if (!raw) continue;

    const format = OUTPUT_FORMATS.find((f) => f === raw.toLowerCase());
    if (format) return format;

    onInvalid?.(
      `Ignoring ${name}="${raw}" — expected one of ${OUTPUT_FORMATS.join(", ")}.`,
    );
  }
  return undefined;
}

// ── Result envelope ──────────────────────────────────────────────────────────

/**
 * Result envelope — wraps command execution results.
 *
 * The `format` determines how it's serialized:
 * - `json`: `JSON.stringify(envelope)` with optional pretty-print
 * - `human`: Rendered text with status marker, error details, duration
 * - `jsonl`: Single-line JSON (streaming-friendly, one envelope per line)
 */
export interface CLIResult<T = unknown> {
  /** Whether the command succeeded */
  success: boolean;
  /** Structured data payload */
  result?: T;
  /** Human-readable message */
  message?: string;
  /** Error when success=false — plain string or structured CLIError */
  error?: string | CLIError;
  /** Metadata about the result */
  meta?: ResultMeta;
}

/**
 * Structured error object.
 */
export interface CLIError {
  /** Machine-readable error code (e.g. "E_NOT_FOUND", "E_TIMEOUT") */
  code: string;
  /** Human-readable error message */
  message: string;
  /** Optional field-level validation errors */
  details?: Record<string, string>;
}

/**
 * Result metadata.
 */
export interface ResultMeta {
  /** Timestamp (ISO 8601) */
  timestamp?: string;
  /** Execution time in milliseconds */
  durationMs?: number;
  /** Total count (for paginated results) */
  totalCount?: number;
  /** Current page (for paginated results) */
  page?: number;
  /** Page size (for paginated results) */
  pageSize?: number;
}

// ── Output writer interface ──────────────────────────────────────────────────

/**
 * Output writer — abstracts format-specific serialization.
 */
export interface OutputWriter<T = unknown> {
  /** Write a single result */
  write(data: T): Promise<void>;
  /** Write multiple results (JSONL emits one line per item) */
  writeAll(items: T[]): Promise<void>;
  /** Finalize and flush any buffered output */
  flush(): Promise<void>;
}

/**
 * Options for creating an output writer.
 */
export interface OutputOptions {
  /** Output format (default: "human") */
  format?: OutputFormat;
  /** Pretty-print JSON (default: false) */
  pretty?: boolean;
  /** Number of spaces for pretty-print (default: 2) */
  indent?: number;
  /** Whether to use ANSI colors (default: true, respects NO_COLOR) */
  colors?: boolean;
  /** Output stream (default: process.stdout) */
  stream?: NodeJS.WriteStream;
}

// ── Formatters ───────────────────────────────────────────────────────────────

/** Detect whether colors should be enabled (respects NO_COLOR env var). */
function defaultColors(): boolean {
  return typeof process !== "undefined" && process.env.NO_COLOR === undefined;
}

/** Extract the display message from a string-or-structured error. */
function errorMessage(error: string | CLIError): string {
  if (typeof error === "string") return error;
  const code = error.code ?? "UNKNOWN";
  const message = error.message ?? "";
  return message ? `${code} — ${message}` : code;
}

/**
 * Format a CLIResult as a JSON string.
 */
export function formatJSON<T>(
  result: CLIResult<T>,
  options?: { pretty?: boolean; indent?: number },
): string {
  const { pretty = false, indent = 2 } = options ?? {};
  return pretty ? JSON.stringify(result, null, indent) : JSON.stringify(result);
}

/**
 * Format a CLIResult as a human-readable string.
 */
export function formatHuman<T>(
  result: CLIResult<T>,
  options?: { colors?: boolean },
): string {
  const { colors = defaultColors() } = options ?? {};
  const lines: string[] = [];

  const mark = result.success ? "✓" : "✗";
  const coloredMark = colors
    ? `${result.success ? "\x1b[32m" : "\x1b[31m"}${mark}\x1b[0m`
    : mark;
  if (result.message) {
    lines.push(`${coloredMark} ${result.message}`);
  } else if (!result.success) {
    lines.push(coloredMark);
  }

  if (result.error) {
    lines.push(`Error: ${errorMessage(result.error)}`);
    if (typeof result.error !== "string" && result.error.details) {
      for (const [field, msg] of Object.entries(result.error.details)) {
        lines.push(`    ${field}: ${msg}`);
      }
    }
  }

  if (result.result !== undefined) {
    let dataStr: string;
    if (typeof result.result === "string") {
      dataStr = result.result;
    } else {
      try {
        dataStr = JSON.stringify(result.result, null, 2);
      } catch {
        dataStr = String(result.result);
      }
    }
    lines.push(dataStr);
  }

  if (result.meta?.durationMs !== undefined) {
    lines.push(
      colors
        ? `\x1b[2m(${result.meta.durationMs}ms)\x1b[0m`
        : `(${result.meta.durationMs}ms)`,
    );
  }

  return lines.join("\n");
}

/**
 * Format a CLIResult as a single JSONL line.
 */
export function formatJSONL<T>(result: CLIResult<T>): string {
  return JSON.stringify(result);
}

/**
 * Format an array of items as JSONL (one JSON object per line).
 */
export function formatJSONLItems<T>(items: T[]): string {
  if (items.length === 0) return "";
  return items.map((item) => JSON.stringify(item)).join("\n") + "\n";
}

// ── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create an OutputWriter for the given format.
 *
 * @example
 * ```ts
 * const writer = createOutput({ format: "json", pretty: true });
 * await writer.write({ id: 1 });
 * ```
 */
export function createOutput<T = unknown>(options?: OutputOptions): OutputWriter<T> {
  const {
    format = "human",
    pretty = false,
    indent = 2,
    colors = defaultColors(),
    stream = typeof process !== "undefined" ? process.stdout : undefined,
  } = options ?? {};

  const writeLine = (line: string) => {
    if (stream) {
      stream.write(line + "\n");
    } else {
      // Fallback for environments without process.stdout (e.g. tests)
      console.log(line);
    }
  };

  const serialize = (envelope: CLIResult<unknown>): string => {
    switch (format) {
      case "json":
        return formatJSON(envelope, { pretty, indent });
      case "jsonl":
        return formatJSONL(envelope);
      case "human":
      default:
        return formatHuman(envelope, { colors });
    }
  };

  return {
    async write(data: T) {
      writeLine(serialize({ success: true, result: data }));
    },

    async writeAll(items: T[]) {
      if (format === "jsonl") {
        for (const item of items) {
          writeLine(JSON.stringify(item));
        }
        return;
      }

      if (format === "json") {
        writeLine(
          formatJSON(
            { success: true, result: items, meta: { totalCount: items.length } },
            { pretty, indent },
          ),
        );
        return;
      }

      // human
      for (const item of items) {
        const envelope: CLIResult<T> = { success: true, result: item };
        writeLine(formatHuman(envelope, { colors }));
      }
    },

    async flush() {
      // No buffering in the default writer — present for interface symmetry
      // so streaming implementations can override.
    },
  };
}
