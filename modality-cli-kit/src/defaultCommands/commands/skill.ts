/**
 * `skill` — print the raw skill text for a Counter method.
 *
 * A CLI whose repo carries a Counter `methods/` tree gets this for free: point
 * {@link CliRunnerOptions.methodsDir} at that tree and the runner registers the
 * command, help and all.
 *
 * ```bash
 * my-cli skill                       # list available methods
 * my-cli skill create-trade-plan     # print one method's skill text
 * my-cli skill <method> --help       # that method's own help
 * my-cli skill <method> --refs       # that method's references
 * ```
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
 * `@modality-counter/core` is an *optional* dependency, imported lazily below.
 * A CLI that never sets `methodsDir` never registers this command and never
 * loads Counter — so the kit stays installable without it.
 */
import { existsSync } from "node:fs";

import { bold, dim, example, header } from "../../help/colors";
import type { CLICommand } from "../../help/types";
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
  /** Loader for the optional package (default: a dynamic `import()` of it). */
  importCounter?: CounterImporter;
}

/** The kit's own palette, handed to Counter so its help matches the CLI's. */
const COLOR_FORMAT = { bold, dim, header, example };

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
const COMMAND_PARAMS: MethodParameters = {
  refs: { type: "boolean", description: "List the method's references" },
  reference: { type: "string", description: "Print one reference by name" },
};

/** Counter's key convention, reversed for display: `dataset_snapshot` → `--dataset-snapshot`. */
function asFlag(key: string): string {
  return `--${key.replace(/_/g, "-")}`;
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
    importCounter = () => import("@modality-counter/core"),
  } = options;

  /**
   * Validate the supplied params against the named method's declaration.
   * Resolves to an error message, or `undefined` when the call may proceed.
   */
  async function validate(
    counter: typeof import("@modality-counter/core"),
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

      const declared = (await counter.readMdxYaml(item.filePath))?.method?.usage?.parameters;
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
    description: "Print raw skill text for a Counter method",
    usage: [
      `${cliName} ${name} <method-name> [--<param> <value>...]`,
      `${cliName} ${name} <method-name> --help`,
      `${cliName} ${name} <method-name> --refs`,
      `${cliName} ${name}${" ".repeat(20)}(list available methods)`,
      "",
      "Parameters are declared by each method; run a method's --help to see them.",
    ],
    examples: [`${cliName} ${name} create-trade-plan`, `${cliName} ${name} <method> --help`],
    async execute(args: string[]): Promise<void> {
      let counter: typeof import("@modality-counter/core");
      try {
        counter = await importCounter();
      } catch {
        process.exitCode = 1;
        console.error(
          `${name} needs the optional "@modality-counter/core" package. Install it to enable this command.`,
        );
        return;
      }

      // Counter's own CLI calls `process.exit(1)` on a missing methods
      // directory — fatal to any host that embeds it, and to a test run. Report
      // it here instead, before handing control over.
      if (!existsSync(methodsDir)) {
        process.exitCode = 1;
        console.error(`${cliName} ${name}: methods directory not found: ${methodsDir}`);
        return;
      }

      const run = () => counter.toCounterCLI(methodsDir, { cliName, command: name })(args);

      // No method named (or a leading flag): Counter prints the method list.
      // There are no params to validate against without a method.
      const method = args[0]?.replace(/^\*/, "");
      if (method === undefined || method.startsWith("-")) return run();

      // Per-method help is Counter's to render, and asks nothing of the params.
      const showHelp = counter.toCounterCLIHelp(cliName, methodsDir, COLOR_FORMAT, name);
      if (await showHelp(args)) return;

      const problem = await validate(counter, method, args);
      if (problem !== undefined) {
        process.exitCode = 1;
        console.error(problem);
        return;
      }

      return run();
    },
  });
}
