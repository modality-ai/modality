#!/usr/bin/env bun
/**
 * modality-cli — build-time helpers for modality-cli-kit CLIs.
 *
 * Currently one subcommand: `generate-commands`, which scans a commands
 * directory and writes the static commands-index module (the production
 * counterpart to the runtime directory scan). Consuming CLIs call it from
 * their own project root instead of maintaining a local generator:
 *
 *   modality-cli generate-commands
 *
 * Because it runs from the consumer's project (not the kit), the commands
 * directory is resolved relative to the working directory unless named.
 */
import { parseArgs } from "node:util";
import { join, dirname, isAbsolute, resolve } from "node:path";
import { generateCommandsIndex, resolveCommandsDir } from "./commandsDir";

const HELP = `modality-cli — build-time helpers for modality-cli-kit CLIs.

Usage:
  modality-cli generate-commands [commandsDir] [--out <path>]

    Scan <commandsDir> and write a static commands-index module. Run from the
    consuming project's root.

    commandsDir   Optional. Defaults to the project's commands directory,
                  resolved from the working directory (<root>/src/scripts/commands,
                  or <root>/dist/scripts/commands inside a build tree).
    --out <path>  Where to write the generated module. Defaults to
                  <commandsDir>/../generated.commands.ts.
`;

/** Resolve the given (possibly relative) --out against the working directory. */
function resolveOut(out: string): string {
  return isAbsolute(out) ? out : resolve(out);
}

async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const first = argv[0];
  if (!first || first === "--help" || first === "-h" || first === "help") {
    process.stdout.write(HELP);
    return 0;
  }

  switch (first) {
    case "generate-commands": {
      let positionals: string[];
      let values: { out?: string };
      try {
        ({ positionals, values } = parseArgs({
          args: argv.slice(1),
          allowPositionals: true,
          options: { out: { type: "string" } },
        }));
      } catch (error) {
        process.stderr.write(
          `modality-cli: invalid options — ${error instanceof Error ? error.message : String(error)}\n\n${HELP}`,
        );
        return 1;
      }
      // `from` must name a *file* — resolveCommandsDir anchors on dirname(from).
      // process.cwd() is a directory, so point it at the cwd's own package.json;
      // under npm workspaces the cwd is the consuming package, not the workspace root.
      const dir =
        positionals[0] ??
        resolveCommandsDir({ from: join(process.cwd(), "package.json") });
      const out = values.out
        ? resolveOut(values.out)
        : join(dirname(dir), "generated.commands.ts");

      const source = await generateCommandsIndex(dir, { out });
      if (!source) {
        process.stderr.write(
          "modality-cli: nothing generated — commands directory not found\n",
        );
        return 1;
      }
      process.stdout.write(`modality-cli: wrote ${out}\n`);
      return 0;
    }

    default:
      process.stderr.write(
        `modality-cli: unknown command "${first}"\n\n${HELP}`,
      );
      return 1;
  }
}

// Run the CLI when executed directly (the kit bundles this entry as its bin);
// importing it for tests must not trigger side effects.
if (import.meta.main) {
  process.exitCode = await main();
}

export { main };