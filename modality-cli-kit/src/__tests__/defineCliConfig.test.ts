import { describe, expect, spyOn, test } from "bun:test";
import type { AITool } from "modality-mcp-kit";
import { z } from "zod";
import {
  createCommandRegistry,
  createCliRunner,
  defineCliConfig,
  getHelp,
  type CliConfig,
} from "../index";

const registry = createCommandRegistry([
  {
    name: "foo",
    description: "Run foo",
    inputSchema: z.object({ target: z.string().optional() }),
    execute: async () => ({ success: true }),
  },
]);

const config = defineCliConfig({
  cliName: "demo",
  tagline: "Demo toolkit",
  registry,
  globalOptionsSchema: z.object({
    help: z.boolean().optional().describe("Show this help message"),
    json: z.boolean().optional().describe("Output in JSON format"),
  }),
});

/** A config carrying only the fields every CLI must declare. */
const minimalConfig = defineCliConfig({
  cliName: "min",
  tagline: "Minimal CLI",
  registry,
});

describe("defineCliConfig", () => {
  test("keeps the declared values on the returned config", () => {
    expect(config.cliName).toBe("demo");
    expect(config.registry).toBe(registry);
  });

  test("standalone getHelp matches runner.getHelp for the same config", () => {
    const runner = createCliRunner(config);
    expect(getHelp(config)).toBe(runner.getHelp());
  });

  test("returns the same object reference", () => {
    const input = { cliName: "demo", tagline: "Demo toolkit", registry };
    expect(defineCliConfig(input)).toBe(input);
  });

  test("keeps aiTool out of the shared config type", () => {
    // Enforced by the compiler: if `aiTool` ever rejoins `CliConfig`, this
    // annotation stops type-checking and the declaration build fails.
    const aiToolInConfig: "aiTool" extends keyof CliConfig ? true : false = false;
    expect(aiToolInConfig).toBe(false);
  });

  test("accepts a config with only the required fields", () => {
    expect(minimalConfig.tagline).toBe("Minimal CLI");
  });

  test("standalone getHelp matches runner.getHelp without a declared global options schema", () => {
    expect(getHelp(minimalConfig)).toBe(createCliRunner(minimalConfig).getHelp());
  });

  test("runner built as documented — { ...config, aiTool } — renders the same help", () => {
    const aiTool: AITool = {
      execute: async () => ({ success: true }),
    };
    // The docstring's usage: one config object feeds both paths, and supplying
    // an aiTool (excluded from the config itself) cannot change the help.
    expect(createCliRunner({ ...config, aiTool }).getHelp()).toBe(getHelp(config));
  });

  test("version declared on the config reaches the runner's --version", async () => {
    // `version` is one of the fields CliConfig carries that the help options do
    // not — the reason a single object can serve both paths.
    const versioned = defineCliConfig({ ...minimalConfig, version: "1.2.3" });
    const log = spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(await createCliRunner({ ...versioned, envFile: false }).run(["--version"])).toBe(0);
      expect(log.mock.calls.flat().join("\n")).toContain("min v1.2.3");
    } finally {
      log.mockRestore();
    }
  });
});
