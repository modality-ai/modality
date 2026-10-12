/**
 * CLI runner — the argv → resolve → validate → dispatch loop.
 *
 * `buildCliFromTools` supplies help, alias-aware `getHelp`, and flag rejection
 * but stubs `execute`; `validateCLICommandArgs` turns argv into schema-checked
 * data without ever throwing. This runner stitches them to a
 * {@link CommandRegistry} so a consuming package only supplies its commands
 * plus a little config.
 *
 * ## Quick start
 *
 * ```ts
 * import { z } from "zod";
 * import { createCliRunner } from "modality-cli-kit";
 * import { registry } from "./scripts/commands-index";
 *
 * export const cli = createCliRunner({
 *   cliName: "my-cli",
 *   tagline: "My toolkit",
 *   version: "1.2.3",
 *   registry,
 *   skipFields: ["json"],
 *   onEmpty: () => { console.log("no command given"); return 0; },
 * });
 *
 * process.exit(await cli.run());
 * ```
 */
import type { AITool } from "modality-mcp-kit";
import type { z } from "zod";
import { createTracer, type Tracer } from "./trace";
import type { CLICommand, KeyOverride } from "./help/types";
import { validateCLICommandArgs } from "./help/zod-cli";
import type { GlobalOptionName } from "./globalOptions";
import { FORMAT_FLAG, resolveRunnerCli } from "./resolveRunnerCli";
import {
  formatHuman,
  formatJSON,
  formatJSONL,
  resolveOutputFormatFromEnv,
  type CLIResult,
  type OutputFormat,
} from "./output";
import type { CommandRegistry } from "./registry";
import type { DefaultCommandName } from "./defaultCommands";
import { takesRawArgv } from "./defaultCommands/internal";

/** Options for {@link createCliRunner}. */
export interface CliRunnerOptions {
  /** Binary name shown in help and usage lines. */
  cliName: string;
  /** One-line tagline shown at the top of global help. */
  tagline: string;
  /**
   * Version printed by `--version` / `-v`, typically the consuming package's
   * `package.json` version. Omit it — or pass an empty string — and the flag
   * reports that no version is configured.
   */
  version?: string;
  /** The command registry to dispatch into. */
  registry: CommandRegistry;
  /**
   * The "counter script" — the single {@link AITool} entry point your MCP
   * server also exposes (e.g. `scripts/index.ts`'s `aiTool`). When supplied,
   * the runner dispatches through `aiTool.execute({ command, ...args })` so CLI
   * runs and MCP tool calls share one execution path (auth checks, wrapping,
   * flat-schema handling, etc.). Omit it to dispatch commands directly.
   */
  aiTool?: AITool;
  /**
   * Global flags rendered in the help footer, on top of the defaults the runner
   * already supplies (`--json`, `--human`, `--no-cache`). Flags declared here —
   * or defaulted — are also accepted by every command's validation and may be
   * injected from the environment; a declared flag is global in practice.
   *
   * A key that collides with a default overrides it, so rewording a default
   * needs no opt-out.
   */
  globalOptionsSchema?: z.ZodObject<Record<string, z.ZodType>>;
  /**
   * Per-field overrides for the global flags derived from
   * {@link CliRunnerOptions.globalOptionsSchema}. Without it a value
   * placeholder is derived from the key (`--cdp <cdp>`); with
   * `{ cdp: { arg: "<url>" } }` help reads `--cdp <url>`.
   */
  globalOptionsKeyMap?: Record<string, KeyOverride>;
  /** Schema keys shared by all commands to keep out of per-command options. */
  skipFields?: string[];
  /**
   * Example invocations shown at the bottom of global help, e.g.
   * `["my-cli open https://example.com"]`. Omit for no examples section.
   */
  globalExamples?: string[];
  /**
   * Replace the footer line. The default names this CLI's format flags and the
   * environment variables that set them; supplying this drops that line, so
   * carry over anything the reader still needs.
   */
  footer?: string;
  /**
   * Invoked when argv is empty. Return a process exit code. When omitted, the
   * runner defers to {@link CliRunnerOptions.aiTool} (calling `execute({})`,
   * returning 0) if one is set, otherwise prints global help and returns 1.
   */
  onEmpty?: () => number | Promise<number>;
  /**
   * Opt out of the commands the runner supplies by default (`merge`, a stdin
   * sink that folds a piped `&&` chain of `--json` runs into one document, and
   * `skill` when {@link CliRunnerOptions.methodsDir} is set). They are all on
   * unless disabled:
   *
   *  - `true` — register none of them
   *  - `["merge"]` — register all but the named ones
   *
   * A command the registry already defines under a default's name always wins,
   * so shadowing needs no opt-out.
   */
  withoutDefaultCommand?: boolean | DefaultCommandName[];
  /**
   * Absolute path to this CLI's Counter `methods/` tree. Supplying it registers
   * the `skill` default command (`my-cli skill <method>`), which prints a
   * method's raw skill text; omit it and no `skill` command exists.
   *
   * It also needs the optional `@modality-counter/core` package installed —
   * the command imports it lazily and reports a missing install as an error.
   */
  methodsDir?: string;
  /**
   * Opt out of the global options the runner supplies by default (`json`,
   * `human`, `no-cache`). They are all on unless disabled:
   *
   *  - `true` — supply none of them
   *  - `["human"]` — supply all but the named ones
   *
   * Reach for this only to *remove* a flag the CLI must not accept; to change
   * one, redeclare the key in {@link CliRunnerOptions.globalOptionsSchema} —
   * the CLI's own declaration already wins.
   */
  withoutDefaultGlobalOption?: boolean | GlobalOptionName[];
}

/** Tokens before the `--` terminator — everything after it is positional. */
function flagTokens(argv: string[]): string[] {
  const terminator = argv.indexOf("--");
  return terminator === -1 ? argv : argv.slice(0, terminator);
}

/**
 * Detect the requested output format from the pre-terminator flag tokens.
 * Convention: `--jsonl` → JSONL, `--json` → pretty JSON, otherwise human.
 *
 * Note: `--jsonl` is NOT in `DEFAULT_GLOBAL_FLAGS` — it is a legacy alias that
 * still routes through format detection for backward compatibility, but per-command
 * validation will reject it unless the CLI declares `jsonl` in
 * `globalOptionsSchema` (the runner forwards those flags as accepted).
 */
function detectFormat(flags: string[]): OutputFormat {
  if (flags.includes("--jsonl")) return "jsonl";
  if (flags.includes("--json")) return "json";
  return "human";
}

/**
 * Is `--human` this CLI's format flag, or a per-command flag that happens to
 * share the name? Only a globally declared `human` participates in format
 * selection; otherwise a command's own `--human` would hijack the renderer.
 */
function humanIsFormatFlag(globalFlags: Set<string>): boolean {
  return globalFlags.has(FORMAT_FLAG.human);
}

/**
 * Apply an environment default by rewriting argv, not just the renderer.
 *
 * Handlers read their own `--json`/`--human` flag to decide what to print, so
 * setting the render format alone would let a handler print human text that the
 * runner then wraps as JSON. Injecting the flag keeps validation, the handler,
 * and the renderer reading one source.
 *
 * An explicit flag in argv always wins, and the flag is only injected when the
 * CLI declares it globally — otherwise per-command validation would reject the
 * very flag the runner added.
 */
function applyEnvFormat(
  argv: string[],
  envFormat: OutputFormat | undefined,
  globalFlags: Set<string>
): string[] {
  if (!envFormat || argv.length === 0) return argv;
  // A `--json` past the `--` terminator is a positional, not an explicit flag.
  const flags = flagTokens(argv);
  if (flags.includes("--json") || flags.includes("--jsonl")) return argv;
  if (humanIsFormatFlag(globalFlags) && flags.includes("--human")) return argv;

  const flag = FORMAT_FLAG[envFormat];
  if (!globalFlags.has(flag)) return argv;

  // Insert before the `--` terminator — tokens after it are positionals, so an
  // appended flag would silently become one of them instead of a flag.
  const terminator = argv.indexOf("--");
  if (terminator === -1) return [...argv, `--${flag}`];
  return [...argv.slice(0, terminator), `--${flag}`, ...argv.slice(terminator)];
}

/**
 * The single result renderer — one code path that covers every shape a
 * command (or the {@link CliRunnerOptions.aiTool}) can return. Every CLI built
 * on this runner uses it; there is no per-consumer override:
 *
 *  - `string` — printed verbatim (e.g. the no-command help text); empty
 *    strings print nothing.
 *  - {@link CLIResult} envelope (`{ success, ... }`) — serialized for `format`
 *    via the `output.ts` formatters. In human mode a success envelope carrying
 *    no `message`/`result` renders to `""`, so a handler that already printed
 *    its own output adds nothing; human-mode failures go to stderr while
 *    JSON/JSONL always stream to stdout for machine consumers.
 *  - any other object — best-effort JSON, compact under `--json`/`--jsonl`
 *    and pretty in human mode so the format flag means the same on every
 *    branch (back-compat).
 *  - `undefined` / `null` — nothing.
 */
function renderCliResult(result: unknown, format: OutputFormat): void {
  if (result === undefined || result === null) return;

  if (typeof result === "string") {
    if (result.length > 0) console.log(result);
    return;
  }

  if (typeof result === "object" && "success" in result) {
    const envelope = result as CLIResult;
    const text =
      format === "json"
        ? formatJSON(envelope, { pretty: true })
        : format === "jsonl"
          ? formatJSONL(envelope)
          : formatHuman(envelope);
    if (text.length === 0) return;
    if (format === "human" && envelope.success === false) console.error(text);
    else console.log(text);
    return;
  }

  // Non-envelope object: honor the format flag — machine modes stay on one
  // line, human mode pretty-prints.
  console.log(JSON.stringify(result, null, format === "human" ? 2 : undefined));
}

/** A runner returned by {@link createCliRunner}. */
export interface CliRunner {
  /** Parse argv, dispatch, and resolve to a process exit code. */
  run(argv?: string[]): Promise<number>;
  /** Render help for one command (by name/alias) or global help if omitted. */
  getHelp(command?: string): string;
}

/**
 * Create a {@link CliRunner} bound to a registry and help config.
 */
export function createCliRunner(options: CliRunnerOptions): CliRunner {
  const {
    cliName,
    tagline,
    version,
    registry: suppliedRegistry,
    aiTool,
    globalOptionsSchema: suppliedGlobalOptions,
    globalOptionsKeyMap,
    skipFields,
    globalExamples,
    footer: suppliedFooter,
    onEmpty,
    withoutDefaultCommand,
    withoutDefaultGlobalOption,
    methodsDir,
  } = options;

  // Help-ready config (default options, default commands, footer) is shared
  // with the root `getHelp`, so both render identically.
  const { cli, registry, defaults, globalOptionsSchema } = resolveRunnerCli(options);
  const defaultNames = new Set(defaults.map((cmd) => cmd.name!));

  // Only flags the CLI declares globally can be injected from the environment;
  // feed the same list into per-command validation so a declared flag is
  // accepted everywhere — otherwise the injected flag would be rejected. Flags
  // the command schema itself declares stay valid on top of these.
  const globalFlags = new Set(Object.keys(globalOptionsSchema.shape));
  // Long form only: the shared validator skips short flags (its `-h` is an
  // alias handled elsewhere), and parseCliArgs reads `-v` and `--v` as the
  // same key once it is in the schema — so forwarding `--v` accepts the short
  // spelling the help advertises too.
  const globalFlagTokens = [...globalFlags].map((key) => `--${key}`);

  /**
   * Dispatch a raw-argv command — one the kit itself marked via
   * `defaultCommands/internal`. The command's valid flags are not knowable
   * from a static schema (they depend on which Counter method was named), so
   * the runner hands over argv as typed, minus its own global flags, which it
   * strips: a `--human` or `--no-cache` belongs to the CLI, not the method,
   * and must neither fail the command's param validation nor leak into Counter
   * as a method parameter. No consuming CLI can reach this path.
   *
   * Help is split by who the flag belongs to. `cli <cmd> --help` (a flag first,
   * or nothing at all) is a question about the command, so the runner answers
   * it. Once a non-flag token leads — `cli skill <method> --help` — the whole
   * tail is the command's business, `--help` included.
   *
   * The command reports failure the way a shell tool does, by setting
   * `process.exitCode`; anything it returns is still rendered, so a raw-argv
   * command may print for itself or hand back a result.
   */
  async function runRawArgs(
    command: CLICommand,
    rest: string[],
    resolvedName: string,
    renderResult: (result: unknown) => void,
    trace: Tracer
  ): Promise<number> {
    const first = rest[0];
    const commandOwnsFlags = first !== undefined && !first.startsWith("-");
    if (!commandOwnsFlags && (rest.includes("--help") || rest.includes("-h"))) {
      console.log(cli.getHelp(resolvedName));
      return 0;
    }

    // The command reports failure by setting `process.exitCode`. Clear it
    // first so one failed raw-argv run cannot poison later runs in the same
    // process: Bun ignores `process.exitCode = undefined`, so reset through a
    // numeric value the failure path will overwrite.
    process.exitCode = 0;

    // Global flags are the runner's, not the method's: strip them so a
    // `--human` or `--no-cache` can neither fail the command's param
    // validation nor arrive at Counter as a method parameter. The command's
    // own flags and `--help` are left untouched.
    const commandArgs = rest.filter(
      (token) => !globalFlagTokens.includes(token)
    );
    trace.step("forwarded args", commandArgs);
    const result = await (
      command.execute as (args: string[]) => Promise<unknown>
    )(commandArgs);
    renderResult(result);
    return Number(process.exitCode);
  }

  /**
   * The argv → resolve → validate → dispatch path. Wrapped by {@link run},
   * which owns what happens when this throws.
   */
  async function dispatch(rawArgv: string[], trace: Tracer): Promise<number> {
    trace.step("argv", rawArgv);

    const envFormat = resolveOutputFormatFromEnv(
      cliName,
      process.env,
      (message) => console.error(message)
    );
    const argv = applyEnvFormat(rawArgv, envFormat, globalFlags);
    if (envFormat !== undefined) trace.step("env output format", envFormat);

    // An explicit flag always beats the environment, which beats the default.
    // Read it off `rawArgv` so an injected flag can't masquerade as explicit.
    //
    // The environment only drives the renderer when it can also drive the
    // handler — a format whose flag the CLI does not declare globally is
    // ignored for both, or the handler's human output would be wrapped as JSON.
    // A CLI that does not declare `human` globally has no flag to inject, and
    // human is the fallback anyway, so the env still applies. Only pre-terminator
    // tokens are flags — a positional `--json` after `--` must not select the
    // format.
    const flags = flagTokens(rawArgv);
    const hasExplicitFormat =
      flags.includes("--json") ||
      flags.includes("--jsonl") ||
      (humanIsFormatFlag(globalFlags) && flags.includes("--human"));
    const envApplies =
      envFormat === "human" ||
      (envFormat !== undefined && globalFlags.has(FORMAT_FLAG[envFormat]));
    const format = hasExplicitFormat
      ? detectFormat(flags)
      : envApplies
        ? (envFormat ?? "human")
        : "human";

    trace.step("output format", format);

    const renderResult = (result: unknown) => renderCliResult(result, format);
    const [name, ...rest] = argv;

    if (!name) {
      trace.step(
        "no command",
        onEmpty ? "onEmpty" : aiTool ? "aiTool.execute({})" : "global help"
      );
      if (onEmpty) return onEmpty();
      // With an aiTool but no explicit onEmpty, defer the empty invocation to
      // the tool; its no-command path is expected to return the global help.
      if (aiTool) {
        const result = await aiTool.execute({});
        if (result !== undefined) renderResult(result);
        return 0;
      }
      console.log(cli.getHelp());
      return 1;
    }
    if (name === "--help" || name === "-h") {
      trace.step("dispatch", "global help");
      console.log(cli.getHelp());
      return 0;
    }
    if (name === "--version" || name === "-v") {
      trace.step("dispatch", "version");
      // The consuming package owns its version, so it comes in through options;
      // say so plainly when it was not supplied rather than inventing one.
      console.log(
        version
          ? `${cliName} v${version}`
          : `${cliName} (version not configured)`
      );
      return 0;
    }

    // Resolve exact names/aliases and unique prefixes (e.g. `sig` → `signals`);
    // a prefix shared by several commands comes back as ambiguous.
    const resolution = registry.resolve(name, { prefix: true });
    if (!resolution.found) {
      // The module doc's first motivating case is "the wrong command resolved" —
      // so a failed resolution has to say so, not fall silent before the error.
      trace.step(
        "resolution failed",
        resolution.reason === "ambiguous"
          ? `${name} is ambiguous: ${resolution.candidates.join(", ")}`
          : `${name} is unknown`
      );
      if (resolution.reason === "ambiguous") {
        const quoted = resolution.candidates.map((c) => `"${c}"`).join(", ");
        console.error(`Ambiguous command: "${name}" — matches ${quoted}\n`);
      } else {
        console.error(`Unknown command: ${name}\n`);
      }
      console.log(cli.getHelp());
      return 1;
    }
    // Use the resolved name so help, validation, and dispatch all agree
    // even when the user typed a prefix or alias.
    const { command, name: resolvedName } = resolution;
    trace.step(
      "resolved command",
      resolvedName === name ? name : `${name} -> ${resolvedName}`
    );

    // A raw-argv command owns its argv, so hand it the tokens the user actually
    // typed — `rawArgv`, not `argv`, since an env-injected `--json` would
    // otherwise arrive as one of its arguments.
    if (takesRawArgv(command)) {
      trace.step("dispatch", "raw argv (kit default command)");
      return runRawArgs(
        command,
        rawArgv.slice(1),
        resolvedName,
        renderResult,
        trace
      );
    }

    if (rest.includes("--help") || rest.includes("-h")) {
      trace.step("dispatch", `help for ${resolvedName}`);
      console.log(cli.getHelp(resolvedName));
      return 0;
    }

    // Unknown flags, missing required args, and coercion failures all come back
    // as warnings — never throws — so a non-empty list means rejection.
    const { data, warnings } = validateCLICommandArgs(
      command,
      rest,
      globalFlagTokens
    );
    if (warnings.length > 0) {
      trace.step("validation rejected", warnings);
      for (const warning of warnings) console.error(warning);
      console.log(`\n${cli.getHelp(resolvedName)}`);
      return 1;
    }

    // validateCLICommandArgs returns unknown; execute accepts the command's
    // schema type which we cannot know statically.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const args = data as any;
    trace.step("validated args", args);
    // When an aiTool (counter script) is supplied, route through it so CLI
    // dispatch matches the MCP tool exactly; otherwise call the command direct.
    // `command` goes last so the resolved name always wins over any same-named
    // field in the validated args.
    //
    // Default commands always dispatch directly: the runner added them, so the
    // consuming package's aiTool has no case for them and would reject the call.
    const viaAiTool = Boolean(aiTool) && !defaultNames.has(resolvedName);
    trace.step("dispatch", viaAiTool ? "aiTool.execute" : "command.execute");
    const result =
      viaAiTool && aiTool
        ? await aiTool.execute({ ...args, command: resolvedName })
        : await command.execute(args);
    renderResult(result);
    const succeeded =
      result && typeof result === "object" && "success" in result
        ? (result as { success: boolean }).success !== false
        : true;
    return succeeded ? 0 : 1;
  }

  /**
   * Run one invocation, turning a thrown error into the message a CLI user
   * should see.
   *
   * A command that rejects its input — "No input for 'balance'. Pass --file
   * …" — is reporting a *usage* problem, and the only useful part of it is the
   * sentence. Letting it escape the runner makes the runtime print the
   * message buried in a stack trace: source excerpt, a caret, six `at` frames
   * through the kit's own `dist/index.js`, and a Bun version banner. All of it
   * is noise about the kit's internals, and none of it helps someone who just
   * forgot a flag.
   *
   * So the message goes to stderr on its own, and the stack is kept for
   * `--trace`, where an unexpected error is exactly what you turned tracing on
   * to see. Exit code 1, the same as a validation rejection — from the
   * caller's side a refused run is a refused run.
   */
  async function run(
    rawArgv: string[] = process.argv.slice(2)
  ): Promise<number> {
    // Built from the raw tokens, before anything is resolved or injected — the
    // tracer has to be live for the first step it reports, and for the catch
    // below. Only pre-terminator tokens count, so a positional `--trace` after
    // `--` is an argument, not a request to trace. A CLI that dropped `trace`
    // via `withoutDefaultGlobalOption` has no such flag, so the token is not
    // the runner's to act on — the same rule the other global flags follow.
    const trace = createTracer(
      globalFlags.has("trace") && flagTokens(rawArgv).includes("--trace"),
      cliName
    );

    try {
      return await dispatch(rawArgv, trace);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      // The stack is the answer to "why did it throw *there*", which is a
      // question only someone already tracing is asking.
      if (trace.enabled && error instanceof Error && error.stack) {
        trace.step("stack", `\n${error.stack}`);
      }
      return 1;
    }
  }

  return { run, getHelp: cli.getHelp };
}
