import { setupCommandExportValidation } from "../../../lib/command-export-validation";

// Every command module must export exactly one item: its `xxxCommand`. The
// command object's `execute` is the single entry point — a second export is how
// a command file grows a surface that bypasses the dispatcher. Helpers worth
// testing on their own move into `../lib/` (see `defaultCommands/lib/jsonDocs.ts`).
//
// The kit dogfoods the rule it ships: this is the same one-liner a consuming
// CLI writes, pointed at the kit's own default-commands folder.
setupCommandExportValidation(import.meta.dir + "/..");
