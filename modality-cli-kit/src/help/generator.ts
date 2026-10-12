/**
 * CLI help text generator — composable, reusable across CLIs.
 *
 * Public API: {@link getHelp} is the unified entry point for all help output.
 *
 * Internal helpers render global and per-command human-formatted help.
 */

import { z } from "zod";
import * as c from "./colors";
import { padName, padVisible, flagPad, Lines, DEFAULT_COL_NAME_WIDTH } from "./formatter";
import { schemaToCliOptions, buildKeyMap } from "./zod-cli";
import { optionFlags } from "./validator";
import type { CLICommand, HelpConfig, Option, GetHelpOptions, HelpFormat } from "./types";

/**
 * Resolve a command's options + positionals for display.
 *
 * Options are always derived from the command's Zod `inputSchema`
 * (+ `positionalKeys`/`keyMap`) — a command without a schema has no flags of
 * its own. Explicit `positionals` win over schema-derived ones (used for
 * sub-command style entries that a Zod object can't express).
 */
function cliSurface(cmd: CLICommand): { options: Option[]; positionals: Option[] } {
  const explicitPositionals = cmd.positionals ?? [];
  if (!(cmd.inputSchema instanceof z.ZodObject)) {
    return { options: [], positionals: explicitPositionals };
  }

  const derived = schemaToCliOptions(
    cmd.inputSchema as z.ZodObject<Record<string, z.ZodType>>,
    buildKeyMap(cmd.positionalKeys, cmd.keyMap),
  );
  return {
    options: derived.options,
    positionals: explicitPositionals.length > 0
      ? explicitPositionals
      : derived.positionals,
  };
}

/**
 * Render one positional-argument line: `<name>   description`.
 * Shared by the command index and per-command help so both stay in sync.
 */
function renderPositional(pos: Option, indent: string): string {
  const name = c.arg(`<${pos.flag}>`);
  const pad = flagPad(pos.flag.length + 2, false);
  return `${indent}${name}${pad}${c.dim(pos.desc)}`;
}

// ── Option rendering ───────────────────────────────────────────────────────

/**
 * Render a single option line for the detailed view.
 *
 *   --config <file>          Path to configuration file
 */
function renderOption(opt: Option, compact: boolean): string {
  const flag = `${c.opt(opt.flag)}${opt.arg ? " " + c.arg(opt.arg) : ""}`;
  const flagWidth = opt.flag.length + (opt.arg ? 1 + opt.arg.length : 0);
  const pad = flagPad(flagWidth, compact);
  return `    ${flag}${pad}${c.dim(opt.desc)}`;
}

// ── Command rendering ─────────────────────────────────────────────────────

/**
 * Render one command entry for the global help index.
 *
 * Compact mode (used inside the command list):
 *   price              K 線進場價建議
 *   --timeframe <TF>   週期
 *
 * Non-compact renders the options as well:
 *   price              K 線進場價建議
 *     --timeframe <TF>  週期
 *     --lookback <N>    觀察窗
 */
export function renderCLICommand(
  cmd: CLICommand,
  colNameWidth: number = DEFAULT_COL_NAME_WIDTH,
  compact: boolean = true,
): string {
  const nameCol = c.cmd(padName(cmd.name ?? "", colNameWidth));

  if (compact) {
    // Single-line: name + summary only
    return `  ${nameCol}${c.dim(cmd.summary ?? "")}`;
  }

  // Non-compact: name + summary + positionals + options below
  const { options, positionals } = cliSurface(cmd);
  const lines = new Lines();
  lines.push(`  ${nameCol}${c.dim(cmd.summary ?? "")}`);
  for (const pos of positionals) {
    lines.push(renderPositional(pos, "    "));
  }
  for (const opt of options) {
    lines.push(renderOption(opt, false));
  }
  return lines.flush();
}

// ── Global help ────────────────────────────────────────────────────────────

/**
 * Generate the main help page listing all commands.
 *
 * ```text
 * web-cli — Browser automation toolkit
 *
 * Usage: web-cli <command> [options]
 *
 * Commands:
 *   open              Navigate to a URL
 *   click             Click on an element
 *   ...
 *
 * Global Options:
 *   --help, -h        Show this help message
 *
 * Examples:
 *   web-cli open https://example.com
 * ```
 */
function generateHelp(config: HelpConfig): string {
  const {
    cliName,
    tagline,
    commands,
    globalOptions,
    globalExamples,
    footer,
    colNameWidth,
  } = config;

  const sorted = config.sorted !== false;
  const cmds = sorted
    ? [...commands].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""))
    : commands;

  // Auto-size the name column to the longest command name (+2 gap) so long
  // names never collide with their summary; explicit colNameWidth wins.
  const nameWidth =
    colNameWidth ??
    Math.max(
      DEFAULT_COL_NAME_WIDTH,
      ...cmds.map((cmd) => (cmd.name ?? "").length + 2),
    );

  const out = new Lines();

  out.push("");
  out.push(`${c.bold(cliName)} ${c.dim(`— ${tagline}`)}`);
  out.push("");

  out.push(`${c.header("Usage:")}  ${c.cmd(cliName)} ${c.arg("<command>")} ${c.dim("[options]")}`);
  out.push("");

  out.push(`${c.header("Commands:")}`);
  for (const cmd of cmds) {
    out.push(renderCLICommand(cmd, nameWidth, true));
  }

  if (globalOptions && globalOptions.length > 0) {
    out.push("");
    out.push(`${c.header("Global Options:")}`);
    for (const opt of globalOptions) {
      out.push(renderOption(opt, true));
    }
  }

  if (globalExamples && globalExamples.length > 0) {
    out.push("");
    out.push(`${c.header("Examples:")}`);
    for (const ex of globalExamples) {
      out.push(`  ${c.example(ex)}`);
    }
  }

  if (footer) {
    out.push("");
    out.push(c.dim(footer));
  }

  out.push("");
  out.push(c.dim(`Run `) + c.cmd(`${cliName} <command> --help`) + c.dim(` for more information about a command.`));
  out.push("");

  return out.flush();
}

// ── Command-specific help ──────────────────────────────────────────────────

/**
 * Generate detailed help for a single CLI command (internal — use {@link getHelp}).
 *
 * ```text
 * web-cli open — Navigate to a URL
 *
 * Usage:  web-cli open <url> [options]
 *
 * Options:
 *   --wait-until <condition>  Wait: load, domcontentloaded, networkidle
 *   --help, -h                Show this help message
 *
 * Examples:
 *   web-cli open https://example.com
 * ```
 *
 * @param cliName       CLI binary name
 * @param command       The CLICommand metadata
 * @param globalOptions Optional global options to append to the options list
 */
function generateCommandHelp(
  cliName: string,
  command: CLICommand,
  globalOptions?: Option[],
): string {
  const { options, positionals } = cliSurface(command);
  const out = new Lines();
  out.push("");
  out.push(`${c.bold(`${cliName} ${command.name}`)} ${c.dim(`— ${command.summary ?? ""}`)}`);
  out.push("");

  if (command.usage && command.usage.length > 0) {
    const [first, ...rest] = command.usage;
    out.push(`${c.header("Usage:")}  ${c.cmd(first!)}`);
    for (const line of rest) out.push(`        ${c.cmd(line)}`);
  } else {
    const posSlots = positionals
      .map((pos) => c.arg(`<${pos.flag}>`))
      .join(" ");
    const usageParts = [c.cmd(cliName), c.cmd(command.name ?? ""), posSlots, c.dim("[options]")];
    out.push(`${c.header("Usage:")}  ${usageParts.filter(Boolean).join(" ")}`);
  }
  out.push("");

  if (positionals.length > 0) {
    out.push(`${c.header("Arguments:")}`);
    for (const pos of positionals) {
      out.push(renderPositional(pos, "    "));
    }
    out.push("");
  }

  // Options — command's own options render first and win over global ones;
  // any global option whose flags are all already documented is skipped
  // (e.g. a schema `json` field vs the global `--json`, or `--help` supplied
  // in globalOptions vs the built-in fallback line).
  const hasOwnOptions = options.length > 0;
  const hasGlobalOptions = globalOptions && globalOptions.length > 0;

  if (hasOwnOptions || hasGlobalOptions) {
    const seen = new Set<string>();

    out.push(`${c.header("Options:")}`);
    for (const opt of options) {
      out.push(renderOption(opt, false));
      for (const t of optionFlags([opt])) seen.add(t);
    }
    if (hasGlobalOptions) {
      for (const opt of globalOptions!) {
        const tokens = optionFlags([opt]);
        if (tokens.every((t) => seen.has(t))) continue; // duplicate of an own option
        out.push(renderOption(opt, false));
        for (const t of tokens) seen.add(t);
      }
    }
    // Still show --help for commands where nothing else documents it
    if (!seen.has("--help")) {
      out.push(renderOption({ flag: "--help, -h", desc: "Show this help message" }, false));
    }
    out.push("");
    out.push("");
  }

  if (command.examples && command.examples.length > 0) {
    out.push(`${c.header("Examples:")}`);
    for (const ex of command.examples) {
      out.push(`  ${c.example(ex)}`);
    }
    out.push("");
  }

  return out.flush();
}

// ── Free-form section helpers ─────────────────────────────────────────────

/**
 * Render an arbitrary command listing section.
 * Useful for categorized help (e.g. "Navigation Commands:", "Debugging Commands:").
 *
 * @param heading   Section heading (e.g. "Navigation Commands:")
 * @param entries   Array of `{ cmd, args?, desc }` tuples
 * @param colWidth  Command name column width (default: 16)
 */
export function renderSection(
  heading: string,
  entries: { cmd: string; args?: string; desc: string }[],
  colWidth: number = DEFAULT_COL_NAME_WIDTH,
): string {
  const lines = new Lines();
  lines.push(`${c.header(heading)}`);
  for (const entry of entries) {
    const cmdText = c.cmd(entry.cmd);
    const argsText = entry.args ? ` ${c.arg(entry.args)}` : "";
    const col = padVisible(`${cmdText}${argsText}`, colWidth);
    lines.push(`  ${col}  ${c.dim(entry.desc)}`);
  }
  return lines.flush();
}

// ── Unified help (human + JSON) ──────────────────────────────────────────────

/**
 * Build a plain-object representation of a single command, suitable for
 * both JSON serialization and programmatic introspection.
 */
function commandToJSON(
  cmd: CLICommand,
) {
  const { options, positionals } = cliSurface(cmd);

  const obj: Record<string, unknown> = {
    name: cmd.name,
    summary: cmd.summary ?? cmd.description ?? "",
  };

  if (cmd.aliases && cmd.aliases.length > 0) {
    obj.aliases = cmd.aliases;
  }
  if (options.length > 0) {
    obj.options = options;
  }
  if (positionals.length > 0) {
    obj.positionals = positionals;
  }
  if (cmd.usage && cmd.usage.length > 0) {
    obj.usage = cmd.usage;
  }
  if (cmd.examples && cmd.examples.length > 0) {
    obj.examples = cmd.examples;
  }

  return obj;
}

/**
 * Render help as a JSON string (structured command metadata).
 */
function getHelpJSON(options: GetHelpOptions): string {
  const { cliName, command, commands, globalOptions, globalExamples, sorted } = options;

  if (command) {
    const cmd = commands.find((c) => c.name === command);
    if (!cmd) {
      return JSON.stringify({ error: `Unknown command: "${command}"` }, null, 2);
    }
    return JSON.stringify({
      cliName,
      command: commandToJSON(cmd),
    }, null, 2);
  }

  const list = sorted !== false
    ? [...commands].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""))
    : commands;

  const payload: Record<string, unknown> = {
    cliName,
    commands: list.map((cmd) => commandToJSON(cmd)),
  };

  if (globalExamples?.length) {
    payload.globalExamples = globalExamples;
  }
  if (globalOptions && globalOptions.length > 0) {
    payload.globalOptions = globalOptions;
  }

  return JSON.stringify(payload, null, 2);
}

/**
 * Unified help entry point — generate help text in human-readable or JSON format.
 *
 * ## Usage
 *
 * ```ts
 * import { getHelp } from "modality-cli-kit";
 *
 * // Global help
 * console.log(getHelp({ cliName: "my-cli", commands }));
 *
 * // Per-command help
 * console.log(getHelp({ cliName: "my-cli", commands, command: "open" }));
 *
 * // JSON format
 * console.log(getHelp({ cliName: "my-cli", commands, format: "json" }));
 * ```
 */
export function getHelp(options: GetHelpOptions): string {
  const { command, format = "human" } = options;

  if (format === "json") {
    return getHelpJSON(options);
  }

  // ── human format ──────────────────────────────────────────────────────────
  if (command) {
    const cmd = options.commands.find((c) => c.name === command);
    if (!cmd) return `Unknown command: "${command}"\n`;
    return generateCommandHelp(options.cliName, cmd, options.globalOptions);
  }

  return generateHelp({
    cliName: options.cliName,
    tagline: options.tagline ?? "",
    commands: options.commands,
    sorted: options.sorted,
    globalOptions: options.globalOptions,
    globalExamples: options.globalExamples,
    footer: options.footer,
    colNameWidth: options.colNameWidth,
  });
}
