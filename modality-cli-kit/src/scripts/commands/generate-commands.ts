/**
 * `generate-commands` — the kit's own build-time command.
 *
 * One file, one `CLICommand`: schema, implementation, and command surface stay
 * together. Imports point inside the kit; a consuming skill-cli would import the
 * same kit surfaces from the package name instead.
 */
import { dirname, isAbsolute, join, resolve } from "node:path";
import { z } from "zod";
import { generateCommandsIndex, resolveCommandsDir } from "../../lib/commandsDir";
import type { CLICommand } from "../../help/types";

// Keys are kebab-case: the runner normalizes validated args to the spelling
// users type (`--commands-dir`, positional #1), and hands that shape to execute.
const GenerateCommandsArgsSchema = z.object({
  "commands-dir": z
    .string()
    .optional()
    .describe("Directory to scan; defaults to the project's src/scripts/commands"),
  out: z
    .string()
    .optional()
    .describe("Generated module path; defaults to <commandsDir>/../generated.commands.ts"),
});

type GenerateCommandsArgs = z.infer<typeof GenerateCommandsArgsSchema>;

/** Resolve a possibly relative --out against the working directory. */
function resolveOut(out: string): string {
  return isAbsolute(out) ? out : resolve(out);
}

async function generateCommands(args: GenerateCommandsArgs) {
  // `from` must name a *file* — resolveCommandsDir anchors on dirname(from).
  // process.cwd() is a directory, so point it at the cwd's own package.json;
  // under npm workspaces the cwd is the consuming package, not the workspace root.
  const dir =
    args["commands-dir"] ??
    resolveCommandsDir({ from: join(process.cwd(), "package.json") });
  const out = args.out
    ? resolveOut(args.out)
    : join(dirname(dir), "generated.commands.ts");

  const source = await generateCommandsIndex(dir, { out });
  if (!source) {
    return {
      success: false as const,
      error: "nothing generated — commands directory not found",
    };
  }
  return { success: true as const, message: `modality-cli: wrote ${out}` };
}

export const generateCommandsCommand: CLICommand = {
  name: "generate-commands",
  description:
    "Scan a commands directory and write a static commands-index module",
  inputSchema: GenerateCommandsArgsSchema,
  positionalKeys: ["commands-dir"],
  examples: [
    "modality-cli generate-commands",
    "modality-cli generate-commands ./src/scripts/commands --out ./src/scripts/generated.commands.ts",
  ],
  execute: (args: GenerateCommandsArgs) => generateCommands(args),
};
