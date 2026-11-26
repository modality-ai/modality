/**
 * Regenerate this kit's own commands index from source.
 *
 * The same generator consumers run through `modality-cli generate-commands`,
 * with the CLICommand type imported from inside the kit instead of the package
 * name.
 */
import { resolve } from "node:path";
import { generateCommandsIndex } from "../lib/commandsDir";

await generateCommandsIndex(resolve(import.meta.dir, "commands"), {
  out: resolve(import.meta.dir, "generated.commands.ts"),
  cliCommandImport: "../help/types",
});
