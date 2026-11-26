#!/usr/bin/env bun
/**
 * modality-cli — build-time helpers for modality-cli-kit CLIs.
 *
 * Dispatch, help, and the command registry live in lib/ and scripts/; this
 * entry point only starts the runner.
 */
import { runCli } from "../lib/cli-core";

process.exitCode = await runCli();
