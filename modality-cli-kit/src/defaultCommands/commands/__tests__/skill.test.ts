import { afterEach, describe, test, expect } from "bun:test";
import { createSkillCommand } from "../skill";
import { defaultCommandsFor } from "../..";
import { takesRawArgv } from "../../internal";
import { createCliRunner } from "../../../createCliRunner";
import { createCommandRegistry } from "../../../registry";
import { setNoColor } from "../../../help/colors";
import type { CLICommand } from "../../../help/types";

// The method resolution and skill-text rendering belong to
// `@modality-counter/core`; these tests cover what this file owns — the command
// surface, the raw-args contract, and registration via `methodsDir`.

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
// tests or the first failure would leak into every later assertion. Bun
// ignores `process.exitCode = undefined` (and `delete` throws), so restore
// through a numeric value — 0 keeps the bun-test process itself from exiting
// non-zero on a suite that otherwise passes.
const realExitCode = process.exitCode;
afterEach(() => {
  process.exitCode = realExitCode ?? 0;
});

describe("createSkillCommand", () => {
  test("defaults name and cliName", () => {
    const cmd = createSkillCommand({ methodsDir: "/repo/methods" });
    expect(cmd.name).toBe("skill");
    expect(cmd.examples?.[0]).toBe("<cli> skill create-trade-plan");
  });

  test("honors a custom name and cliName", () => {
    const cmd = createSkillCommand({ name: "method", cliName: "mycli", methodsDir: "/repo/methods" });
    expect(cmd.name).toBe("method");
    expect(cmd.examples).toEqual(["mycli method create-trade-plan", "mycli method <method> --help"]);
  });

  test("holds the raw-argv lock, which is not a field on the command", () => {
    // The runner would otherwise reject the method name as an unknown argument.
    // The grant lives in a module-private WeakSet (see `internal.test.ts`), so
    // there is nothing on the object for a consuming CLI to copy or declare.
    const cmd = createSkillCommand({ methodsDir: "/repo/methods" });
    expect(takesRawArgv(cmd)).toBe(true);
    expect(cmd.inputSchema).toBeUndefined();
    expect("rawArgs" in cmd).toBe(false);
  });

  test("documents the flags it accepts on top of a method's parameters", () => {
    // --refs and --reference are the command's own; they must be visible in
    // help, since they will not appear in any method's parameter list.
    const usage = createSkillCommand({ cliName: "demo", methodsDir: "/repo/methods" }).usage ?? [];
    expect(usage.join("\n")).toContain("--refs");
    expect(usage.join("\n")).toContain("--help");
  });

  // The not-installed behaviors (missing-package error, --help forwarding
  // reaching the command) live in `skill-validation.test.ts`, which owns the
  // module's import state.
});

describe("skill registration", () => {
  test("is absent when the CLI supplies no methodsDir", () => {
    expect(makeRunner().getHelp()).not.toContain("skill");
  });

  test("defaultCommandsFor adds it only when a methodsDir comes with it", () => {
    // The factory declines (returns undefined) without one, rather than
    // handing back a command with nowhere to read methods from.
    const registry = createCommandRegistry([alpha]);
    const namesFor = (methodsDir?: string) =>
      defaultCommandsFor("demo", registry, undefined, methodsDir).map((cmd) => cmd.name);

    expect(namesFor()).not.toContain("skill");
    expect(namesFor("/repo/methods")).toContain("skill");
  });

  test("registers once methodsDir is supplied", () => {
    const help = makeRunner({ methodsDir: "/repo/methods" }).getHelp();
    expect(help).toContain("skill");
    expect(help).toContain("Print raw skill text for a Counter method");
  });

  test("its help names the consuming CLI", () => {
    expect(makeRunner({ methodsDir: "/repo/methods" }).getHelp("skill")).toContain(
      "demo skill create-trade-plan",
    );
  });

  test("withoutDefaultCommand drops it even with a methodsDir", () => {
    const help = makeRunner({
      methodsDir: "/repo/methods",
      withoutDefaultCommand: ["skill"],
    }).getHelp();
    expect(help).not.toContain("skill");
    // The CLI's own commands are untouched by the opt-out.
    expect(help).toContain("alpha");
  });

  test("a leading --help is the runner's, not the command's", async () => {
    const cap = captureConsole();
    let code: number;
    try {
      code = await makeRunner({ methodsDir: "/repo/methods" }).run(["skill", "--help"]);
    } finally {
      cap.restore();
    }
    expect(code).toBe(0);
    expect(cap.logs.join("\n")).toContain("Print raw skill text for a Counter method");
  });

});
