/** Detect the active output format from argv/env, mirroring createCliRunner's logic. */
import { outputFormatEnvNames, type OutputFormat } from "./output";

export type RenderMode = OutputFormat;

export function getRenderMode(
  argv: string[] = process.argv,
  cliName?: string,
  env: Record<string, string | undefined> = process.env,
): RenderMode {
  const flags = argv.slice(2);
  if (flags.includes("--jsonl")) return "jsonl";
  if (flags.includes("--json")) return "json";
  if (flags.includes("--human")) return "human";

  // Mirror resolveOutputFormatFromEnv: consult the CLI-scoped env var first
  // (when a cliName is known), then the shared OUTPUT var. An unrecognized
  // value is ignored so a typo degrades to the default instead of failing.
  const names = cliName ? outputFormatEnvNames(cliName) : ["OUTPUT"];
  for (const name of names) {
    const raw = env[name]?.trim();
    if (!raw) continue;
    const lower = raw.toLowerCase();
    if (lower === "json" || lower === "jsonl" || lower === "human") {
      return lower as RenderMode;
    }
  }
  return "human";
}

export function isJsonMode(
  argv?: string[],
  cliName?: string,
  env?: Record<string, string | undefined>,
): boolean {
  const m = getRenderMode(argv, cliName, env);
  return m === "json" || m === "jsonl";
}
