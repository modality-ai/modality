/**
 * Shared types for CLI help generation.
 */

import type { z } from "zod";
import type { AITool } from "modality-mcp-kit";

/** A single CLI option / flag */
export interface Option {
  /** Flag name, e.g. "--config", "--json" */
  flag: string;
  /** Optional value placeholder, e.g. "<file>", "<N>" */
  arg?: string;
  /** Short description shown in help */
  desc: string;
  /**
   * Expected value type for CLI argument parsing.
   * - `"string"` (default when `arg` present) → `z.string()`
   * - `"boolean"` (default when no `arg`) → `z.boolean()`
   * - `"number"` → `z.coerce.number()`
   * - `"enum"` → requires `enumValues` → `z.enum(enumValues)`
   */
  type?: "string" | "boolean" | "number" | "enum";
  /** Allowed values when `type === "enum"` */
  enumValues?: string[];
  /** When true, the Zod schema will not be wrapped in `.optional()` */
  required?: boolean;
}

/**
 * Per-field CLI override controlling how a schema key maps to the CLI.
 * Used by `schemaToCliOptions` and `CLICommand.keyMap`.
 */
export interface KeyOverride {
  /** Explicit `--flag` / `-f` string (overrides the derived flag name). */
  flag?: string;
  /** Explicit value placeholder, e.g. `"<file>"`. */
  arg?: string;
  /** When set, route this field into positionals at the given index. */
  position?: number;
  /**
   * When `true` the field is excluded from CLI flag/positional generation
   * entirely — it won't appear in help and is rejected as an unknown flag if
   * passed. A required (non-optional) field that is hidden cannot be supplied
   * via the CLI, so it must be populated programmatically.
   */
  hidden?: boolean;
}

/**
 * CLI command definition — schema-driven.
 *
 * The Zod `inputSchema` is the single source of truth for a command's flags:
 * - Help options are derived from it automatically by the help generator —
 *   there is no manual `Option[]` flag declaration.
 * - `positionalKeys` and `keyMap` declare how schema fields map to the CLI.
 * - `validateCLICommandArgs` parses/validates argv against the schema,
 *   preserving coercions and object-level refinements.
 *
 * Commands without an `inputSchema` expose no flags of their own (global
 * flags still apply); sub-command style entries can be listed via
 * `positionals` or custom `usage` lines.
 */
export interface CLICommand extends AITool<any, z.ZodType> {
  /** One-line summary shown in the command index (falls back to `description`). */
  summary?: string;
  /** Ordered positional arguments (displayed in help, validated in args). */
  positionals?: Option[];
  /** Custom usage lines (optional). If omitted, generates `cliName command [options]`. */
  usage?: string[];
  /** Example invocations. */
  examples?: string[];
  // ── Schema-driven metadata (only relevant when `inputSchema` is set) ──

  /** Which `inputSchema` keys are positional args (in declaration order). */
  positionalKeys?: string[];
  /** Per-field overrides (flag name, arg placeholder, hidden). */
  keyMap?: Record<string, KeyOverride>;

  // ── CLI metadata ──────────────────────────────────────────────────────

  /** Alternative command names that map to this tool. */
  aliases?: string[];
}

/**
 * Output format for help text — a subset of OutputFormat from the output module,
 * kept here to avoid a cross-module dependency.
 */
export type HelpFormat = "human" | "json";

/**
 * Options for the unified {@link getHelp} function.
 * Covers both global help and per-command help, in human or JSON format.
 */
export interface GetHelpOptions {
  /** CLI binary name, e.g. "web-cli", "my-cli" */
  cliName: string;
  /** One-line tagline (optional — only renders in human global-help mode) */
  tagline?: string;
  /** All commands to document */
  commands: CLICommand[];
  /** Output format (default: "human") */
  format?: HelpFormat;
  /** When set, show help for this specific command instead of global help */
  command?: string;
  /** When false, commands keep their insertion order (default: true = sort) */
  sorted?: boolean;
  /** Global options shown in the footer / options section */
  globalOptions?: Option[];
  /** Global examples shown at the bottom of help */
  globalExamples?: string[];
  /** Footer text (e.g. "Set NO_COLOR=1 to disable colors") */
  footer?: string;
  /** Command-name column width (human mode only) */
  colNameWidth?: number;
}

/** Global help page configuration */
export interface HelpConfig {
  /** CLI binary name, e.g. "web-cli", "my-cli" */
  cliName: string;
  /** One-line tagline shown at the top, e.g. "Taiwan stock & TX futures CLI toolkit" */
  tagline: string;
  /** All commands to list */
  commands: CLICommand[];
  /** When false, commands keep their insertion order (default: true = sort). */
  sorted?: boolean;
  /** Global options shown at the bottom of help */
  globalOptions?: Option[];
  /** Global examples shown at the bottom of help */
  globalExamples?: string[];
  /** Footer text (e.g. "Set NO_COLOR=1 to disable colors") */
  footer?: string;
  /** Command-name column width. Default: auto — longest command name + 2, min 16. */
  colNameWidth?: number;
  /** Flag column width in compact mode (default: 22) */
  flagWidthCompact?: number;
  /** Flag column width in detailed mode (default: 24) */
  flagWidthDetailed?: number;
}
