/**
 * `merge` — a stdin sink that combines the JSON output of several CLI runs.
 *
 * Shell `&&` chains produce one stdout stream carrying several independent JSON
 * documents. This command turns that stream back into a single document so a
 * downstream consumer (an LLM, `jq`, a script) reads one payload instead of
 * re-implementing the parsing every time:
 *
 * ```bash
 * { my-cli alpha && my-cli beta; } | my-cli merge --json
 * ```
 *
 * Note the braces. `|` binds tighter than `&&` in POSIX shells, so
 * `my-cli alpha && my-cli beta | my-cli merge` pipes only `beta` into the sink
 * and lets `alpha` escape to the terminal. No CLI-side handling can recover
 * stdout that never entered the pipe.
 *
 * The parsing itself lives in {@link mergeJsonDocs} — this file holds only the
 * command surface, so the module keeps a single export.
 *
 * ## Quick start
 *
 * ```ts
 * import { createMergeCommand } from "modality-cli-kit";
 *
 * export const registry = createCommandRegistry([...commands, createMergeCommand()]);
 * ```
 */
import { z } from "zod";
import type { CLICommand } from "../../help/types";
import { mergeJsonDocs } from "../lib/jsonDocs";
import type { CLIResult } from "../../ui/output";

/** Read stdin to completion as UTF-8 text. */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  // Buffer.from normalizes whatever the stream yields (string or Buffer) —
  // no cast needed, and it stays correct if the runtime changes chunk type.
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

const MergeArgsSchema = z.object({
  flat: z
    .boolean()
    .optional()
    .describe("Shallow-merge payloads into one object (later document wins on collision)"),
});

/** Options for {@link createMergeCommand}. */
export interface MergeCommandOptions {
  /** Command name in help and dispatch (default: `"merge"`). */
  name?: string;
  /** Binary name used in the generated examples (default: `"<cli>"`). */
  cliName?: string;
  /**
   * Two of the consuming CLI's own command names, so the examples are
   * copy-pasteable rather than placeholders (default: `["alpha", "beta"]`).
   */
  exampleCommands?: [string, string];
}

/**
 * Build the `merge` {@link CLICommand} for a CLI to register.
 *
 * It is CLI-agnostic — it reads whatever JSON arrives on stdin, so it merges
 * output from any command, and from other tools that emit JSON too.
 */
export function createMergeCommand(options?: MergeCommandOptions): CLICommand {
  const {
    name = "merge",
    cliName = "<cli>",
    exampleCommands: [first, second] = ["alpha", "beta"],
  } = options ?? {};

  const chain = `{ ${cliName} ${first} --json && ${cliName} ${second} --json; }`;
  const usageHint = `${name} reads JSON on stdin. Wrap the chain in braces — \`|\` binds tighter than \`&&\`, so without them only the last command reaches the pipe:\n  ${chain} | ${cliName} ${name} --json`;

  return {
    name,
    // Kept to one line: the help generator renders this in the command index.
    description: "Merge the JSON output of piped commands into one document",
    inputSchema: MergeArgsSchema,
    usage: [
      `${chain} | ${cliName} ${name} [options]`,
      "",
      "Drops the empty success envelopes a self-printing command leaves behind,",
      "unwraps { success, result } envelopes, and emits the payloads as one array.",
    ],
    examples: [
      `${chain} | ${cliName} ${name} --json`,
      `${chain} | ${cliName} ${name} --flat --json`,
    ],
    async execute(args: z.infer<typeof MergeArgsSchema>): Promise<CLIResult> {
      // An interactive stdin would block forever waiting for input that is
      // never coming, so fail with the usage instead of hanging.
      if (process.stdin.isTTY) return { success: false, error: usageHint };

      const text = await readStdin();
      if (text.trim().length === 0) {
        return { success: false, error: `No input on stdin.\n${usageHint}` };
      }

      const merged = mergeJsonDocs(text, { flat: args.flat });
      const count = Array.isArray(merged) ? merged.length : Object.keys(merged).length;
      if (count === 0) {
        return { success: false, error: `${name} found no JSON documents in stdin` };
      }

      return { success: true, result: merged };
    },
  };
}
