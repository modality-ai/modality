/**
 * `skills` — list the skills (Counter methods) available to this CLI.
 *
 * The plural counterpart to {@link createSkillCommand}. `skill` with no method
 * name answers with whatever that CLI's default skill file says (or Counter's
 * list when it has none); `skills` always asks Counter for the method list:
 *
 * ```bash
 * my-cli skills                      # list every available method
 * my-cli skills create-trade-plan    # print one method's skill text
 * ```
 *
 * It forwards argv to Counter unchanged — Counter lists on an empty invocation
 * and prints the named method otherwise — so there are no parameters to
 * validate and no static schema to declare. Like `skill`, it needs the optional
 * `@modality-counter/core` package, imported lazily below, and is only
 * registered for a CLI that supplies a `methodsDir`.
 */
import { existsSync, statSync } from "node:fs";

import type { CLICommand } from "../../help/types";
import { markRawArgv } from "../internal";

// The seam contract lives with `skill`, which documents it; a type-only import
// keeps this command free of runtime coupling to that file.
import type { CounterImporter } from "./skill";

/** Options for {@link createSkillsCommand}. */
export interface SkillsCommandOptions {
  /** Command name in help and dispatch (default: `"skills"`). */
  name?: string;
  /** Binary name used in help and generated examples (default: `"<cli>"`). */
  cliName?: string;
  /** Absolute path to the CLI's Counter `methods/` directory. */
  methodsDir: string;
  /** Loader for the optional package (default: a dynamic `import()` of it). */
  importCounter?: CounterImporter;
}

/**
 * Build the `skills` {@link CLICommand} for a CLI to register.
 *
 * Missing `@modality-counter/core` is reported as a plain error rather than an
 * unhandled import rejection, matching `skill`.
 */
export function createSkillsCommand(options: SkillsCommandOptions): CLICommand {
  const {
    name = "skills",
    cliName = "<cli>",
    methodsDir,
    importCounter = () => import("@modality-counter/core"),
  } = options;

  return markRawArgv({
    name,
    // Kept to one line: the help generator renders this in the command index.
    description: "List the skills (Counter methods) available to this CLI",
    usage: [
      `${cliName} ${name}${" ".repeat(20)}(list available methods)`,
      `${cliName} ${name} <method-name> [--<param> <value>...]`,
      "",
      "With no method named, lists every method. A named method prints its raw skill text.",
    ],
    examples: [`${cliName} ${name}`, `${cliName} ${name} create-trade-plan`],
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
      // it here instead, before handing control over. A stat check keeps a
      // stray *file* at the path from bypassing the guard and reaching Counter.
      if (!existsSync(methodsDir) || !statSync(methodsDir).isDirectory()) {
        process.exitCode = 1;
        console.error(`${cliName} ${name}: methods directory not found: ${methodsDir}`);
        return;
      }

      // Counter lists the methods when argv is empty and prints the named one
      // otherwise; forwarding keeps a single source for the list's formatting.
      return counter.toCounterCLI(methodsDir, { cliName, command: name })(args);
    },
  });
}
