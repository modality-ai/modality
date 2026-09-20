// ── CLI Help Kit ────────────────────────────────────────────────────────────
// Re-export the curated /help barrel so consumers can import from
// "modality-cli-kit" without needing a /help sub-path.
export * from "./help";

// Reusable test suite: enforce the one-export-per-command-module rule.
export { setupCommandExportValidation } from "./command-export-validation";
// Command-file predicate shared by the scanner and the export validator.
export { isCommandFile } from "./command-file";
export type { CommandExportValidationOptions } from "./command-export-validation";

// ── Command Registry & Runner ────────────────────────────────────────────────
// Shareable command-registry + argv-dispatch loop so a consuming CLI only
// supplies its commands and a little config.
export { createCommandRegistry } from "./registry";
export type { CommandRegistry, CommandResolution } from "./registry";
// Directory-scanned registry: the commands folder replaces a hand-written index
// module, so adding or removing a command is adding or removing a file.
export { createCommandRegistryFromDir, loadCommandsFromDir, resolveCommandsDir } from "./commandsDir";
export type { LoadCommandsOptions, ResolveCommandsDirOptions } from "./commandsDir";
// Build-time counterpart: generate a static commands-index module from the same
// directory, so a bundled CLI renders one shared dependency graph instead of
// paying per-command entrypoints or a startup directory scan.
export { generateCommandsIndex } from "./commandsDir";
export type { GenerateCommandsIndexOptions } from "./commandsDir";
export { createCliRunner } from "./createCliRunner";
export type { CliRunner, CliRunnerOptions } from "./createCliRunner";
// Exported so a CLI that renders help itself (e.g. an MCP-tool help path) can
// build the same merged global-options view the runner uses.
export { resolveGlobalOptions } from "./globalOptions";
export type { GlobalOptionName } from "./globalOptions";

// ── CLI Output Types ────────────────────────────────────────────────────────
// Shared output format types (JSON, human, JSONL) for CLI commands.
export * from "./output";

// ── Default Commands ────────────────────────────────────────────────────────
// Commands `createCliRunner` registers on every CLI's behalf: the `merge`
// stdin sink, which folds a piped command chain into one document, and `skill`,
// which prints a Counter method's raw skill text for a CLI that sets
// `methodsDir`.
export { createMergeCommand, createSkillCommand } from "./defaultCommands";
export type {
  DefaultCommandName,
  MergeCommandOptions,
  SkillCommandOptions,
} from "./defaultCommands";

// The multi-document JSON parsing behind `merge`, usable without it — parse a
// captured stream directly instead of piping through the command.
export { splitJsonDocs, mergeJsonDocs } from "./defaultCommands/lib/jsonDocs";
