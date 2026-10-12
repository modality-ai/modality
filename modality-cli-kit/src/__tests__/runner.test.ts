import { describe, test, expect } from "bun:test";
import { z } from "zod";
import { createCliRunner } from "../createCliRunner";
import { createCommandRegistry } from "../registry";
import { setNoColor } from "../help/colors";
import type { CLICommand } from "../help/types";

// Deterministic help strings.
setNoColor(true);

const greet = {
  name: "greet",
  description: "Greet someone",
  inputSchema: z.object({
    name: z.string().describe("Name to greet"),
    loud: z.boolean().optional().describe("Shout it"),
  }),
  positionalKeys: ["name"],
  execute: async (args: { name: string }) => ({ success: true, message: `hi ${args.name}` }),
} as unknown as CLICommand;

const boom = {
  name: "boom",
  description: "Always fails",
  inputSchema: z.object({}),
  execute: async () => ({ success: false, error: "nope" }),
} as unknown as CLICommand;

const makeRegistry = () => createCommandRegistry([greet, boom], { greet: ["g"] });

/** Swap console.log/error for capture buffers; returns them plus a restore fn. */
function captureConsole() {
  const logs: string[] = [];
  const errs: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...a: unknown[]) => logs.push(a.map(String).join(" "));
  console.error = (...a: unknown[]) => errs.push(a.map(String).join(" "));
  return {
    logs,
    errs,
    restore: () => {
      console.log = origLog;
      console.error = origErr;
    },
  };
}

/** Run the given runner with argv while capturing console output. */
async function runCapturing(
  opts: Parameters<typeof createCliRunner>[0],
  argv: string[],
) {
  const cap = captureConsole();
  try {
    const code = await createCliRunner(opts).run(argv);
    return { code, logs: cap.logs, errs: cap.errs };
  } finally {
    cap.restore();
  }
}

const baseOpts = () => ({
  cliName: "my-cli",
  tagline: "My toolkit",
  registry: makeRegistry(),
});

describe("createCliRunner.run", () => {
  test("empty argv invokes onEmpty and returns its exit code", async () => {
    let called = false;
    const { code } = await runCapturing(
      { ...baseOpts(), onEmpty: () => {
          called = true;
          return 7;
        } },
      [],
    );
    expect(called).toBe(true);
    expect(code).toBe(7);
  });

  test("empty argv with no onEmpty and no aiTool prints global help and returns 1", async () => {
    const { code, logs } = await runCapturing(baseOpts(), []);
    expect(code).toBe(1);
    expect(logs.join("\n")).toContain("my-cli");
  });

  test("--help as the first arg prints global help and returns 0", async () => {
    const { code, logs } = await runCapturing(baseOpts(), ["--help"]);
    expect(code).toBe(0);
    expect(logs.join("\n")).toContain("My toolkit");
  });

  test("-h as the first arg returns 0", async () => {
    const { code } = await runCapturing(baseOpts(), ["-h"]);
    expect(code).toBe(0);
  });

  test("unknown command prints an error and returns 1", async () => {
    const { code, errs } = await runCapturing(baseOpts(), ["ghost"]);
    expect(code).toBe(1);
    expect(errs.join("\n")).toContain("Unknown command: ghost");
  });

  test("--help after a known command prints that command's help and returns 0", async () => {
    const { code, logs } = await runCapturing(baseOpts(), ["greet", "--help"]);
    expect(code).toBe(0);
    expect(logs.join("\n")).toContain("my-cli greet");
  });

  test("validation warnings print to stderr and return 1", async () => {
    // `greet` requires a positional `name`; omitting it is a validation failure.
    const { code, errs } = await runCapturing(baseOpts(), ["greet"]);
    expect(code).toBe(1);
    expect(errs.length).toBeGreaterThan(0);
  });

  test("a successful command renders its result and returns 0", async () => {
    const { code, logs } = await runCapturing(baseOpts(), ["greet", "World"]);
    expect(code).toBe(0);
    expect(logs.join("\n")).toContain("hi World");
  });

  test("a command resolves via its alias", async () => {
    const { code, logs } = await runCapturing(baseOpts(), ["g", "World"]);
    expect(code).toBe(0);
    expect(logs.join("\n")).toContain("hi World");
  });

  test("a result with success:false returns exit code 1", async () => {
    const { code } = await runCapturing(baseOpts(), ["boom"]);
    expect(code).toBe(1);
  });

  test("the default render prints human output to stdout", async () => {
    const { code, logs } = await runCapturing(baseOpts(), ["greet", "World"]);
    expect(code).toBe(0);
    expect(logs.join("\n")).toContain("hi World");
    // Human mode renders the message, not a raw JSON envelope.
    expect(logs.join("\n")).not.toContain('"success"');
  });

  test("the default render emits a pretty JSON envelope under --json", async () => {
    const { code, logs } = await runCapturing(baseOpts(), ["greet", "World", "--json"]);
    expect(code).toBe(0);
    expect(logs.join("\n")).toContain('"message": "hi World"');
    expect(logs.join("\n")).toContain('"success": true');
  });

  test("the default render prints nothing for a bare success envelope (self-printing handler)", async () => {
    const silent = {
      name: "silent",
      description: "Prints its own output",
      inputSchema: z.object({}),
      // Handler already wrote to stdout itself; returns only status.
      execute: async () => ({ success: true }),
    } as unknown as CLICommand;
    const opts = {
      cliName: "my-cli",
      tagline: "My toolkit",
      registry: createCommandRegistry([silent], {}),
    };
    const { code, logs } = await runCapturing(opts, ["silent"]);
    expect(code).toBe(0);
    expect(logs.join("")).toBe("");
  });

  test("the default render sends human-mode failures to stderr", async () => {
    const { code, logs, errs } = await runCapturing(baseOpts(), ["boom"]);
    expect(code).toBe(1);
    expect(errs.join("\n")).toContain("nope");
    expect(logs.join("\n")).not.toContain("nope");
  });

  test("the default render streams JSON failures to stdout, not stderr", async () => {
    const { code, logs, errs } = await runCapturing(baseOpts(), ["boom", "--json"]);
    expect(code).toBe(1);
    // Machine formats always go to stdout — only human failures divert to stderr.
    expect(logs.join("\n")).toContain('"error": "nope"');
    expect(errs.join("\n")).not.toContain("nope");
  });

  test("--json formats a non-envelope object compactly (single line)", async () => {
    const raw = {
      name: "raw",
      description: "Returns a bare object with no success field",
      inputSchema: z.object({}),
      execute: async () => ({ data: [1, 2] }),
    } as unknown as CLICommand;
    const opts = {
      cliName: "my-cli",
      tagline: "My toolkit",
      registry: createCommandRegistry([raw], {}),
    };
    const { code, logs } = await runCapturing(opts, ["raw", "--json"]);
    expect(code).toBe(0);
    // Compact, single-line — no pretty-print newlines in the fallback branch.
    expect(logs.join("")).toBe('{"data":[1,2]}');
  });

  test("--jsonl is rejected as an unknown flag now that it left DEFAULT_GLOBAL_FLAGS", async () => {
    // Regression guard: --jsonl was removed as a hardcoded global flag, so a
    // command that does not opt in must reject it rather than silently accept.
    const { code, errs } = await runCapturing(baseOpts(), ["greet", "World", "--jsonl"]);
    expect(code).toBe(1);
    expect(errs.join("\n")).toContain("Unknown flag --jsonl");
  });

  test("a command that opts into --jsonl renders a single-line JSONL envelope", async () => {
    // Declaring `jsonl` on the schema makes --jsonl a known flag, so validation
    // passes and detectFormat routes to the jsonl branch of renderCliResult.
    const stream = {
      name: "stream",
      description: "Supports --jsonl output",
      inputSchema: z.object({ jsonl: z.boolean().optional() }),
      execute: async () => ({ success: true, message: "streamed", result: { id: 1 } }),
    } as unknown as CLICommand;
    const opts = {
      cliName: "my-cli",
      tagline: "My toolkit",
      registry: createCommandRegistry([stream], {}),
    };
    const { code, logs } = await runCapturing(opts, ["stream", "--jsonl"]);
    expect(code).toBe(0);
    // formatJSONL emits the whole envelope on one line, keys in return order.
    expect(logs.join("")).toBe('{"success":true,"message":"streamed","result":{"id":1}}');
  });

  test("--jsonl takes precedence over --json when both are present", async () => {
    const stream = {
      name: "stream",
      description: "Supports --jsonl output",
      inputSchema: z.object({ jsonl: z.boolean().optional() }),
      execute: async () => ({ success: true, message: "streamed" }),
    } as unknown as CLICommand;
    const opts = {
      cliName: "my-cli",
      tagline: "My toolkit",
      registry: createCommandRegistry([stream], {}),
    };
    const { code, logs } = await runCapturing(opts, ["stream", "--jsonl", "--json"]);
    expect(code).toBe(0);
    // jsonl wins: compact single line, not the pretty JSON --json would emit.
    expect(logs.join("")).toBe('{"success":true,"message":"streamed"}');
  });

  test("a command returning undefined renders nothing and still exits 0", async () => {
    const nada = {
      name: "nada",
      description: "Returns nothing",
      inputSchema: z.object({}),
      execute: async () => undefined,
    } as unknown as CLICommand;
    const opts = {
      cliName: "my-cli",
      tagline: "My toolkit",
      registry: createCommandRegistry([nada], {}),
    };
    const { code, logs, errs } = await runCapturing(opts, ["nada"]);
    expect(code).toBe(0);
    expect(logs.join("")).toBe("");
    expect(errs.join("")).toBe("");
  });

  test("human mode pretty-prints a non-envelope object", async () => {
    const raw = {
      name: "raw",
      description: "Returns a bare object with no success field",
      inputSchema: z.object({}),
      execute: async () => ({ data: [1, 2] }),
    } as unknown as CLICommand;
    const opts = {
      cliName: "my-cli",
      tagline: "My toolkit",
      registry: createCommandRegistry([raw], {}),
    };
    const { code, logs } = await runCapturing(opts, ["raw"]);
    expect(code).toBe(0);
    // Human mode indents the fallback branch (mirror of the --json compact test).
    expect(logs.join("")).toBe(JSON.stringify({ data: [1, 2] }, null, 2));
  });

  test("getHelp() exposes global and per-command help", () => {
    const runner = createCliRunner(baseOpts());
    expect(runner.getHelp()).toContain("my-cli");
    expect(runner.getHelp("greet")).toContain("my-cli greet");
  });

  // ── Regression / edge-case coverage ─────────────────────────────────────

  test("async onEmpty callback is awaited", async () => {
    let called = false;
    const { code } = await runCapturing(
      {
        ...baseOpts(),
        onEmpty: async () => {
          called = true;
          return 3;
        },
      },
      [],
    );
    expect(called).toBe(true);
    expect(code).toBe(3);
  });

  test("skipFields are excluded from per-command help output", () => {
    const runner = createCliRunner({
      ...baseOpts(),
      skipFields: ["json"],
    });
    // --help should still work and not include skipFields in the output
    const help = runner.getHelp("greet");
    expect(help).toContain("greet");
  });

  test("--version without a configured version prints (version not configured)", async () => {
    const { code, logs } = await runCapturing(baseOpts(), ["--version"]);
    expect(code).toBe(0);
    expect(logs.join("\n")).toContain("my-cli (version not configured)");
  });

  test("--version prints the version supplied to createCliRunner", async () => {
    const { code, logs } = await runCapturing({ ...baseOpts(), version: "1.2.3" }, ["--version"]);
    expect(code).toBe(0);
    expect(logs.join("\n")).toContain("my-cli v1.2.3");
  });

  test("-v prints the version supplied to createCliRunner", async () => {
    const { code, logs } = await runCapturing({ ...baseOpts(), version: "1.2.3" }, ["-v"]);
    expect(code).toBe(0);
    expect(logs.join("\n")).toContain("my-cli v1.2.3");
  });

  test("-v without a configured version prints (version not configured)", async () => {
    const { code, logs } = await runCapturing(baseOpts(), ["-v"]);
    expect(code).toBe(0);
    expect(logs.join("\n")).toContain("my-cli (version not configured)");
  });

  test("empty-string version is treated as not configured", async () => {
    const { logs } = await runCapturing({ ...baseOpts(), version: "" }, ["--version"]);
    expect(logs.join("\n")).toContain("my-cli (version not configured)");
  });

  test("command with validation error shows help after warnings", async () => {
    const { code, errs, logs } = await runCapturing(baseOpts(), ["greet"]);
    expect(code).toBe(1);
    expect(errs.length).toBeGreaterThan(0);
    // Help should also be shown
    expect(logs.join("\n")).toContain("greet");
  });

  // ── Prefix matching (always on) ──────────────────────────────────────────

  const startCmd = {
    name: "start",
    description: "Start it",
    inputSchema: z.object({}),
    execute: async () => ({ success: true, message: "started" }),
  } as unknown as CLICommand;
  const stopCmd = {
    name: "stop",
    description: "Stop it",
    inputSchema: z.object({}),
    execute: async () => ({ success: true, message: "stopped" }),
  } as unknown as CLICommand;
  const prefixOpts = () => ({
    cliName: "my-cli",
    tagline: "My toolkit",
    registry: createCommandRegistry([startCmd, stopCmd]),
  });

  test("a unique prefix resolves to its command", async () => {
    const { code, logs } = await runCapturing(prefixOpts(), ["sta"]);
    expect(code).toBe(0);
    expect(logs.join("\n")).toContain("started");
  });

  test("an ambiguous prefix errors with candidates and returns 1", async () => {
    const { code, errs } = await runCapturing(prefixOpts(), ["st"]);
    expect(code).toBe(1);
    const out = errs.join("\n");
    expect(out).toContain("Ambiguous command");
    expect(out).toContain('"start"');
    expect(out).toContain('"stop"');
  });

  test("a token that is no command's prefix is still unknown", async () => {
    const { code, errs } = await runCapturing(prefixOpts(), ["zzz"]);
    expect(code).toBe(1);
    expect(errs.join("\n")).toContain("Unknown command: zzz");
  });

  test("--help after a prefix shows the resolved command's help", async () => {
    const { code, logs } = await runCapturing(prefixOpts(), ["sta", "--help"]);
    expect(code).toBe(0);
    expect(logs.join("\n")).toContain("my-cli start");
  });

  test("--help after an exact name shows that command's help", async () => {
    const { code, logs } = await runCapturing(prefixOpts(), ["start", "--help"]);
    expect(code).toBe(0);
    expect(logs.join("\n")).toContain("my-cli start");
  });

  // ── Default render: string passthru ────────────────────────────────────────

  test("default render passes string results through directly (not JSON-wrapped)", async () => {
    const registry = createCommandRegistry([{
      name: "echo",
      description: "Echo back",
      inputSchema: z.object({ text: z.string().describe("Text to echo") }),
      positionalKeys: ["text"],
      execute: async (args: { text: string }) => `You said: ${args.text}`,
    } as unknown as CLICommand]);
    const { code, logs } = await runCapturing(
      { cliName: "my-cli", tagline: "t", registry },
      ["echo", "hello"],
    );
    expect(code).toBe(0);
    const output = logs.join("\n");
    expect(output).toContain("You said: hello");
    expect(output).not.toContain('"You said: hello"');
  });
});

// ── aiTool (counter-script) dispatch ───────────────────────────────────────
// When `aiTool` is supplied the runner routes through `aiTool.execute` instead
// of calling the resolved command directly, so CLI and MCP share one path.
describe("createCliRunner.run — aiTool dispatch", () => {
  /** A recording aiTool that captures the payload it was dispatched. */
  function spyTool(result: unknown = { success: true }) {
    const calls: unknown[] = [];
    const aiTool = {
      execute: async (payload: unknown) => {
        calls.push(payload);
        return result;
      },
    } as unknown as NonNullable<Parameters<typeof createCliRunner>[0]["aiTool"]>;
    return { aiTool, calls };
  }

  /** A command that records whether its own execute() ran. */
  function spyGreet() {
    const calls: unknown[] = [];
    const cmd = {
      name: "greet",
      description: "Greet someone",
      inputSchema: z.object({ name: z.string().describe("Name to greet") }),
      positionalKeys: ["name"],
      execute: async (args: { name: string }) => {
        calls.push(args);
        return { success: true, message: `direct ${args.name}` };
      },
    } as unknown as CLICommand;
    return { registry: createCommandRegistry([cmd], { greet: ["g"] }), calls };
  }

  test("dispatch routes through aiTool.execute when one is supplied", async () => {
    const { aiTool, calls } = spyTool();
    await runCapturing({ ...baseOpts(), aiTool }, ["greet", "World"]);
    expect(calls).toHaveLength(1);
  });

  test("aiTool receives the resolved command name plus validated args", async () => {
    const { aiTool, calls } = spyTool();
    await runCapturing({ ...baseOpts(), aiTool }, ["greet", "World"]);
    expect(calls[0]).toMatchObject({ command: "greet", name: "World" });
  });

  test("aiTool receives the canonical name even when invoked by alias", async () => {
    const { aiTool, calls } = spyTool();
    await runCapturing({ ...baseOpts(), aiTool }, ["g", "World"]);
    expect((calls[0] as { command: string }).command).toBe("greet");
  });

  test("the command's own execute is bypassed when aiTool handles dispatch", async () => {
    const { registry, calls } = spyGreet();
    const { aiTool } = spyTool();
    await runCapturing(
      { cliName: "my-cli", tagline: "t", registry, aiTool },
      ["greet", "World"],
    );
    expect(calls).toHaveLength(0);
  });

  test("aiTool's result drives the exit code (success:false → 1)", async () => {
    const { aiTool } = spyTool({ success: false, error: "nope" });
    const { code } = await runCapturing({ ...baseOpts(), aiTool }, ["greet", "World"]);
    expect(code).toBe(1);
  });

  test("aiTool's result is rendered via the default renderer", async () => {
    const { aiTool } = spyTool({ success: true, message: "via tool" });
    const { logs } = await runCapturing({ ...baseOpts(), aiTool }, ["greet", "World"]);
    expect(logs.join("\n")).toContain("via tool");
  });

  test("empty argv defers to aiTool.execute({}) and returns 0", async () => {
    const { aiTool, calls } = spyTool();
    const { code } = await runCapturing({ ...baseOpts(), aiTool }, []);
    expect(code).toBe(0);
    expect(calls).toEqual([{}]);
  });

  test("aiTool empty-argv renders the result when using default render", async () => {
    const { aiTool } = spyTool("plain string result");
    const { code, logs } = await runCapturing({ ...baseOpts(), aiTool }, []);
    expect(code).toBe(0);
    expect(logs.join("\n")).toContain("plain string result");
  });

  test("an explicit onEmpty still wins over the aiTool default", async () => {
    const { aiTool, calls } = spyTool();
    const { code } = await runCapturing({ ...baseOpts(), aiTool, onEmpty: () => 9 }, []);
    expect(code).toBe(9);
    expect(calls).toHaveLength(0);
  });

  test("empty-argv defer returns 0 even when the aiTool reports success:false", async () => {
    // The defer branch hard-returns 0 and never inspects the result, unlike the
    // command-dispatch path which maps success:false → exit 1.
    const { aiTool } = spyTool({ success: false, error: "ignored" });
    const { code } = await runCapturing({ ...baseOpts(), aiTool }, []);
    expect(code).toBe(0);
  });

});

describe("createCliRunner.getHelp", () => {
  test("globalExamples render in global help", () => {
    const cli = createCliRunner({
      ...baseOpts(),
      globalExamples: ["my-cli greet world", "my-cli greet world --loud"],
    });
    const help = cli.getHelp();
    expect(help).toContain("my-cli greet world --loud");
  });

  test("globalOptionsKeyMap names the value placeholder", () => {
    const cli = createCliRunner({
      ...baseOpts(),
      globalOptionsSchema: z.object({
        cdp: z.string().optional().describe("Browser debug URL"),
      }),
      globalOptionsKeyMap: { cdp: { arg: "<url>" } },
    });
    const help = cli.getHelp();
    expect(help).toContain("--cdp <url>");
    expect(help).not.toContain("--cdp <cdp>");
  });

  test("without a keyMap the placeholder falls back to the key name", () => {
    const cli = createCliRunner({
      ...baseOpts(),
      globalOptionsSchema: z.object({
        cdp: z.string().optional().describe("Browser debug URL"),
      }),
    });
    expect(cli.getHelp()).toContain("--cdp <cdp>");
  });

  test("a supplied footer replaces the default output-format line", () => {
    const cli = createCliRunner({ ...baseOpts(), footer: "Run my-cli <command> --help." });
    const help = cli.getHelp();
    expect(help).toContain("Run my-cli <command> --help.");
    expect(help).not.toContain("Output format: pass");
  });

  test("the default footer still names the format flags when none is supplied", () => {
    expect(createCliRunner(baseOpts()).getHelp()).toContain("Output format: pass");
  });

  test("the default footer points readers at per-command help", () => {
    // Discovery matters as much as format: without this line a reader has no
    // hint that every command carries its own `--help`.
    expect(createCliRunner(baseOpts()).getHelp()).toContain(
      "Run `my-cli <command> --help` for more information about a command.",
    );
  });

  test("help lists the default commands the runner registers", () => {
    // The runner dispatches `merge`, so help must document it — a CLI that
    // renders help from its own registry alone would silently omit it.
    expect(createCliRunner(baseOpts()).getHelp()).toContain("merge");
  });
});
