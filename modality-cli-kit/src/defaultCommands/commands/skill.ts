/**
 * `skill` — print the skill text for a Counter method.
 *
 * A CLI whose repo carries a Counter `methods/` tree gets this for free: point
 * {@link CliRunnerOptions.methodsDir} at that tree and the runner registers the
 * command, help and all.
 *
 * ```bash
 * my-cli skill                       # print the default method's skill, or list methods
 * my-cli skill create-trade-plan     # print one method's skill text
 * my-cli skill <method> --help       # that method's own help
 * my-cli skill <method> --refs       # that method's references
 * ```
 *
 * The no-method behavior is a choice the CLI makes. With
 * {@link SkillCommandOptions.defaultSkillPath} — or an auto-detected sibling
 * file — the method name is read from its frontmatter and passed to Counter, so
 * `skill` is the exact same call as `skill <method>`. With neither, Counter's
 * method list is the answer.
 *
 * ## Why this command validates its own argv
 *
 * A method's valid flags are its own: `create-trade-plan` takes `--trigger`,
 * another method takes something else entirely, and Counter forwards whatever
 * it finds as that method's `params`. No static `inputSchema` can describe
 * that, so the runner hands this command raw argv — a privilege it grants
 * only to commands the kit itself wrote (see `defaultCommands/internal`).
 *
 * The argv is not therefore unchecked. Each method declares its parameters in
 * its own MDX, and {@link buildMethodParamsSchema} turns that declaration into
 * a real Zod schema, applied here before Counter is called. An undeclared
 * parameter is rejected; a method that declares none accepts none. That is
 * stricter than Counter alone, which forwards any `--key value` it sees.
 *
 * Validation reads the args but never rewrites them. The only argv that never
 * reaches Counter is the CLI's own global flags (`--json`, `--human`, …),
 * which the runner strips before the command sees them — so the only change in
 * behavior is that bad input now stops here instead of reaching the method.
 *
 * The command's own two flags are declared in a Zod `inputSchema` so the help
 * generator lists them under Options like any other command's flags. That
 * schema is help-facing metadata only: the runner hands this command raw argv,
 * and {@link validate} still checks every flag against the named method's
 * declaration. A static schema cannot express method-specific parameters,
 * which is why validation stays here instead of moving to the runner.
 *
 * Skill text, the default skill file, and Counter's method listing go through
 * {@link withoutAnsi}, so a real TTY never leaks escapes into captured or piped
 * output. Counter's per-method help is printed as rendered, keeping its color.
 *
 * `@modality-counter/core` is an *optional* dependency, imported lazily below.
 * A CLI that never sets `methodsDir` never registers this command and never
 * loads Counter — so the kit stays installable without it.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

import { z } from "zod";

import { bold, dim, example, header } from "../../help/colors";
import type { CLICommand } from "../../help/types";
import { stripYamlAnsi } from "../../ui/strip-ansi";
import { markRawArgv } from "../internal";
import {
  buildMethodParamsSchema,
  parseCounterParams,
  type MethodParameters,
} from "../lib/methodParams";

/**
 * How the command loads the optional `@modality-counter/core` package.
 * A rejecting importer is the only way to exercise the missing-package path
 * once the package is installed — Bun offers no un-mock for a module.
 */
export type CounterImporter = () => Promise<typeof import("@modality-counter/core")>;

/** Options for {@link createSkillCommand}. */
export interface SkillCommandOptions {
  /** Command name in help and dispatch (default: `"skill"`). */
  name?: string;
  /** Binary name used in help and generated examples (default: `"<cli>"`). */
  cliName?: string;
  /** Absolute path to the CLI's Counter `methods/` directory. */
  methodsDir: string;
  /**
   * Absolute path to the CLI's default skill file (`SKILL.mdx` or `SKILL.md`).
   * When set, `skill` with no method name reads the method name from this
   * file's frontmatter and delegates to Counter — the same call as naming the
   * method. The sibling extension is tried when the given spelling is absent.
   * Even when omitted, `skill` auto-detects a `SKILL.mdx`/`SKILL.md` at
   * `methodsDir/../src/`. A file without a method name is printed raw; no file
   * at all falls back to Counter's method list.
   */
  defaultSkillPath?: string;
  /** Loader for the optional package (default: a dynamic `import()` of it). */
  importCounter?: CounterImporter;
  /** Loader for the optional `@modality-counter/core/mdx` subpath (default: a dynamic `import()` of it). */
  importMdx?: () => Promise<typeof import("@modality-counter/core/mdx")>;
}

/** The kit's own palette, handed to Counter so its help matches the CLI's. */
const COLOR_FORMAT = { bold, dim, header, example };

type StdoutWrite = (
  chunk: string | Uint8Array,
  encoding?: unknown,
  callback?: unknown,
) => boolean;

// Counter writes straight to stdout, so the barrier is process-global. One
// shared baseline keeps overlapping renders from restoring a stale writer.
let barrierDepth = 0;
let baseLog: typeof console.log | undefined;
let baseError: typeof console.error | undefined;
let baseWrite: typeof process.stdout.write | undefined;

const cleanArg = (arg: unknown): unknown =>
  typeof arg === "string" ? stripYamlAnsi(arg) : arg;

/**
 * Counter writes skill text and listings straight to stdout, so this is the
 * boundary where their escapes are normalized. Help is rendered outside it so
 * its styling survives. Writers are restored only after the last overlapping
 * render finishes.
 */
async function withoutAnsi<T>(render: () => Promise<T>): Promise<T> {
  if (barrierDepth === 0) {
    baseLog = console.log;
    baseError = console.error;
    baseWrite = process.stdout.write;
    const write = baseWrite.bind(process.stdout) as StdoutWrite;

    console.log = (...args: unknown[]) => baseLog!(...args.map(cleanArg));
    console.error = (...args: unknown[]) => baseError!(...args.map(cleanArg));
    process.stdout.write = ((
      chunk: string | Uint8Array,
      encoding?: unknown,
      callback?: unknown,
    ) => {
      const clean = typeof chunk === "string" ? stripYamlAnsi(chunk) : chunk;
      // A callback in the second slot is a valid `write(str, cb)` call; keep it
      // there instead of shifting it into the callback slot.
      return typeof encoding === "function"
        ? write(clean, encoding)
        : write(clean, encoding, callback);
    }) as typeof process.stdout.write;
  }
  barrierDepth++;

  try {
    return await render();
  } finally {
    barrierDepth--;
    if (barrierDepth === 0) {
      console.log = baseLog!;
      console.error = baseError!;
      process.stdout.write = baseWrite!;
      baseLog = baseError = baseWrite = undefined;
    }
  }
}

/**
 * Flags Counter strips before reading a method's params, so they are never
 * mistaken for one. `--json` is also a CLI global the runner strips — kept
 * here so the command stays correct when executed directly, without a runner.
 * The other two are this command's own.
 */
const COUNTER_OWNED_FLAGS = ["--help", "--json", "--refs"];

/**
 * Parameters the command itself supplies on top of whatever the method
 * declares. `--reference` reaches Counter through the params channel and so
 * must be declared or it would be rejected as unknown. `--refs` is stripped by
 * {@link COUNTER_OWNED_FLAGS} before params are read — in Counter itself too —
 * so a method that declares a `refs` parameter of its own can never receive it
 * via the CLI. Both are declared anyway so the accepted surface is stated in
 * one place; a method that declares either name for itself wins the shape.
 */
const REFS_DESCRIPTION = "List the method's references";
const REFERENCE_DESCRIPTION = "Print one reference by name";

const COMMAND_PARAMS: MethodParameters = {
  refs: { type: "boolean", description: REFS_DESCRIPTION },
  reference: { type: "string", description: REFERENCE_DESCRIPTION },
};

/**
 * Help-facing declaration of the command's own flags. The runner never
 * validates this command against it — raw argv is checked by {@link validate}
 * against the named method's parameters — but it is the source the help
 * generator reads, so the flags appear in the standard Options section.
 */
const SKILL_OPTIONS_SCHEMA = z.object({
  refs: z.boolean().optional().describe(REFS_DESCRIPTION),
  reference: z.string().optional().describe(REFERENCE_DESCRIPTION),
});

/** Counter's key convention, reversed for display: `dataset_snapshot` → `--dataset-snapshot`. */
function asFlag(key: string): string {
  return `--${key.replace(/_/g, "-")}`;
}

/**
 * The default skill file to print, trying the configured path first and then
 * its `.md`/`.mdx` sibling. Returns the text, or `undefined` when no candidate
 * reads successfully — an unreadable spelling counts as absent, so a bad file
 * can never crash the command with an `EISDIR`/`EACCES` stack trace.
 */
function readDefaultSkill(path: string): string | undefined {
  const candidates = path.endsWith(".mdx")
    ? [path, `${path.slice(0, -4)}.md`]
    : path.endsWith(".md")
      ? [path, `${path.slice(0, -3)}.mdx`]
      : [path];
  for (const candidate of candidates) {
    try {
      return readFileSync(candidate, "utf8");
    } catch {
      // Absent, unreadable, or a directory — try the next spelling.
    }
  }
  return undefined;
}

// Counter's own YAML reader lives in the optional package, which this branch
// deliberately has not imported yet — so the frontmatter name is read here.
function methodFromSkillText(text: string): string | undefined {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1];
  return frontmatter?.match(/^name:\s*["']?\*?([A-Za-z0-9_-]+)["']?\s*$/m)?.[1];
}

/**
 * Build the `skill` {@link CLICommand} for a CLI to register.
 *
 * Missing `@modality-counter/core` is reported as a plain error rather than an
 * unhandled import rejection — a CLI can set `methodsDir` before installing the
 * optional package, and the fix should be obvious from the message.
 */
export function createSkillCommand(options: SkillCommandOptions): CLICommand {
  const {
    name = "skill",
    cliName = "<cli>",
    methodsDir,
    defaultSkillPath,
    importCounter = () => import("@modality-counter/core"),
  } = options;

  /**
   * Validate the supplied params against the named method's declaration.
   * Resolves to an error message, or `undefined` when the call may proceed.
   */
  async function validate(
    counter: typeof import("@modality-counter/core"),
    mdx: typeof import("@modality-counter/core/mdx"),
    method: string,
    args: string[],
  ): Promise<string | undefined> {
    let schema;
    let accepted: MethodParameters;
    try {
      const items = await counter.getAllCounterItems(["method"], methodsDir);
      const item = items.find((candidate) => candidate.id === method);
      // An unknown method is Counter's error to report — it already lists what
      // is available, and duplicating that here would only risk the two
      // disagreeing.
      if (!item) return undefined;

      const declared = (await mdx.readMdxYaml(item.filePath))?.method?.usage?.parameters;
      accepted = { ...COMMAND_PARAMS, ...declared };
      schema = buildMethodParamsSchema(accepted);
    } catch (error) {
      // An authoring mistake in the method's own MDX — an unreadable file or a
      // bad parameters block — not the caller's fault. Say which method, so
      // the file to fix is obvious.
      return `${cliName} ${name} ${method}: ${(error as Error).message}`;
    }

    const supplied = parseCounterParams(
      args.slice(1).filter((token) => !COUNTER_OWNED_FLAGS.includes(token)),
    );

    // Passing no parameters at all is its own mode, not a call missing its
    // required ones: Counter attaches `params` only when at least one is given,
    // and `<cli> skill <method>` on its own prints the method's text. Requiring
    // a method's parameters there would break its primary use.
    if (Object.keys(supplied).length === 0) return undefined;

    const result = schema.safeParse(supplied);
    if (result.success) return undefined;

    const valid = Object.keys(accepted).map(asFlag).join(", ");
    const problems = result.error.issues.map((issue) => {
      // Zod narrows `unrecognized_keys` to carry the offending keys; reading
      // them through the discriminated union beats reaching for a cast.
      if (issue.code === "unrecognized_keys") {
        return issue.keys
          .map((key) => `  ${asFlag(key)} — not a parameter of this method`)
          .join("\n");
      }
      const key = String(issue.path[0] ?? "?");
      // Distinguish "you left it out" from "the value is wrong" — the schema's
      // type message reads as the latter and would mislead for a missing key.
      const reason = key in supplied ? issue.message : "required, but not supplied";
      return `  ${asFlag(key)} — ${reason}`;
    });

    // `accepted` always carries the command's own parameters (`--refs`,
    // `--reference`), so the list is never empty.
    return [
      `${cliName} ${name} ${method}: invalid parameters`,
      ...problems,
      `\nAccepted: ${valid}`,
    ].join("\n");
  }

  return markRawArgv({
    name,
    // Kept to one line: the help generator renders this in the command index.
    description: "Print skill text for a Counter method",
    inputSchema: SKILL_OPTIONS_SCHEMA,
    usage: [
      `${cliName} ${name} <method-name> [--<param> <value>...]`,
      `${cliName} ${name} <method-name> --help`,
      `${cliName} ${name} <method-name> --refs`,
      defaultSkillPath === undefined
        ? `${cliName} ${name}${" ".repeat(20)}(print the default method's skill, or list available methods)`
        : `${cliName} ${name}${" ".repeat(20)}(print the default method's skill)`,
      "",
      "Parameters are declared by each method; run a method's --help to see them.",
    ],
    examples: [`${cliName} ${name} create-trade-plan`, `${cliName} ${name} <method> --help`],
    async execute(args: string[]): Promise<void> {
      let method = args[0]?.replace(/^\*/, "");
      let methodArgs = args;

      // A default skill names the method so `skill` is the same Counter call as
      // `skill <method>`. A file without a name is still printed as-is.
      if (method === undefined) {
        const skillPath = defaultSkillPath ?? join(dirname(methodsDir), "src", "SKILL.mdx");
        const contents = readDefaultSkill(skillPath);
        if (contents === undefined && defaultSkillPath !== undefined) {
          process.exitCode = 1;
          console.error(`${cliName} ${name}: default skill file not found: ${defaultSkillPath}`);
          return;
        }
        const derived = contents === undefined ? undefined : methodFromSkillText(contents);
        if (derived !== undefined) {
          method = derived;
          methodArgs = [derived, ...args];
        } else if (contents !== undefined) {
          // Counter prints a method's text with a single trailing newline; match
          // it so the file's own trailing newline does not double up.
          return withoutAnsi(async () => {
            console.log(contents.replace(/\n+$/, ""));
          });
        }
      }

      let counter: typeof import("@modality-counter/core");
      let mdx: typeof import("@modality-counter/core/mdx");
      try {
        counter = await importCounter();
        mdx = await (options.importMdx ?? (() => import("@modality-counter/core/mdx")))();
      } catch {
        process.exitCode = 1;
        console.error(
          `${name} needs the optional "@modality-counter/core" package. Install it to enable this command.`,
        );
        return;
      }

      // Counter's own CLI calls `process.exit(1)` on a missing methods
      // directory — fatal to any host that embeds it, and to a test run. Report
      // it here instead, before handing control over. A stat check keeps a
      // stray *file* at the path from bypassing the guard and reaching Counter.
      if (!existsSync(methodsDir) || !statSync(methodsDir).isDirectory()) {
        process.exitCode = 1;
        console.error(`${cliName} ${name}: methods directory not found: ${methodsDir}`);
        return;
      }

      const run = () =>
        withoutAnsi(() =>
          counter.toCounterCLI(methodsDir, { cliName, command: name })(methodArgs),
        );

      // A leading flag — or, without a default skill, no method at all — reaches
      // Counter, which answers with the method list. There are no params to
      // validate against without a method.
      if (method === undefined || method.startsWith("-")) return run();

      // Per-method help is Counter's to render, and asks nothing of the params.
      const showHelp = counter.toCounterCLIHelp(cliName, methodsDir, COLOR_FORMAT, name);
      if (await showHelp(methodArgs)) return;

      const problem = await validate(counter, mdx, method, methodArgs);
      if (problem !== undefined) {
        process.exitCode = 1;
        console.error(problem);
        return;
      }

      return run();
    },
  });
}
