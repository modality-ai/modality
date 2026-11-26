/**
 * CLI flag validation toolkit.
 *
 * Provides fuzzy-matching unknown-flag detection so users get
 * "Unknown flag --confg. Did you mean --config?" instead of silent failure.
 */

import { z } from "zod";
import type { CLICommand, Option } from "./types";
import { schemaToCliOptions } from "./zod-cli";
import { resolveGlobalOptions } from "../lib/globalOptions";

// ── Levenshtein distance ───────────────────────────────────────────────────

/**
 * Compute Levenshtein edit distance between two strings.
 * Used for fuzzy flag matching.
 */
export function levenshtein(a: string, b: string): number {
  const an = a.length;
  const bn = b.length;
  if (an === 0) return bn;
  if (bn === 0) return an;

  // Use two-row technique for O(n) space
  let prev = new Uint32Array(bn + 1);
  let curr = new Uint32Array(bn + 1);

  for (let j = 0; j <= bn; j++) prev[j] = j;

  for (let i = 1; i <= an; i++) {
    curr[0] = i;
    for (let j = 1; j <= bn; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1]! + 1,     // insertion
        prev[j]! + 1,         // deletion
        prev[j - 1]! + cost,  // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }

  return prev[bn]!;
}

// ── Fuzzy suggestion helper ─────────────────────────────────────────

/**
 * Find the closest fuzzy match for an unknown input within a set of candidates.
 * Returns `null` when no candidate is close enough.
 *
 * Used for "Unknown flag --confg. Did you mean --config?" suggestions.
 */
export function fuzzySuggestion(input: string, candidates: string[]): string | null {
  let bestDist = Infinity;
  let best = "";
  const maxDist = Math.min(3, Math.floor(input.length / 2));

  for (const c of candidates) {
    const d = levenshtein(input, c);
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }

  return bestDist <= maxDist ? best : null;
}

// ── Default global flags ────────────────────────────────────────────────

/**
 * Global flags accepted by all commands unless overridden — help, plus one per
 * default global option. Derived from {@link resolveGlobalOptions} so the flags
 * validation accepts and the flags help renders cannot drift apart.
 *
 * `--jsonl` is NOT included here — it was removed as a hardcoded global flag.
 * Projects that still need `--jsonl` recognition should pass it via the
 * `extraFlags` parameter of `rejectUnknownFlags` / `validateCLICommandArgs`.
 */
export const DEFAULT_GLOBAL_FLAGS = new Set([
  "--help",
  "-h",
  ...Object.keys(resolveGlobalOptions(undefined, undefined).shape).map((k) => `--${k}`),
]);

// ── Known-flag extraction ─────────────────────────────────────────────────

/**
 * Flatten an `Option[]` into its flag strings, splitting combined
 * declarations like `"--help, -h"` into individual flags.
 *
 * Useful for feeding a shared global `Option[]` into the `extraFlags`
 * parameter of `knownFlags()` / `rejectUnknownFlags()`:
 *
 * ```ts
 * const warnings = rejectUnknownFlags(null, argv, optionFlags(globalOptions));
 * ```
 */
export function optionFlags(options: Option[]): string[] {
  return options.flatMap((o) => o.flag.match(/--?[\w][\w-]*/g) ?? [o.flag]);
}

/**
 * Extract the set of known flags for a command.
 *
 * @param command     The command descriptor (or `null`/`undefined` for top-level)
 * @param extraFlags  Additional global flags beyond the defaults
 * @returns           Array of flag strings (e.g. `["--help", "-h", "--config", "--json"]`)
 */
export function knownFlags(
  command: CLICommand | null | undefined,
  extraFlags?: string[],
): string[] {
  const flags = new Set(DEFAULT_GLOBAL_FLAGS);
  if (extraFlags) for (const f of extraFlags) flags.add(f);

  if (command) {
    // A command's flags are derived from its Zod `inputSchema` — the same way
    // help generation derives them. Positional entries contribute their bare
    // names (e.g. sub-command style "list", "show <id>").
    const options: Option[] = [...(command.positionals ?? [])];
    if (command.inputSchema instanceof z.ZodObject) {
      options.push(
        ...schemaToCliOptions(
          command.inputSchema,
          command.keyMap,
        ).options,
      );
    }

    for (const option of options) {
      if (option.flag.startsWith("-")) {
        // Split combined declarations ("--help, -h") into individual flags
        for (const f of optionFlags([option])) flags.add(f);
      } else {
        // Bare positional names (e.g. "list", "show <id>")
        flags.add(option.flag.split(" ")[0]!);
      }
    }
  }

  return [...flags];
}

// ── Unknown-flag rejection ─────────────────────────────────────────────────

/**
 * Validate CLI args against known flags for a command.
 * Returns human-readable warning lines for any unknown flags.
 *
 * A `--` token ends flag processing (args after `--` are positional).
 *
 * @param command     The command descriptor (or `null`/`undefined` for top-level)
 * @param args        The raw argument tokens to validate
 * @param extraFlags  Additional global flags (e.g. "--format")
 * @returns           Array of warning strings (empty = no issues)
 */
export function rejectUnknownFlags(
  command: CLICommand | null | undefined,
  args: string[],
  extraFlags?: string[],
): string[] {
  const known = knownFlags(command, extraFlags);
  const warnings: string[] = [];

  // Pre-filter long flags once for fuzzy matching
  const longKnown = known.filter((k) => k.startsWith("--"));

  let ended = false;
  for (const arg of args) {
    if (arg === "--") {
      ended = true;
      continue;
    }
    if (ended) continue;

    if (!arg.startsWith("-")) continue;

    // Strip inline value for comparison: --flag=value → --flag
    const eqIdx = arg.indexOf("=");
    const flag = eqIdx !== -1 ? arg.slice(0, eqIdx) : arg;

    if (known.includes(flag)) continue;

    // --no-<flag> negation: strip prefix and check base flag exists
    if (flag.startsWith("--no-")) {
      const baseFlag = "--" + flag.slice(5);
      if (known.includes(baseFlag)) continue;
    }

    // Short flags (single dash, -- is false) are not supported
    if (!flag.startsWith("--")) {
      warnings.push(
        `Unknown flag ${arg}. Use --help to see available options (short flags not supported).`,
      );
      continue;
    }

    // Long flag: try fuzzy match
    const match = fuzzySuggestion(flag, longKnown);
    const suffix = match ? `. Did you mean ${match}?` : "";
    warnings.push(`Unknown flag ${arg}${suffix}`);
  }

  return warnings;
}

// ── Convenience: build the CLI-level rejection dispatcher ──────────────────

type CLICommandMap = Record<string, CLICommand>;

/**
 * Create a flag-rejection function for a full CLI with many commands.
 *
 * ```ts
 * const reject = buildFlagRejector(subcommands);
 * const warnings = reject("price", process.argv.slice(3));
 * ```
 */
export function buildFlagRejector(
  commands: CLICommand[],
  extraFlags?: string[],
): (name: string, args: string[]) => string[] {
  const map: CLICommandMap = {};
  for (const cmd of commands) {
    if (!cmd.name) {
      throw new Error("buildFlagRejector: every CLICommand must have a `name`.");
    }
    map[cmd.name] = cmd;
  }

  return (name: string, args: string[]): string[] => {
    return rejectUnknownFlags(map[name] ?? null, args, extraFlags);
  };
}
