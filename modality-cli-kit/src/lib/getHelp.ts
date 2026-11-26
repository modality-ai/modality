/**
 * Root `getHelp`: renders the same help as `createCliRunner(...).getHelp`,
 * with default global options, default commands and the format footer applied.
 * The low-level generator stays available as `modality-cli-kit/help`.
 */
import { resolveRunnerCli, type HelpCliOptions } from "./resolveRunnerCli";

export type GetCliHelpOptions = HelpCliOptions;

/** Render global help, or help for one command (name or alias). */
export function getHelp(options: GetCliHelpOptions, command?: string): string {
  return resolveRunnerCli(options).cli.getHelp(command);
}
