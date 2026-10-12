/**
 * Declare a CLI's shared config once.
 *
 * The same object feeds `createCliRunner({ ...config, aiTool })` and the
 * standalone `getHelp(config)`, so both render identical help — including
 * default commands (`skill`) and global options — and cannot drift apart.
 * `aiTool` is deliberately absent from {@link CliConfig}: it is assembled from
 * the registry and handed to the runner beside the config, never declared in
 * it. This helper checks the fields a config must carry — `registry` and the
 * rest — and allows extras, so an `aiTool` written here passes unchecked; it
 * belongs in the `createCliRunner` call.
 */
import type { CliRunnerOptions } from "./createCliRunner";

/** Config shared by the runner and the standalone help renderer. */
export type CliConfig = Omit<CliRunnerOptions, "aiTool">;

/** Identity helper that types and returns the shared CLI config. */
export function defineCliConfig<T extends CliConfig>(config: T): T {
  return config;
}
