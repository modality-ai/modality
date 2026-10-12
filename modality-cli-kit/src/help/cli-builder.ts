/**
 * Build CLI commands, help config, and validation helpers from AITool definitions.
 *
 * Given a collection of tools (each with a name, description, and Zod inputSchema),
 * this function derives `CLICommand[]` and a `HelpConfig` that can be fed directly
 * to `getHelp()`, `rejectUnknownFlags()`, and other kit functions.
 *
 * Per-tool CLI metadata (which schema fields are positional, command aliases,
 * usage examples, flag name overrides) can be embedded on each tool object
 * via the `CLICommand` interface fields (positionalKeys, keyMap, examples, aliases).
 *
 * @example
 * ```ts
 * import { buildCliFromTools } from "modality-cli-kit";
 * import { z } from "zod";
 *
 * const tools = [
 *   {
 *     name: "click",
 *     description: "Click on an element",
 *     inputSchema: z.object({
 *       selector: z.string().describe("CSS selector"),
 *       force: z.boolean().optional().describe("Force click"),
 *     }),
 *     positionalKeys: ["selector"],
 *     examples: ["my-cli click .btn"],
 *   },
 * ];
 *
 * const cli = buildCliFromTools(tools, {
 *   cliName: "my-cli",
 *   tagline: "My awesome CLI",
 *   globalOptionsSchema: z.object({
 *     verbose: z.boolean().optional().describe("Show verbose output"),
 *   }),
 * });
 *
 * console.log(cli.getHelp());           // global help
 * console.log(cli.getHelp("click"));    // click help
 * cli.createFlagRejector()("click", ["--unknown"]);  // ["Unknown flag --unknown"]
 * ```
 */
import { z } from "zod";
import type { Option, HelpConfig, CLICommand, KeyOverride } from "./types";
import { schemaToCliOptions, toKebab, buildKeyMap } from "./zod-cli";
import { getHelp } from "./generator";
import { buildFlagRejector } from "./validator";

/**
 * Options for `buildCliFromTools` — all `HelpConfig` fields (except the
 * derived `commands`/`globalOptions`) pass through to the help page.
 */
export interface BuildCliFromToolsOptions
  extends Omit<HelpConfig, "commands" | "globalOptions"> {
  /**
   * Zod schema for global CLI flags.
   * Each field becomes an `Option` in the global options section.
   * Flags like `--help`, `-h`, `--json` are always included by default.
   */
  globalOptionsSchema?: z.ZodObject<Record<string, z.ZodType>>;
  /**
   * Per-field overrides for the global flags derived from
   * `globalOptionsSchema` — the same `KeyOverride` shape a command uses for its
   * own fields. Without it a value placeholder is derived from the key
   * (`--cdp <cdp>`); with `{ cdp: { arg: "<url>" } }` help reads `--cdp <url>`.
   */
  globalOptionsKeyMap?: Record<string, KeyOverride>;
  /**
   * Schema keys to skip during CLI flag/positional generation for ALL tools.
   * Useful for fields shared by every tool (like `BaseArgsSchema` fields)
   * that should not appear as per-command options.
   */
  skipFields?: string[];
}

/** Result of a `buildCliFromTools` call. */
export interface CliBuildResult {
  /** Derived `CLICommand[]` — feed to `getHelp()`, `rejectUnknownFlags()`, etc. */
  commands: CLICommand[];
  /**
   * Alias map: alias name → canonical command name.
   * Use this to look up the real command when a user types an alias.
   */
  aliases: Record<string, string>;
  /** Ready-to-go `HelpConfig` for `getHelp()`. */
  helpConfig: HelpConfig;
  /**
   * Generate help text for one command, or global help if omitted.
   *
   * @param command  Optional command name or alias.
   */
  getHelp: (command?: string) => string;
  /**
   * Build a flag-rejection function for these commands.
   *
   * @param extraFlags  Extra global flags (e.g. `"--format"`).
   * @returns A function `(name, args) => string[]` of warnings.
   */
  createFlagRejector: (extraFlags?: string[]) => (name: string, args: string[]) => string[];
}

// ── Builder ─────────────────────────────────────────────────────────────

/**
 * Build ready-to-use CLI definitions from a collection of AI tool definitions.
 *
 * Each tool's Zod `inputSchema` is walked to derive `Option[]` for flags
 * and positional arguments. CLI metadata (positionalKeys, aliases, examples)
 * is read from the `CLICommand` fields on each tool object.
 *
 * The returned `CliBuildResult` includes:
 * - `commands` — for use with `getHelp()`, `rejectUnknownFlags()`, etc.
 * - `helpConfig` — pre-built `HelpConfig` for the global help page
 * - `getHelp()` — quick way to render help for any command
 * - `createFlagRejector()` — build a typed flag rejector
 */
export function buildCliFromTools(
  tools: Partial<CLICommand>[],
  options: BuildCliFromToolsOptions,
): CliBuildResult {
  const { globalOptionsSchema, globalOptionsKeyMap, skipFields, ...helpFields } = options;
  const { cliName } = helpFields;

  const aliases: Record<string, string> = {};
  const commands: CLICommand[] = [];

  for (const tool of tools) {
    const name = tool.name ?? "";
    if (!name) continue;

    const keyMap = buildKeyMap(tool.positionalKeys, tool.keyMap, skipFields);

    // Derive positionals from the tool's inputSchema (flag options are derived
    // on the fly by help generation / validation — no need to materialize them)
    let toolPositionals: Option[] = [];
    if (tool.inputSchema instanceof z.ZodObject) {
      toolPositionals = schemaToCliOptions(
        tool.inputSchema as z.ZodObject<Record<string, z.ZodType>>,
        keyMap,
      ).positionals;
    }

    const command: CLICommand = {
      name: toKebab(name),
      summary: tool.description ?? "",
      inputSchema: tool.inputSchema,
      positionals: toolPositionals,
      examples: tool.examples,
      usage: tool.usage,
      aliases: tool.aliases,
      positionalKeys: tool.positionalKeys,
      // Merged keyMap (includes skipFields hidden entries) so downstream
      // validation can exclude hidden fields from the schema.
      keyMap,
      execute: async () => ({}),
    };
    commands.push(command);

    for (const alias of command.aliases ?? []) {
      aliases[alias] = command.name ?? "";
    }
  }

  let globalOptions: Option[] | undefined;
  if (globalOptionsSchema) {
    globalOptions = schemaToCliOptions(globalOptionsSchema, globalOptionsKeyMap).options;
  }

  const helpConfig: HelpConfig = {
    ...helpFields,
    commands,
    globalOptions,
  };

  return {
    commands,
    aliases,
    helpConfig,
    getHelp(command?: string): string {
      if (command) {
        const alias = aliases[command];
        const resolved = alias ?? command;
        return getHelp({ ...helpConfig, command: resolved, format: "human" });
      }
      return getHelp({ ...helpConfig, format: "human" });
    },
    createFlagRejector(extraFlags?: string[]) {
      return buildFlagRejector(commands, extraFlags);
    },
  };
}
