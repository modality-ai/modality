import { afterAll, afterEach, beforeEach, describe, test, expect } from "bun:test";
import { bunMockModule, clearAllMocks } from "modality-bun-kit";
import { createSkillCommand } from "../skill";
import { createCliRunner } from "../../../createCliRunner";
import { createCommandRegistry } from "../../../registry";
import { setNoColor } from "../../../help/colors";
import type { CLICommand } from "../../../help/types";

// The command's own validation — the schema built from a method's declared
// parameters, applied to the argv a caller actually typed — only runs when
// `@modality-counter/core` imports successfully, which the kit never does for
// itself. So the optional package is mocked here and the tests exercise the
// real `createSkillCommand` against the real `buildMethodParamsSchema` and
// `parseCounterParams` — the mock supplies only what Counter itself would.
//
// Mock lifecycle is `bunMockModule` (modality-bun-kit) throughout: it stores
// the original module and returns a reset function. There is no original to
// store — the package is not installed — so its reset re-mocks to `{}`; that
// is harmless because each test re-registers the content mock.
//
// The first describe runs with NO mock registered: the missing-package path
// can only be exercised by the import genuinely failing, which `bunMockModule`
// cannot express (its factory is eager content, and Bun has no un-mock API).
// It must precede the mocked describes — Bun runs tests in declaration order,
// and `bunMockModule`'s `{}` reset is the module's state for the rest of the
// run. No other test file imports `@modality-counter/core` after the
// missing-package tests moved here from `skill.test.ts`, so plain `bun test`
// needs no `--isolate`.

// Deterministic help strings (not asserted here, but the command builds them).
setNoColor(true);

// The mocked Counter. Mutable fields are reset in `beforeEach`, so the mock
// factory can be a stable shape that reads current state per call.
const counter = {
  items: [] as { id: string; filePath: string }[],
  yaml: undefined as unknown,
  /** When set, `readMdxYaml` rejects with it — a malformed file on disk. */
  throwOnRead: undefined as Error | undefined,
  /** Every argv array handed to `toCounterCLI`, in order. */
  cliCalls: [] as string[][],
  /** The options object handed to `toCounterCLI`, parallel to `cliCalls`. */
  cliOptions: [] as unknown[],
};

const counterMock = () => ({
  getAllCounterItems: async () => counter.items,
  readMdxYaml: async () => {
    if (counter.throwOnRead) throw counter.throwOnRead;
    return counter.yaml;
  },
  toCounterCLI: (_baseDir: string, options?: unknown) => async (args: string[]) => {
    counter.cliCalls.push(args);
    counter.cliOptions.push(options);
    return { success: true };
  },
  toCounterCLIHelp: () => async () => false,
});

/** A method with one required object parameter — the default MDX. */
const DEFAULT_YAML = {
  method: { usage: { parameters: { trigger: { type: "object", required: true } } } },
};

const alpha = {
  name: "alpha",
  description: "First command",
  execute: async () => ({ success: true }),
} as unknown as CLICommand;

/**
 * A methods directory that exists on disk. The command refuses to run against a
 * missing one (Counter's CLI would `process.exit(1)` there), so the mocked
 * tests — which never read the directory, only the mocked Counter — need a real
 * path. Its contents are irrelevant.
 */
const METHODS_DIR = import.meta.dir;

/** A path that is guaranteed absent, for the directory-missing behavior. */
const MISSING_DIR = "/repo/methods";

const makeRunner = (methodsDir = METHODS_DIR) =>
  createCliRunner({
    cliName: "demo",
    tagline: "Demo CLI",
    registry: createCommandRegistry([alpha]),
    methodsDir,
  });

const cmd = createSkillCommand({ cliName: "demo", methodsDir: METHODS_DIR });

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

// The command reports failure through process.exitCode, so reset it between
// tests. Bun ignores `process.exitCode = undefined` (and `delete` throws), so
// restore through a numeric value — 0 keeps the bun-test process itself from
// exiting non-zero on a suite that otherwise passes.
const realExitCode = process.exitCode;
afterEach(() => {
  process.exitCode = realExitCode ?? 0;
});

// The optional package is installed in this repo, so its absence cannot be
// produced by leaving it unmocked — `bunMockModule`'s factory is eager content
// and Bun has no un-mock API. The command takes an `importCounter` seam for
// exactly this: a rejecting importer is the genuine missing-package path.
describe("skill command without @modality-counter/core", () => {
  const missingCmd = createSkillCommand({
    cliName: "demo",
    methodsDir: METHODS_DIR,
    importCounter: () => Promise.reject(new Error("Cannot find package")),
  });

  test("reports the missing optional package instead of throwing", async () => {
    const cap = captureConsole();
    try {
      await (missingCmd.execute as (args: string[]) => Promise<void>)(["some-method"]);
    } finally {
      cap.restore();
    }
    expect(cap.errs.join("\n")).toContain("@modality-counter/core");
    expect(process.exitCode).toBe(1);
  });

  test("a --help after a method name is forwarded to the command", async () => {
    const cap = captureConsole();
    let code: number;
    try {
      // Reaching the command means reaching its own methodsDir check — proof
      // the runner handed the args over instead of printing its own help.
      // (The runner builds its skill command itself, so it uses the real
      // importer; `/repo/methods` does not exist, which is what it reports.)
      code = await makeRunner(MISSING_DIR).run(["skill", "a-method", "--help"]);
    } finally {
      cap.restore();
    }
    expect(code).toBe(1);
    expect(cap.errs.join("\n")).toContain("methods directory not found");
  });
});

describe("skill command with @modality-counter/core mocked", () => {
  let resetMock: (() => void) | undefined;

  beforeEach(async () => {
    counter.items = [{ id: "create-trade-plan", filePath: "/repo/methods/create-trade-plan.md" }];
    counter.yaml = structuredClone(DEFAULT_YAML);
    counter.throwOnRead = undefined;
    counter.cliCalls = [];
    counter.cliOptions = [];

    // Package specifier, so `callerDir` matters little — it anchors the
    // node_modules lookup for the original-import attempt, which fails here
    // and falls back gracefully.
    resetMock = await bunMockModule("@modality-counter/core", counterMock, import.meta.dir);
  });

  afterEach(() => resetMock?.());

  afterAll(() => clearAllMocks());

  /** Run `execute` while capturing console output; returns what it printed. */
  async function executeCapturing(args: string[]) {
    const cap = captureConsole();
    try {
      await (cmd.execute as (args: string[]) => Promise<unknown>)(args);
    } finally {
      cap.restore();
    }
    return { logs: cap.logs, errs: cap.errs };
  }

  describe("skill validation", () => {
    test("forwards valid params to the method unchanged", async () => {
      const { errs } = await executeCapturing([
        "create-trade-plan",
        "--trigger",
        '{"rule":"x"}',
      ]);
      expect(errs).toEqual([]);
      expect(counter.cliCalls).toEqual([["create-trade-plan", "--trigger", '{"rule":"x"}']]);
    });

    test("no parameters at all prints the method without validating", async () => {
      // `<cli> skill <method>` alone is the primary use — requiring a method's
      // parameters there would break it, even when one is declared required.
      const { errs } = await executeCapturing(["create-trade-plan"]);
      expect(errs).toEqual([]);
      expect(counter.cliCalls).toEqual([["create-trade-plan"]]);
    });

    test("an unknown method is Counter's to report, not validated here", async () => {
      const { errs } = await executeCapturing(["ghost-method"]);
      expect(errs).toEqual([]);
      expect(counter.cliCalls).toEqual([["ghost-method"]]);
    });

    test("rejects an invalid value with the flag and the accepted set", async () => {
      const { errs } = await executeCapturing(["create-trade-plan", "--trigger", "not-json"]);
      expect(process.exitCode).toBe(1);
      expect(counter.cliCalls).toEqual([]);
      expect(errs.join("\n")).toContain("demo skill create-trade-plan: invalid parameters");
      expect(errs.join("\n")).toContain("--trigger — expected a JSON object");
      expect(errs.join("\n")).toContain("Accepted: --refs, --reference, --trigger");
    });

    test("rejects an undeclared parameter by name", async () => {
      const { errs } = await executeCapturing(["create-trade-plan", "--bogus", "x"]);
      expect(process.exitCode).toBe(1);
      expect(counter.cliCalls).toEqual([]);
      expect(errs.join("\n")).toContain("--bogus — not a parameter of this method");
    });

    test("a missing required parameter is reported as such, not as a bad value", async () => {
      counter.yaml = {
        method: {
          usage: {
            parameters: {
              mode: { type: "string" },
              trigger: { type: "object", required: true },
            },
          },
        },
      };
      const { errs } = await executeCapturing(["create-trade-plan", "--mode", "x"]);
      expect(process.exitCode).toBe(1);
      expect(errs.join("\n")).toContain("--trigger — required, but not supplied");
    });

    test("an authoring mistake in the method's MDX names the method", async () => {
      counter.yaml = { method: { usage: { parameters: { blob: { type: "blob" } } } } };
      const { errs } = await executeCapturing(["create-trade-plan"]);
      expect(process.exitCode).toBe(1);
      expect(counter.cliCalls).toEqual([]);
      expect(errs.join("\n")).toContain(
        'demo skill create-trade-plan: Parameter "blob" declares unsupported type "blob"',
      );
    });

    test("an unreadable method file reports the method, not an unhandled error", async () => {
      // A malformed MDX/YAML on disk rejects `readMdxYaml` — the failure must
      // come back as the per-method message, not a raw rejection out of run().
      counter.throwOnRead = new Error("YAML parse error at line 3");
      const { errs } = await executeCapturing(["create-trade-plan", "--trigger", "{}"]);
      expect(process.exitCode).toBe(1);
      expect(counter.cliCalls).toEqual([]);
      expect(errs.join("\n")).toContain(
        "demo skill create-trade-plan: YAML parse error at line 3",
      );
    });

    test("the command's own flags never count as method parameters", async () => {
      // `--refs` is stripped before params are read, so a required `trigger`
      // must not be demanded because of it — the run proceeds to Counter.
      const { errs } = await executeCapturing(["create-trade-plan", "--refs"]);
      expect(errs).toEqual([]);
      expect(counter.cliCalls).toEqual([["create-trade-plan", "--refs"]]);
    });

    test("a method's own declaration wins over the command's", async () => {
      // `{ ...COMMAND_PARAMS, ...declared }` — a method that declares
      // `reference` for itself replaces the command's string with its own type.
      counter.yaml = { method: { usage: { parameters: { reference: { type: "number" } } } } };
      const { errs } = await executeCapturing(["create-trade-plan", "--reference", "abc"]);
      expect(process.exitCode).toBe(1);
      expect(errs.join("\n")).toContain("--reference — expected a number");
    });
  });

  describe("skill → Counter call contract", () => {
    test("hands Counter the cli name and bare command, not a display string", async () => {
      // `toCounterCLI` takes an options object; a caller that builds a
      // `${cliName} ${name}` string makes Counter render a help header it never
      // matches, and `command` must be the bare name Counter's context reports.
      await executeCapturing(["create-trade-plan"]);
      expect(counter.cliOptions).toEqual([{ cliName: "demo", command: "skill" }]);
    });
  });

  describe("skill raw-argv dispatch", () => {
    test("a failed raw-argv run does not poison the next one", async () => {
      // `runRawArgs` resets `process.exitCode` before each run — Bun ignores
      // `process.exitCode = undefined`, so the reset must be numeric. Without
      // it, the first run's failure would leak into the second's exit code.
      const runner = makeRunner();
      const cap = captureConsole();
      let bad: number;
      let good: number;
      try {
        bad = await runner.run(["skill", "create-trade-plan", "--trigger", "not-json"]);
        good = await runner.run(["skill", "create-trade-plan", "--trigger", '{"rule":"x"}']);
      } finally {
        cap.restore();
      }
      expect(bad).toBe(1);
      expect(good).toBe(0);
      expect(counter.cliCalls).toHaveLength(1);
    });

    test("an env-injected format flag never reaches the raw command", async () => {
      // A raw-argv command owns its argv: `applyEnvFormat` appends `--json` to
      // the dispatched argv, but the command must receive the tokens the user
      // actually typed — otherwise an env default would arrive as one of its
      // method parameters.
      process.env.DEMO_OUTPUT = "json";
      try {
        const runner = makeRunner();
        const cap = captureConsole();
        try {
          await runner.run(["skill", "create-trade-plan", "--trigger", '{"rule":"x"}']);
        } finally {
          cap.restore();
        }
        expect(counter.cliCalls).toHaveLength(1);
        expect(counter.cliCalls[0]).toEqual([
          "create-trade-plan",
          "--trigger",
          '{"rule":"x"}',
        ]);
      } finally {
        delete process.env.DEMO_OUTPUT;
      }
    });

    test("the CLI's own global flags are stripped, not method params", async () => {
      // `--human` and `--no-cache` are the runner's global flags, not the
      // method's: they must neither fail param validation nor arrive at
      // Counter as method parameters.
      const runner = makeRunner();
      const cap = captureConsole();
      try {
        const code = await runner.run([
          "skill",
          "create-trade-plan",
          "--trigger",
          '{"rule":"x"}',
          "--human",
          "--no-cache",
        ]);
        expect(code).toBe(0);
      } finally {
        cap.restore();
      }
      expect(counter.cliCalls).toHaveLength(1);
      expect(counter.cliCalls[0]).toEqual([
        "create-trade-plan",
        "--trigger",
        '{"rule":"x"}',
      ]);
    });
  });
});
