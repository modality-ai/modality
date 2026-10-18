import { describe, test, expect, afterEach } from "bun:test";
import { z } from "zod";
import { createCliRunner } from "../../createCliRunner";
import { createCommandRegistry } from "../../registry";
import { outputFormatEnvNames, resolveOutputFormatFromEnv } from "../output";
import { resolveGlobalOptions, type GlobalOptionName } from "../../globalOptions";
import { setNoColor } from "../../help/colors";
import type { CLICommand } from "../../help/types";

setNoColor(true);

/** Records the args it was handed, so flag injection is observable. */
const seenArgs: unknown[] = [];
const probe = {
  name: "probe",
  description: "Echo the parsed args",
  inputSchema: z.object({}),
  execute: async (args: unknown) => {
    seenArgs.push(args);
    return { success: true, result: { ok: true } };
  },
} as unknown as CLICommand;

/** `jsonl` is not a default global option, so a CLI must declare it to inject `--jsonl`. */
const JSONL_GLOBAL_OPTIONS = z.object({
  jsonl: z.boolean().optional().describe("output JSONL"),
});

/**
 * The runner supplies `json` / `human` / `no-cache` itself, so most runners need
 * no schema at all — pass one only to add a flag, and `withoutDefaultGlobalOption` to
 * take a default away.
 */
const makeRunner = (
  globalOptionsSchema?: z.ZodObject<Record<string, z.ZodType>>,
  withoutDefaultGlobalOption?: boolean | GlobalOptionName[],
) =>
  createCliRunner({
    cliName: "demo-cli",
    tagline: "Demo",
    registry: createCommandRegistry([probe]),
    globalOptionsSchema,
    withoutDefaultGlobalOption,
  });

/** Run with a patched env and captured stdout/stderr. */
async function runWith(
  env: Record<string, string | undefined>,
  argv: string[],
  runner = makeRunner(),
) {
  const originals = new Map(Object.keys(env).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }

  const logs: string[] = [];
  const errs: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...a: unknown[]) => logs.push(a.map(String).join(" "));
  console.error = (...a: unknown[]) => errs.push(a.map(String).join(" "));

  try {
    const code = await runner.run(argv);
    return { code, out: logs.join("\n"), err: errs.join("\n") };
  } finally {
    console.log = origLog;
    console.error = origErr;
    for (const [k, v] of originals) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

afterEach(() => {
  seenArgs.length = 0;
});

describe("outputFormatEnvNames", () => {
  test("derives a CLI-scoped name, then the shared one", () => {
    expect(outputFormatEnvNames("use-stock")).toEqual(["USE_STOCK_OUTPUT", "OUTPUT"]);
  });

  test("normalizes separators and stray characters", () => {
    expect(outputFormatEnvNames("use stock v2!")).toEqual(["USE_STOCK_V2_OUTPUT", "OUTPUT"]);
  });
});

describe("resolveOutputFormatFromEnv", () => {
  test("reads a format, case-insensitively", () => {
    expect(resolveOutputFormatFromEnv("demo", { OUTPUT: "JSON" })).toBe("json");
    expect(resolveOutputFormatFromEnv("demo", { OUTPUT: " human " })).toBe("human");
  });

  test("the CLI-scoped name wins over the shared one", () => {
    const env = { DEMO_OUTPUT: "jsonl", OUTPUT: "json" };
    expect(resolveOutputFormatFromEnv("demo", env)).toBe("jsonl");
  });

  test("undefined when nothing is set, or the value is empty", () => {
    expect(resolveOutputFormatFromEnv("demo", {})).toBeUndefined();
    expect(resolveOutputFormatFromEnv("demo", { OUTPUT: "  " })).toBeUndefined();
  });

  test("reports an unrecognized value and falls through", () => {
    const warnings: string[] = [];
    const format = resolveOutputFormatFromEnv("demo", { OUTPUT: "yaml" }, (m) =>
      warnings.push(m),
    );
    expect(format).toBeUndefined();
    expect(warnings[0]).toContain('OUTPUT="yaml"');
    expect(warnings[0]).toContain("human, json, jsonl");
  });

  test("an invalid CLI-scoped value falls through to a valid shared one", () => {
    const warnings: string[] = [];
    const format = resolveOutputFormatFromEnv(
      "demo",
      { DEMO_OUTPUT: "yaml", OUTPUT: "json" },
      (m) => warnings.push(m),
    );
    expect(format).toBe("json");
    expect(warnings[0]).toContain('DEMO_OUTPUT="yaml"');
  });
});

describe("env-driven output format", () => {
  test("OUTPUT=json renders JSON without the flag", async () => {
    const { out } = await runWith({ OUTPUT: "json", DEMO_CLI_OUTPUT: undefined }, ["probe"]);
    expect(JSON.parse(out)).toEqual({ success: true, result: { ok: true } });
  });

  test("OUTPUT=json also injects --json, so the handler agrees with the renderer", async () => {
    await runWith({ OUTPUT: "json", DEMO_CLI_OUTPUT: undefined }, ["probe"]);
    expect(seenArgs).toEqual([{ json: true }]);
  });

  test("no env leaves argv untouched", async () => {
    await runWith({ OUTPUT: undefined, DEMO_CLI_OUTPUT: undefined }, ["probe"]);
    expect(seenArgs).toEqual([{}]);
  });

  test("OUTPUT=human injects nothing when the CLI opted out of --human", async () => {
    const runner = makeRunner(undefined, ["human"]);
    const { out } = await runWith({ OUTPUT: "human", DEMO_CLI_OUTPUT: undefined }, ["probe"], runner);
    expect(seenArgs).toEqual([{}]);
    expect(out).not.toContain('"success"');
  });

  test("OUTPUT=human injects --human, which the runner supplies by default", async () => {
    // A CLI whose handlers default to machine output reads `--human` to decide
    // what to print, so the env must reach the handler — not just the renderer.
    await runWith({ OUTPUT: "human", DEMO_CLI_OUTPUT: undefined }, ["probe"]);
    expect(seenArgs).toEqual([{ human: true }]);
  });

  test("OUTPUT=human injects --human before a `--` terminator", async () => {
    await runWith({ OUTPUT: "human", DEMO_CLI_OUTPUT: undefined }, ["probe", "--", "x"]);
    expect(seenArgs).toEqual([{ human: true }]);
  });

  test("an explicit --json beats OUTPUT=human, and no --human is injected", async () => {
    const { out } = await runWith({ OUTPUT: "human", DEMO_CLI_OUTPUT: undefined }, [
      "probe",
      "--json",
    ]);
    expect(seenArgs).toEqual([{ json: true }]);
    expect(JSON.parse(out).success).toBe(true);
  });

  test("an explicit --human beats OUTPUT=json", async () => {
    const { out } = await runWith({ OUTPUT: "json", DEMO_CLI_OUTPUT: undefined }, [
      "probe",
      "--human",
    ]);
    expect(seenArgs).toEqual([{ human: true }]);
    expect(out).not.toContain('"success"');
  });

  test("OUTPUT=human is not injected twice when --human is already present", async () => {
    const { code } = await runWith({ OUTPUT: "human", DEMO_CLI_OUTPUT: undefined }, [
      "probe",
      "--human",
    ]);
    expect(code).toBe(0);
    expect(seenArgs).toEqual([{ human: true }]);
  });

  test("a per-command --human does not hijack the format when human is opted out", async () => {
    // With `human` off globally, `--human` here is the command's own flag —
    // OUTPUT=json must still select JSON for the renderer.
    const humanProbe = {
      name: "hprobe",
      description: "Declares its own --human",
      inputSchema: z.object({ human: z.boolean().optional() }),
      execute: async (args: unknown) => {
        seenArgs.push(args);
        return { success: true, result: { ok: true } };
      },
    } as unknown as CLICommand;
    const runner = createCliRunner({
      cliName: "demo-cli",
      tagline: "Demo",
      registry: createCommandRegistry([humanProbe]),
      withoutDefaultGlobalOption: ["human"],
    });

    const { out } = await runWith(
      { OUTPUT: "json", DEMO_CLI_OUTPUT: undefined },
      ["hprobe", "--human"],
      runner,
    );
    expect(seenArgs).toEqual([{ human: true, json: true }]);
    expect(JSON.parse(out).success).toBe(true);
  });

  test("the CLI-scoped variable wins over the shared one", async () => {
    const { out } = await runWith({ OUTPUT: "human", DEMO_CLI_OUTPUT: "json" }, ["probe"]);
    expect(JSON.parse(out).success).toBe(true);
  });

  test("an unrecognized value warns and falls back to human", async () => {
    const { out, err } = await runWith({ OUTPUT: "yaml", DEMO_CLI_OUTPUT: undefined }, [
      "probe",
    ]);
    expect(err).toContain("Ignoring OUTPUT");
    expect(out).not.toContain('"success"');
  });

  test("no flag is injected when the CLI opted out of every global option", async () => {
    // Injecting --json here would be rejected by per-command validation.
    const runner = makeRunner(undefined, true);
    const { code } = await runWith(
      { OUTPUT: "json", DEMO_CLI_OUTPUT: undefined },
      ["probe"],
      runner,
    );
    expect(code).toBe(0);
    expect(seenArgs).toEqual([{}]);
  });

  test("the renderer ignores an env format the CLI opted out of", async () => {
    // With no injectable flag, the handler prints human text and the renderer
    // must not wrap it as JSON — that would corrupt the output mid-stream.
    const selfPrint = {
      name: "selfprint",
      description: "Prints its own output",
      inputSchema: z.object({}),
      execute: async () => {
        console.log("human text");
        return { success: true };
      },
    } as unknown as CLICommand;
    const runner = createCliRunner({
      cliName: "demo",
      tagline: "Demo",
      registry: createCommandRegistry([selfPrint]),
      withoutDefaultGlobalOption: true,
    });

    const { out } = await runWith({ OUTPUT: "json", DEMO_CLI_OUTPUT: undefined }, ["selfprint"], runner);
    expect(out).toBe("human text");
  });

  test("OUTPUT=json injects the flag before a `--` terminator", async () => {
    // An appended flag would land after `--`, where it parses as a positional
    // instead of a flag and never reaches the handler.
    await runWith({ OUTPUT: "json", DEMO_CLI_OUTPUT: undefined }, ["probe", "--", "x"]);
    expect(seenArgs).toEqual([{ json: true }]);
  });

  test("help names the environment variables", () => {
    const help = makeRunner().getHelp();
    expect(help).toContain("DEMO_CLI_OUTPUT");
    expect(help).toContain("OUTPUT");
  });

  test("OUTPUT=jsonl injects --jsonl", async () => {
    const runner = makeRunner(JSONL_GLOBAL_OPTIONS);
    await runWith({ OUTPUT: "jsonl", DEMO_CLI_OUTPUT: undefined }, ["probe"], runner);
    expect(seenArgs).toEqual([{ jsonl: true }]);
  });

  test("OUTPUT=jsonl renders JSONL", async () => {
    const runner = makeRunner(JSONL_GLOBAL_OPTIONS);
    const { out } = await runWith({ OUTPUT: "jsonl", DEMO_CLI_OUTPUT: undefined }, ["probe"], runner);
    expect(out).toBe('{"success":true,"result":{"ok":true}}');
  });

  test("an explicit --jsonl beats OUTPUT=json", async () => {
    const runner = makeRunner(JSONL_GLOBAL_OPTIONS);
    const { out } = await runWith(
      { OUTPUT: "json", DEMO_CLI_OUTPUT: undefined },
      ["probe", "--jsonl"],
      runner,
    );
    expect(seenArgs).toEqual([{ jsonl: true }]);
    expect(out).toBe('{"success":true,"result":{"ok":true}}');
  });

  test("--help with OUTPUT=json still renders help, not an injected flag", async () => {
    const { code, out } = await runWith({ OUTPUT: "json", DEMO_CLI_OUTPUT: undefined }, ["--help"]);
    expect(code).toBe(0);
    expect(out).toContain("probe");
  });

  test("empty argv with OUTPUT=json prints help instead of resolving the injected flag as a command", async () => {
    const { code, out, err } = await runWith({ OUTPUT: "json", DEMO_CLI_OUTPUT: undefined }, []);
    expect(code).toBe(1);
    expect(out).toContain("probe");
    expect(err).not.toContain("Unknown command");
  });

  test("a positional --json after -- does not count as an explicit format flag", async () => {
    // Tokens after `--` are positionals, not flags — OUTPUT=human must win over
    // a --json that landed past the terminator, or the runner wraps the
    // handler's human output as JSON.
    const { out } = await runWith({ OUTPUT: "human", DEMO_CLI_OUTPUT: undefined }, [
      "probe",
      "--",
      "--json",
    ]);
    expect(seenArgs).toEqual([{ human: true }]);
    expect(out).not.toContain('"success"');
  });

  test("the help footer names only the format flags this CLI kept", async () => {
    const full = makeRunner().getHelp();
    expect(full).toContain("--json or --human");
    expect(full).toContain("A flag beats the environment.");

    const noHuman = makeRunner(undefined, ["human"]).getHelp();
    expect(noHuman).toContain("--json");
    expect(noHuman).not.toContain("--human");

    const bare = makeRunner(undefined, true).getHelp();
    expect(bare).toContain("no format flag");
    expect(bare).not.toContain("--json");
    expect(bare).not.toContain("--human");
  });

  test("a declared non-default format flag joins the footer list", () => {
    const runner = makeRunner(JSONL_GLOBAL_OPTIONS);
    expect(runner.getHelp()).toContain("--json or --jsonl or --human");
  });

  test("a declared single-char global flag is accepted by per-command validation", async () => {
    // Help renders a single-char global key as a short flag (-v); the runner
    // must forward it so validation accepts the flag it advertises.
    const runner = makeRunner(z.object({ v: z.boolean().optional() }));
    const { code } = await runWith(
      { OUTPUT: undefined, DEMO_CLI_OUTPUT: undefined },
      ["probe", "-v"],
      runner,
    );
    expect(code).toBe(0);
    expect(seenArgs).toEqual([{ v: true }]);
  });
});

describe("default global options", () => {
  test("supplies json/human/no-cache without any schema", () => {
    const help = makeRunner().getHelp();
    expect(help).toContain("--json");
    expect(help).toContain("--human");
    expect(help).toContain("--no-cache");
  });

  test("a CLI-supplied key overrides the default of the same name", () => {
    const runner = makeRunner(
      z.object({ json: z.boolean().optional().describe("custom json wording") }),
    );
    const help = runner.getHelp();
    expect(help).toContain("custom json wording");
    expect(help).not.toContain("CLIResult envelope");
    // The other defaults survive the override.
    expect(help).toContain("--human");
  });

  test("withoutDefaultGlobalOption removes only the named defaults", () => {
    const runner = makeRunner(undefined, ["human", "no-cache"]);
    const help = runner.getHelp();
    expect(help).toContain("--json");
    expect(help).not.toContain("--human");
    expect(help).not.toContain("--no-cache");
  });

  test("withoutDefaultGlobalOption: true removes every default", () => {
    const runner = makeRunner(undefined, true);
    const help = runner.getHelp();
    expect(help).not.toContain("--json");
    expect(help).not.toContain("--human");
    expect(help).not.toContain("--no-cache");
  });

  test("global options merge into per-command validation", async () => {
    const { code } = await runWith({ OUTPUT: undefined, DEMO_CLI_OUTPUT: undefined }, [
      "probe",
      "--no-cache",
    ]);
    expect(code).toBe(0);
  });

  test("the default options enforce their types", () => {
    const schema = resolveGlobalOptions(undefined, undefined);
    expect(schema.safeParse({ json: "yes" }).success).toBe(false);
    expect(schema.safeParse({ human: 1 }).success).toBe(false);
    expect(schema.safeParse({ "no-cache": {} }).success).toBe(false);
    expect(schema.safeParse({ json: true, human: true, "no-cache": true }).success).toBe(true);
  });
});
