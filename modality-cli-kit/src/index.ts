// ── CLI Help Kit ────────────────────────────────────────────────────────────
// Explicit re-exports, no `export *`. Two reasons: the public surface stays
// greppable and frozen (a new export in a leaf module can't silently widen this
// package's API), and no two sources can collide into a silently-dropped name —
// star-export collisions vanish without an error.
//
// Note: `getHelp` is deliberately absent from the help list below. It is
// re-exported from "./getHelp" instead, which shadows the low-level one, so the
// root import renders exactly what the runner does. Listing both would be a
// duplicate-export error.

// Colors
export {
  color,
  setNoColor,
  cmd,
  header,
  opt,
  arg,
  example,
  dim,
  bold,
  error,
  success,
  note,
  link,
} from "./help";

// Help types
export type {
  Option,
  CLICommand,
  HelpConfig,
  KeyOverride,
  HelpFormat,
  GetHelpOptions,
} from "./help";

// Generator
export { renderCLICommand, renderSection } from "./help";

// Formatter
export {
  visibleWidth,
  padVisible,
  padName,
  flagPad,
  wrapText,
  Lines,
  DEFAULT_COL_NAME_WIDTH,
} from "./help";

// Validator
export {
  levenshtein,
  fuzzySuggestion,
  optionFlags,
  knownFlags,
  rejectUnknownFlags,
  buildFlagRejector,
  DEFAULT_GLOBAL_FLAGS,
} from "./help";

// Zod CLI
export {
  autoDefault,
  optionalValueFlag,
  inferOptionType,
  schemaToCliOptions,
  toKebab,
  toFlagName,
  parseCliArgs,
  validateCLICommandArgs,
  buildCLICommandValidator,
  createFlatCommandSchema,
  resolveAiToolCommand,
} from "./help";
export type { AiToolContext } from "./help";

// CLI Builder
export { buildCliFromTools } from "./help";
export type { BuildCliFromToolsOptions, CliBuildResult } from "./help";

// Defaults-aware getHelp.
export { getHelp } from "./getHelp";
export type { GetCliHelpOptions } from "./getHelp";
// Declare the CLI config once; feed it to both createCliRunner and getHelp.
export { defineCliConfig } from "./defineCliConfig";
export type { CliConfig } from "./defineCliConfig";

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
export {
  outputFormatEnvNames,
  resolveOutputFormatFromEnv,
  formatJSON,
  formatHuman,
  formatJSONL,
  formatJSONLItems,
  createOutput,
} from "./ui/output";
export type {
  OutputFormat,
  CLIResult,
  CLIError,
  ResultMeta,
  OutputWriter,
  OutputOptions,
} from "./ui/output";

// ── Terminal UI ─────────────────────────────────────────────────────────────
// Width-aware text rendering (tables, boxes, wrapping) and the escape/timer
// vocabulary for in-place `--watch` loops. Color helpers live in the help
// section above, not here.
// Width measurement
export { stripAnsi, displayWidth, charWidth } from "./ui";
// Text layout
export { pad, wrapToWidth, renderTable, renderBox, sideBySide } from "./ui";
export type { Align, TableOptions } from "./ui";
// Watch-loop escape codes and status lines
export {
  CURSOR_HOME,
  HIDE_CURSOR,
  SHOW_CURSOR,
  CLEAR_SCREEN,
  CLEAR_BELOW,
  SET_TITLE,
  BELL,
  termWidth,
  sleep,
  draw,
  writeTitle,
  refreshingStatus,
  nextTickStatus,
  taipeiClock,
  liveStatus,
  errorStatus,
  watchCountdown,
} from "./ui";

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
