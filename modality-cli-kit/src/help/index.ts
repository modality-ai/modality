/**
 * `@modality-cli-kit/help` — Composable CLI help utilities.
 *
 * ## Quick start
 *
 * ```ts
 * import { getHelp } from "modality-cli-kit/help";
 *
 * const commands = [ … ];
 *
 * // Global help
 * console.log(getHelp({ cliName: "my-cli", tagline: "My tool", commands }));
 *
 * // Per-command help
 * console.log(getHelp({ cliName: "my-cli", commands, command: "click" }));
 * ```
 */

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
} from "./colors";

// Types
export type { Option, CLICommand, HelpConfig, KeyOverride, HelpFormat, GetHelpOptions } from "./types";

// Generator
export {
  renderCLICommand,
  renderSection,
  getHelp,
} from "./generator";

// Formatter
export {
  visibleWidth,
  padVisible,
  padName,
  flagPad,
  wrapText,
  Lines,
  DEFAULT_COL_NAME_WIDTH,
} from "./formatter";

// Validator
export {
  levenshtein,
  fuzzySuggestion,
  optionFlags,
  knownFlags,
  rejectUnknownFlags,
  buildFlagRejector,
  DEFAULT_GLOBAL_FLAGS,
} from "./validator";

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
} from "./zod-cli";
export type { AiToolContext } from "./zod-cli";

// CLI Builder
export { buildCliFromTools } from "./cli-builder";
export type { BuildCliFromToolsOptions, CliBuildResult } from "./cli-builder";
