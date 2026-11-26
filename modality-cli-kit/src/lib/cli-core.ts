/** The modality-cli runner, wired from the shared config. */
import { createCliRunner } from "./createCliRunner";
import { cliConfig } from "../config/cliConfig";

const cli = createCliRunner(cliConfig);
export const runCli = cli.run;
