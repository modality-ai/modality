/** The one config shared by the modality-cli runner and help rendering. */
import { defineCliConfig } from "../lib/defineCliConfig";
import { CLI_NAME, TAGLINE, VERSION, registry } from "../scripts/registry";

export const cliConfig = defineCliConfig({
  cliName: CLI_NAME,
  tagline: TAGLINE,
  version: VERSION,
  registry,
  // The kit's default `merge` stdin sink has no role in a build-time bin.
  withoutDefaultCommand: true,
});
