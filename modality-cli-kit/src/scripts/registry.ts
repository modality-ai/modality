/** The modality-cli bin's registry, built from the generated commands index. */
import { createRequire } from "node:module";
import { createCommandRegistry } from "../lib/registry";
import { commands } from "./generated.commands";

const require = createRequire(import.meta.url);
const pkg = require("../../package.json") as { version: string };
export const VERSION = pkg.version;

/** Binary name shown in help usage lines. */
export const CLI_NAME = "modality-cli";

export const TAGLINE = "build-time helpers for modality-cli-kit CLIs";

export const registry = createCommandRegistry(commands);
