import { afterEach, describe, test, expect } from "bun:test";
import { z } from "zod";
import { createTracer } from "../trace";
import { createCliRunner } from "../createCliRunner";
import { createCommandRegistry } from "../registry";
import { resolveGlobalOptions } from "../globalOptions";
import { setNoColor } from "../help/colors";
import type { CLICommand } from "../help/types";

// Trace lines carry a dim escape sequence in a TTY; turn color off so the
// assertions below compare plain text.
setNoColor(true);

const alpha = {
  name: "alpha",
  description: "First command",
  aliases: ["a"],
  inputSchema: z.object({ name: z.string().optional().describe("who to greet") }),
  execute: async () => ({ success: true }),
} as unknown as CLICommand;

/** Swap console.log/error for buffers around one run; restores unconditionally. */
async function runCapturing(argv: string[], options?: Partial<Parameters<typeof createCliRunner>[0]>) {
  const logs: string[] = [];
  const errs: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...a: unknown[]) => logs.push(a.map(String).join(" "));
  console.error = (...a: unknown[]) => errs.push(a.map(String).join(" "));
  try {
    const code = await createCliRunner({
      cliName: "demo",
      tagline: "Demo CLI",
      registry: createCommandRegistry([alpha]),
      envFile: false,
      ...options,
    }).run(argv);
    return { code, logs, errs };
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
}

const traceLines = (errs: string[]) => errs.filter((line) => line.includes("[trace]"));

// The raw-argv command reports failure through process.exitCode, so reset it
// between tests or the first failure would leak into the worker's exit code.
// Bun ignores `process.exitCode = undefined` (and `delete` throws), so restore
// through a numeric value — 0 keeps the bun-test process itself from exiting
// non-zero on a suite that otherwise passes.
const realExitCode = process.exitCode;
afterEach(() => {
  process.exitCode = realExitCode ?? 0;
});

describe("createTracer", () => {
  test("writes nothing at all when disabled", () => {
    const lines: string[] = [];
    const tracer = createTracer(false, "demo", (line) => lines.push(line));

    tracer.step("resolved command", "alpha");
    expect(lines).toEqual([]);
    // `enabled` is the guard a caller checks before building expensive detail.
    expect(tracer.enabled).toBe(false);
  });

  test("labels each line with the CLI that produced it", () => {
    // A piped chain of kit CLIs shares one stderr, so the name is what tells
    // two interleaved traces apart.
    const lines: string[] = [];
    createTracer(true, "demo", (line) => lines.push(line)).step("argv", "x");
    expect(lines[0]).toBe("[trace] demo: argv x");
  });

  test("renders strings as-is and everything else as JSON", () => {
    const lines: string[] = [];
    const tracer = createTracer(true, "demo", (line) => lines.push(line));

    tracer.step("plain", "already readable");
    tracer.step("args", { name: "ada" });
    tracer.step("argv", ["alpha", "--name", "ada"]);
    tracer.step("bare");

    expect(lines).toEqual([
      "[trace] demo: plain already readable",
      '[trace] demo: args {"name":"ada"}',
      '[trace] demo: argv ["alpha","--name","ada"]',
      "[trace] demo: bare",
    ]);
  });

  test("survives a detail it cannot serialize", () => {
    // A debug aid must never be the thing that throws.
    const lines: string[] = [];
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(() => createTracer(true, "demo", (l) => lines.push(l)).step("x", circular)).not.toThrow();
    expect(lines).toHaveLength(1);
  });

  test("redacts secret-looking keys at any depth", () => {
    // Trace output lands in CI logs and pasted bug reports, so a declared
    // `--token` must not render its value there.
    const lines: string[] = [];
    const tracer = createTracer(true, "demo", (l) => lines.push(l));

    tracer.step("args", { token: "sk-live-123", name: "ada" });
    tracer.step("nested", { outer: { apiKey: "secret-value", keep: 1 } });

    expect(lines[0]).toBe('[trace] demo: args {"token":"***","name":"ada"}');
    expect(lines[1]).toBe('[trace] demo: nested {"outer":{"apiKey":"***","keep":1}}');
    expect(lines.join(" ")).not.toContain("sk-live-123");
    expect(lines.join(" ")).not.toContain("secret-value");
  });

  test("falls back to String() when JSON cannot represent a detail", () => {
    // A Symbol has no JSON representation — JSON.stringify returns undefined —
    // and the rendered line must still say something readable, not nothing.
    const lines: string[] = [];
    createTracer(true, "demo", (l) => lines.push(l)).step("sym", Symbol("x"));
    expect(lines[0]).toBe("[trace] demo: sym Symbol(x)");
  });
});

describe("a command that throws", () => {
  // Commands reject bad usage by throwing ("No input for 'balance'. Pass
  // --file …"). Only the sentence helps the person who forgot a flag; the
  // stack is about the kit's internals.
  const boom = {
    name: "boom",
    description: "Throws on purpose",
    execute: async () => {
      throw new Error("No input for 'boom'. Pass --file <path>.");
    },
  } as unknown as CLICommand;

  const runBoom = (argv: string[]) =>
    runCapturing(argv, { registry: createCommandRegistry([boom]) });

  test("reports the message and exits non-zero, without a stack", async () => {
    const { code, errs } = await runBoom(["boom"]);

    expect(code).toBe(1);
    expect(errs.join(" ")).toContain("No input for 'boom'. Pass --file <path>.");
    // No source excerpt, no `at` frames, no runtime banner.
    expect(errs.join(" ")).not.toContain("at ");
  });

  test("keeps the stack for --trace, where it is the point", async () => {
    const { code, errs } = await runBoom(["boom", "--trace"]);

    expect(code).toBe(1);
    const all = errs.join(" ");
    expect(all).toContain("No input for 'boom'. Pass --file <path>.");
    expect(all).toContain("[trace] demo: stack");
    expect(all).toContain("at ");
  });

  test("survives a thrown non-Error", async () => {
    const odd = {
      name: "odd",
      description: "Throws a string",
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      execute: async () => {
        throw "just a string";
      },
    } as unknown as CLICommand;

    const { code, errs } = await runCapturing(["odd"], {
      registry: createCommandRegistry([odd]),
    });
    expect(code).toBe(1);
    expect(errs.join(" ")).toContain("just a string");
  });
});

describe("--trace", () => {
  test("is silent unless asked for", async () => {
    const { errs } = await runCapturing(["alpha"]);
    expect(traceLines(errs)).toEqual([]);
  });

  test("records the raw argv as the first step, flags included", async () => {
    // argv shows what was actually typed — `--trace` itself included —
    // because the tracer is built from the raw tokens and must be live for
    // the first step it reports. Everything the runner injects or strips
    // happens after this step, so this line is the ground truth.
    const { errs } = await runCapturing(["alpha", "--json", "--trace"]);
    expect(traceLines(errs)[0]).toBe('[trace] demo: argv ["alpha","--json","--trace"]');
  });

  test("reports the dispatch path on stderr, leaving stdout clean", async () => {
    // stdout is the data channel — `cli alpha --json --trace | jq` must stay
    // valid, so not one trace line may land there.
    const { logs, errs } = await runCapturing(["alpha", "--json", "--trace"]);

    const trace = traceLines(errs).join(" ");
    expect(trace).toContain("resolved command alpha");
    expect(trace).toContain("dispatch command.execute");
    expect(logs.join(" ")).not.toContain("[trace]");
    expect(JSON.parse(logs.join(" "))).toMatchObject({ success: true });
  });

  test("shows an alias or prefix next to what it resolved to", async () => {
    // The whole point of tracing resolution: "a" and "alph" are not obviously
    // "alpha" to someone debugging why the wrong command ran.
    for (const typed of ["a", "alph"]) {
      const { errs } = await runCapturing([typed, "--trace"]);
      expect(traceLines(errs).join(" ")).toContain(`resolved command ${typed} -> alpha`);
    }
  });

  test("reports the args as validation produced them", async () => {
    const { errs } = await runCapturing(["alpha", "--name", "ada", "--trace"]);
    // Global flags land in the validated data like any other declared key, so
    // `trace` itself shows up alongside the command's own fields.
    expect(traceLines(errs).join(" ")).toContain('validated args {"name":"ada"');
  });

  test("is accepted as a flag on a command, not rejected as unknown", async () => {
    // It joins the global flag set, so every command must take it without
    // declaring anything.
    const { code, errs } = await runCapturing(["alpha", "--trace"]);
    expect(code).toBe(0);
    expect(errs.join(" ")).not.toContain("Unknown");
  });

  test("appears in the global options section of help", async () => {
    const help = createCliRunner({
      cliName: "demo",
      tagline: "Demo CLI",
      registry: createCommandRegistry([alpha]),
    }).getHelp();
    expect(help).toContain("--trace");
  });

  test("a CLI can switch it off like any other default global", async () => {
    const { errs } = await runCapturing(["alpha", "--trace"], {
      withoutDefaultGlobalOption: ["trace"],
    });
    // Off means off: no trace output, and the flag is no longer recognized.
    expect(traceLines(errs)).toEqual([]);
    expect(resolveGlobalOptions(undefined, ["trace"]).shape).not.toHaveProperty("trace");
  });

  test("narrates a failed resolution instead of falling silent", async () => {
    // "the wrong command resolved" is the tracer's first motivating case, so
    // the not-found path has to say why rather than go quiet before the error.
    const { errs } = await runCapturing(["nope", "--trace"]);
    expect(traceLines(errs).join(" ")).toContain("resolution failed nope is unknown");
  });

  test("reports why validation rejected a run", async () => {
    const { code, errs } = await runCapturing(["alpha", "--bogus", "--trace"]);
    expect(code).toBe(1);
    expect(traceLines(errs).join(" ")).toContain("validation rejected");
  });

  test("names the early-exit paths that never reach a command", async () => {
    const version = await runCapturing(["--version", "--trace"]);
    expect(traceLines(version.errs).join(" ")).toContain("dispatch version");

    const help = await runCapturing(["--help", "--trace"]);
    expect(traceLines(help.errs).join(" ")).toContain("dispatch global help");

    const cmdHelp = await runCapturing(["alpha", "--help", "--trace"]);
    expect(traceLines(cmdHelp.errs).join(" ")).toContain("dispatch help for alpha");
  });

  test("a positional --trace after the terminator does not enable tracing", async () => {
    // Past `--` the token is an argument, not a request to the runner.
    const { errs } = await runCapturing(["alpha", "--", "--trace"]);
    expect(traceLines(errs)).toEqual([]);
  });
});

describe("--trace across dispatch paths", () => {
  test("reports an env-injected format alongside the resolved output format", async () => {
    // The env step fires only when the environment set a format; the
    // output-format step fires on every run with what dispatch resolved to.
    const prev = process.env.OUTPUT;
    process.env.OUTPUT = "json";
    try {
      const { errs } = await runCapturing(["alpha", "--trace"]);
      const trace = traceLines(errs).join(" ");
      expect(trace).toContain("env output format json");
      expect(trace).toContain("output format json");
    } finally {
      if (prev === undefined) delete process.env.OUTPUT;
      else process.env.OUTPUT = prev;
    }
  });

  test("names aiTool.execute when a counter script routes dispatch", async () => {
    const calls: unknown[] = [];
    const aiTool = {
      execute: async (params: unknown) => {
        calls.push(params);
        return { success: true };
      },
    } as unknown as NonNullable<Parameters<typeof createCliRunner>[0]["aiTool"]>;

    const { errs } = await runCapturing(["alpha", "--trace"], { aiTool });
    expect(traceLines(errs).join(" ")).toContain("dispatch aiTool.execute");
    // The runner still routes through the tool with the resolved name attached.
    expect(calls[0]).toMatchObject({ command: "alpha" });
  });

  test("shows the raw-argv handoff for a kit default command", async () => {
    // `skill` owns its argv — it resolves flags from the method's own schema,
    // so the runner hands over the tokens and traces the handoff. methodsDir
    // need not exist: the dispatch steps fire before execute, and the command
    // reports a missing directory instead of hanging.
    const { errs } = await runCapturing(["skill", "some-method", "--trace"], {
      methodsDir: "/nonexistent/methods",
    });
    const trace = traceLines(errs).join(" ");
    expect(trace).toContain("resolved command skill");
    expect(trace).toContain("dispatch raw argv (kit default command)");
    // Global flags were stripped: `--trace` is the runner's, not the method's.
    expect(trace).toContain('forwarded args ["some-method"]');
  });
});
