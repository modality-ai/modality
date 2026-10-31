import { afterEach, describe, test, expect } from "bun:test";
import { join } from "node:path";
import { createSkillsCommand } from "../skills";
import { defaultCommandsFor } from "../..";
import { takesRawArgv } from "../../internal";
import { createCliRunner } from "../../../createCliRunner";
import { createCommandRegistry } from "../../../registry";
import { setNoColor } from "../../../help/colors";
import type { CLICommand } from "../../../help/types";

// `skills` delegates the list and the per-method text to
// `@modality-counter/core`; these tests cover what this file owns — the command
// surface, the raw-argv contract, and registration via `methodsDir`. Counter
// itself is stubbed through the `importCounter` seam, so the optional package is
// neither mocked nor imported.

// Deterministic help strings.
setNoColor(true);

const alpha = {
  name: "alpha",
  description: "First command",
  execute: async () => ({ success: true }),
} as unknown as CLICommand;

const makeRunner = (options?: Partial<Parameters<typeof createCliRunner>[0]>) =>
  createCliRunner({
    cliName: "demo",
    tagline: "Demo CLI",
    registry: createCommandRegistry([alpha]),
    envFile: false,
    ...options,
  });

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
// tests. Bun ignores `process.exitCode = undefined`, so restore through a
// numeric value.
const realExitCode = process.exitCode;
afterEach(() => {
  process.exitCode = realExitCode ?? 0;
});

/** A Counter stub that records the argv and options it was handed. */
function fakeCounter() {
  const calls: string[][] = [];
  const options: unknown[] = [];
  const module = {
    getAllCounterItems: async () => [],
    readMdxYaml: async () => undefined,
    toCounterCLI: (_baseDir: string, opts?: unknown) => async (args: string[]) => {
      calls.push(args);
      options.push(opts);
    },
    toCounterCLIHelp: () => async () => false,
  };
  return { module: module as unknown as typeof import("@modality-counter/core"), calls, options };
}

/** Run `execute` while capturing console output; returns what it printed. */
async function executeCapturing(cmd: CLICommand, args: string[]) {
  const cap = captureConsole();
  try {
    await (cmd.execute as (args: string[]) => Promise<unknown>)(args);
  } finally {
    cap.restore();
  }
  return { logs: cap.logs, errs: cap.errs };
}

describe("createSkillsCommand", () => {
  test("defaults name and cliName", () => {
    const cmd = createSkillsCommand({ methodsDir: "/repo/methods" });
    expect(cmd.name).toBe("skills");
    expect(cmd.description).toBe("List the skills (Counter methods) available to this CLI");
    expect(cmd.examples).toEqual(["<cli> skills", "<cli> skills create-trade-plan"]);
  });

  test("honors a custom name and cliName", () => {
    const cmd = createSkillsCommand({ name: "list", cliName: "mycli", methodsDir: "/repo/methods" });
    expect(cmd.name).toBe("list");
    expect(cmd.examples).toEqual(["mycli list", "mycli list create-trade-plan"]);
  });

  test("holds the raw-argv lock, which is not a field on the command", () => {
    // Counter's list takes no schema, and a named method carries its own flags;
    // the runner would otherwise reject either as unknown arguments.
    const cmd = createSkillsCommand({ methodsDir: "/repo/methods" });
    expect(takesRawArgv(cmd)).toBe(true);
    expect(cmd.inputSchema).toBeUndefined();
    expect("rawArgs" in cmd).toBe(false);
  });

  test("lists by handing Counter an empty argv and the bare command name", async () => {
    const counter = fakeCounter();
    const cmd = createSkillsCommand({
      cliName: "demo",
      methodsDir: import.meta.dir,
      importCounter: async () => counter.module,
    });

    const { errs } = await executeCapturing(cmd, []);
    expect(errs).toEqual([]);
    expect(counter.calls).toEqual([[]]);
    // `command` must be the bare registered name, not a display string.
    expect(counter.options).toEqual([{ cliName: "demo", command: "skills" }]);
  });

  test("forwards a named method unchanged", async () => {
    const counter = fakeCounter();
    const cmd = createSkillsCommand({
      cliName: "demo",
      methodsDir: import.meta.dir,
      importCounter: async () => counter.module,
    });

    await executeCapturing(cmd, ["create-trade-plan", "--refs"]);
    expect(counter.calls).toEqual([["create-trade-plan", "--refs"]]);
  });

  test("reports the missing optional package instead of throwing", async () => {
    const cmd = createSkillsCommand({
      cliName: "demo",
      methodsDir: "/repo/methods",
      importCounter: () => Promise.reject(new Error("Cannot find package")),
    });

    const { errs } = await executeCapturing(cmd, []);
    expect(process.exitCode).toBe(1);
    expect(errs.join("\n")).toContain("@modality-counter/core");
  });

  test("reports a missing methods directory instead of letting Counter exit", async () => {
    const counter = fakeCounter();
    const cmd = createSkillsCommand({
      cliName: "demo",
      methodsDir: "/repo/methods",
      importCounter: async () => counter.module,
    });

    const { errs } = await executeCapturing(cmd, []);
    expect(process.exitCode).toBe(1);
    expect(errs.join("\n")).toContain("demo skills: methods directory not found");
    expect(counter.calls).toEqual([]);
  });

  test("treats a methods file like a missing directory", async () => {
    // existsSync alone lets a stray file bypass the guard and reach Counter,
    // whose own CLI calls `process.exit(1)` — fatal to embedding hosts.
    const counter = fakeCounter();
    const cmd = createSkillsCommand({
      cliName: "demo",
      methodsDir: join(import.meta.dir, "skills.test.ts"),
      importCounter: async () => counter.module,
    });

    const { errs } = await executeCapturing(cmd, []);
    expect(process.exitCode).toBe(1);
    expect(errs.join("\n")).toContain("demo skills: methods directory not found");
    expect(counter.calls).toEqual([]);
  });
});

describe("skills registration", () => {
  test("is absent when the CLI supplies no methodsDir", () => {
    expect(makeRunner().getHelp()).not.toContain("skills");
  });

  test("defaultCommandsFor adds it only when a methodsDir comes with it", () => {
    const registry = createCommandRegistry([alpha]);
    const namesFor = (methodsDir?: string) =>
      defaultCommandsFor("demo", registry, undefined, methodsDir).map((cmd) => cmd.name);

    expect(namesFor()).not.toContain("skills");
    expect(namesFor("/repo/methods")).toContain("skills");
  });

  test("registers once methodsDir is supplied", () => {
    const help = makeRunner({ methodsDir: "/repo/methods" }).getHelp();
    expect(help).toContain("skills");
    expect(help).toContain("List the skills (Counter methods) available to this CLI");
  });

  test("its help names the consuming CLI", () => {
    expect(makeRunner({ methodsDir: "/repo/methods" }).getHelp("skills")).toContain("demo skills");
  });

  test("withoutDefaultCommand drops it even with a methodsDir", () => {
    const help = makeRunner({
      methodsDir: "/repo/methods",
      withoutDefaultCommand: ["skills"],
    }).getHelp();
    expect(help).not.toContain("skills");
    // The CLI's own commands are untouched by the opt-out.
    expect(help).toContain("alpha");
  });
});
