import { afterEach, beforeEach, describe, test, expect } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
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
    expect("rawArgs" in cmd).toBe(false);
  });

  test("declares its own flags in the standard help schema", () => {
    const schema = createSkillCommand({ methodsDir: "/repo/methods" }).inputSchema;
    expect(schema).toBeInstanceOf(z.ZodObject);
    if (!(schema instanceof z.ZodObject)) return;
    expect(Object.keys(schema.shape)).toEqual(["refs", "reference"]);
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

describe("skill with no method name", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "modality-skill-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

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

  /** A Counter stub that records its calls; enough for the listing path. */
  function fakeCounter() {
    const calls: string[][] = [];
    const options: unknown[] = [];
    const module = {
      getAllCounterItems: async () => [],
      toCounterCLI: (_baseDir: string, opts?: unknown) => async (args: string[]) => {
        calls.push(args);
        options.push(opts);
      },
      toCounterCLIHelp: () => async () => false,
    };
    const mdxModule = {
      readMdxYaml: async () => undefined,
    };
    return {
      module: module as unknown as typeof import("@modality-counter/core"),
      mdxModule: mdxModule as unknown as typeof import("@modality-counter/core/mdx"),
      calls,
      options,
    };
  }

  test("prints the configured skill file, without loading Counter", async () => {
    // Counter is not needed to print a file, and a CLI may ship one without the
    // optional package — so this path must not import it at all.
    const skillPath = join(dir, "SKILL.mdx");
    writeFileSync(skillPath, "# Default skill\n\nRead me first.\n");

    let imported = false;
    const cmd = createSkillCommand({
      cliName: "demo",
      methodsDir: "/repo/methods",
      defaultSkillPath: skillPath,
      importCounter: () => {
        imported = true;
        return Promise.reject(new Error("Counter must not load"));
      },
    });

    const { logs, errs } = await executeCapturing(cmd, []);
    expect(imported).toBe(false);
    expect(errs).toEqual([]);
    expect(logs.join("\n")).toBe("# Default skill\n\nRead me first.");
  });

  test("falls back to the .md sibling when .mdx is absent", async () => {
    writeFileSync(join(dir, "SKILL.md"), "markdown default\n");
    const cmd = createSkillCommand({
      cliName: "demo",
      methodsDir: "/repo/methods",
      defaultSkillPath: join(dir, "SKILL.mdx"),
    });

    const { logs } = await executeCapturing(cmd, []);
    expect(logs.join("\n")).toBe("markdown default");
  });

  test("falls back to the .mdx sibling when the configured .md is absent", async () => {
    // The sibling lookup is symmetric: a CLI pointed at `.md` still runs from
    // a `.mdx`-only checkout.
    writeFileSync(join(dir, "SKILL.mdx"), "markdown default mdx\n");
    const cmd = createSkillCommand({
      cliName: "demo",
      methodsDir: "/repo/methods",
      defaultSkillPath: join(dir, "SKILL.md"),
    });

    const { logs } = await executeCapturing(cmd, []);
    expect(logs.join("\n")).toBe("markdown default mdx");
  });

  test("does not try a sibling for a path without an .md/.mdx extension", async () => {
    // Sibling lookup is only defined for the two skill spellings; a bare name
    // is used exactly as given, so a README that happens to have a `.mdx`
    // cousin is not mistaken for the answer.
    writeFileSync(join(dir, "README.mdx"), "not a skill file\n");
    const cmd = createSkillCommand({
      cliName: "demo",
      methodsDir: "/repo/methods",
      defaultSkillPath: join(dir, "README"),
    });

    const { errs } = await executeCapturing(cmd, []);
    expect(process.exitCode).toBe(1);
    expect(errs.join("\n")).toContain("demo skill: default skill file not found");
    expect(errs.join("\n")).toContain(join(dir, "README"));
  });

  test("reports a missing default skill file", async () => {
    const missing = join(dir, "SKILL.mdx");
    const cmd = createSkillCommand({
      cliName: "demo",
      methodsDir: "/repo/methods",
      defaultSkillPath: missing,
    });

    const { errs } = await executeCapturing(cmd, []);
    expect(process.exitCode).toBe(1);
    expect(errs.join("\n")).toContain("demo skill: default skill file not found");
    expect(errs.join("\n")).toContain(missing);
  });

  test("treats an unreadable default skill file as absent", async () => {
    // A directory at the configured path must report the same plain error, not
    // crash the CLI with an EISDIR stack trace. (An EACCES spelling lands here
    // with it.)
    const { mkdirSync } = await import("node:fs");
    mkdirSync(join(dir, "SKILL.mdx"));
    const cmd = createSkillCommand({
      cliName: "demo",
      methodsDir: "/repo/methods",
      defaultSkillPath: join(dir, "SKILL.mdx"),
    });

    const { errs } = await executeCapturing(cmd, []);
    expect(process.exitCode).toBe(1);
    expect(errs.join("\n")).toContain("demo skill: default skill file not found");
  });

  test("no method delegates to Counter with the name from the default skill file", async () => {
    const counter = fakeCounter();
    const skillPath = join(dir, "SKILL.mdx");
    writeFileSync(
      skillPath,
      '---\nname: "*use-stock"\ndescription: guide\n---\n\n# Skill\n',
    );
    const cmd = createSkillCommand({
      cliName: "demo",
      methodsDir: import.meta.dir,
      defaultSkillPath: skillPath,
      importCounter: async () => counter.module,
      importMdx: async () => counter.mdxModule,
    });

    const { logs, errs } = await executeCapturing(cmd, []);
    expect(logs).toEqual([]);
    expect(errs).toEqual([]);
    expect(counter.calls).toEqual([["use-stock"]]);
  });

  test("without a defaultSkillPath, still lists Counter's methods", async () => {
    // The pre-existing behavior: no method named is Counter's list.
    const counter = fakeCounter();
    const cmd = createSkillCommand({
      cliName: "demo",
      methodsDir: import.meta.dir,
      importCounter: async () => counter.module,
      importMdx: async () => counter.mdxModule,
    });

    const { errs } = await executeCapturing(cmd, []);
    expect(errs).toEqual([]);
    expect(counter.calls).toEqual([[]]);
  });

  test("strips ANSI from Counter's rendered output", async () => {
    const counter = fakeCounter();
    const module = counter.module as unknown as {
      toCounterCLI: () => (args: string[]) => Promise<void>;
    };
    module.toCounterCLI = () => async () => {
      console.log("\x1b[1mheading\x1b[0m");
      process.stdout.write("\x1b[35mbody\x1b[0m");
    };
    const cmd = createSkillCommand({
      cliName: "demo",
      methodsDir: dir,
      importCounter: async () => counter.module,
      importMdx: async () => counter.mdxModule,
    });

    const writes: string[] = [];
    const realWrite = process.stdout.write;
    process.stdout.write = ((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    let logs: string[] = [];
    try {
      ({ logs } = await executeCapturing(cmd, ["a-method"]));
    } finally {
      process.stdout.write = realWrite;
    }
    expect(logs.join("\n")).toBe("heading");
    expect(writes.join("")).toBe("body");
  });

  test("preserves ANSI in Counter's help output", async () => {
    const counter = fakeCounter();
    const module = counter.module as unknown as {
      toCounterCLIHelp: () => (args: string[]) => Promise<boolean>;
    };
    module.toCounterCLIHelp = () => async (args) => {
      console.log(`\x1b[33m${args[0]}\x1b[0m`);
      return true;
    };
    const cmd = createSkillCommand({
      cliName: "demo",
      methodsDir: dir,
      importCounter: async () => counter.module,
      importMdx: async () => counter.mdxModule,
    });

    const { logs } = await executeCapturing(cmd, ["a-method", "--help"]);
    expect(logs).toEqual(["\x1b[33ma-method\x1b[0m"]);
    expect(counter.calls).toEqual([]);
  });

  test("strips ANSI from Counter's stderr output", async () => {
    const counter = fakeCounter();
    const module = counter.module as unknown as {
      toCounterCLI: () => (args: string[]) => Promise<void>;
    };
    module.toCounterCLI = () => async () => {
      console.error("\x1b[31mbad\x1b[0m");
    };
    const cmd = createSkillCommand({
      cliName: "demo",
      methodsDir: dir,
      importCounter: async () => counter.module,
      importMdx: async () => counter.mdxModule,
    });

    const { errs } = await executeCapturing(cmd, ["a-method"]);
    expect(errs).toEqual(["bad"]);
  });

  test("strips ANSI from the default skill file", async () => {
    const skillPath = join(dir, "SKILL.mdx");
    writeFileSync(skillPath, "\x1b[31mred\x1b[0m\n");
    const cmd = createSkillCommand({
      cliName: "demo",
      methodsDir: dir,
      defaultSkillPath: skillPath,
    });

    const { logs } = await executeCapturing(cmd, []);
    expect(logs).toEqual(["red"]);
  });

  test("restores stdout only after overlapping renders finish", async () => {
    const counter = fakeCounter();
    const module = counter.module as unknown as {
      toCounterCLI: () => (args: string[]) => Promise<void>;
    };
    let entered = 0;
    let signalFirst!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      signalFirst = resolve;
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    module.toCounterCLI = () => async () => {
      entered++;
      if (entered === 1) signalFirst();
      await gate;
      console.log("\x1b[1moverlap\x1b[0m");
    };
    const cmd = createSkillCommand({
      cliName: "demo",
      methodsDir: dir,
      importCounter: async () => counter.module,
      importMdx: async () => counter.mdxModule,
    });

    const originalWrite = process.stdout.write;
    const cap = captureConsole();
    try {
      const execute = cmd.execute as (args: string[]) => Promise<void>;
      const first = execute(["a-method"]);
      await firstStarted;
      expect(process.stdout.write).not.toBe(originalWrite);

      const second = execute(["a-method"]);
      for (let i = 0; i < 100 && entered < 2; i++) await Bun.sleep(0);
      expect(entered).toBe(2);
      release();
      await Promise.all([first, second]);

      expect(process.stdout.write).toBe(originalWrite);
      expect(cap.logs).toEqual(["overlap", "overlap"]);
    } finally {
      cap.restore();
    }
  });

  test("without a defaultSkillPath, auto-detects SKILL.mdx next to methodsDir", async () => {
    // A SKILL.mdx with no method name prints raw, without loading Counter.
    const srcDir = join(dir, "src");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, "SKILL.mdx"), "auto-detected mdx\n");

    const counter = fakeCounter();
    const cmd = createSkillCommand({
      cliName: "demo",
      methodsDir: join(dir, "methods"),
      importCounter: async () => counter.module,
      importMdx: async () => counter.mdxModule,
    });

    const { logs, errs } = await executeCapturing(cmd, []);
    expect(errs).toEqual([]);
    expect(logs).toEqual(["auto-detected mdx"]);
    expect(counter.calls).toEqual([]);
  });

  test("auto-detect falls back to SKILL.md when .mdx is absent", async () => {
    const srcDir = join(dir, "src");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, "SKILL.md"), "auto-detected md\n");

    const counter = fakeCounter();
    const cmd = createSkillCommand({
      cliName: "demo",
      methodsDir: join(dir, "methods"),
      importCounter: async () => counter.module,
      importMdx: async () => counter.mdxModule,
    });

    const { logs, errs } = await executeCapturing(cmd, []);
    expect(errs).toEqual([]);
    expect(logs).toEqual(["auto-detected md"]);
    expect(counter.calls).toEqual([]);
  });

  test("auto-detect with no skill file falls through to Counter's list", async () => {
    const counter = fakeCounter();
    const cmd = createSkillCommand({
      cliName: "demo",
      methodsDir: import.meta.dir,
      importCounter: async () => counter.module,
      importMdx: async () => counter.mdxModule,
    });

    const { errs } = await executeCapturing(cmd, []);
    expect(errs).toEqual([]);
    expect(counter.calls).toEqual([[]]);
  });
  test("a named method still reaches Counter when a defaultSkillPath is set", async () => {
    // The default file answers only the no-argument invocation; naming a
    // method must keep the original dispatch.
    const counter = fakeCounter();
    const cmd = createSkillCommand({
      cliName: "demo",
      methodsDir: import.meta.dir,
      defaultSkillPath: join(dir, "SKILL.mdx"),
      importCounter: async () => counter.module,
      importMdx: async () => counter.mdxModule,
    });

    await executeCapturing(cmd, ["create-trade-plan"]);
    expect(counter.calls).toEqual([["create-trade-plan"]]);
  });

  test("a leading flag still lists when a defaultSkillPath is set", async () => {
    // The default file answers only the bare invocation; a flag-first argv
    // keeps Counter's own no-method handling. The missing file is never
    // reached, so no exit code is set either.
    const counter = fakeCounter();
    const cmd = createSkillCommand({
      cliName: "demo",
      methodsDir: import.meta.dir,
      defaultSkillPath: join(dir, "SKILL.mdx"),
      importCounter: async () => counter.module,
      importMdx: async () => counter.mdxModule,
    });

    const { errs } = await executeCapturing(cmd, ["--refs"]);
    expect(errs).toEqual([]);
    expect(counter.calls).toEqual([["--refs"]]);
  });

  test("treats a methods file like a missing directory", async () => {
    // existsSync alone lets a stray file bypass the guard and reach Counter,
    // whose own CLI calls `process.exit(1)` — fatal to embedding hosts.
    const counter = fakeCounter();
    const cmd = createSkillCommand({
      cliName: "demo",
      methodsDir: join(import.meta.dir, "skill.test.ts"),
      importCounter: async () => counter.module,
      importMdx: async () => counter.mdxModule,
    });

    const { errs } = await executeCapturing(cmd, ["create-trade-plan"]);
    expect(process.exitCode).toBe(1);
    expect(errs.join("\n")).toContain("demo skill: methods directory not found");
    expect(counter.calls).toEqual([]);
  });

  test("its usage line advertises which no-argument behavior is in effect", () => {
    const listing = createSkillCommand({ cliName: "demo", methodsDir: "/repo/methods" });
    const printing = createSkillCommand({
      cliName: "demo",
      methodsDir: "/repo/methods",
      defaultSkillPath: "/repo/SKILL.mdx",
    });
    expect(listing.usage?.join("\n")).toContain(
      "(print the default method's skill, or list available methods)",
    );
    expect(printing.usage?.join("\n")).toContain("(print the default method's skill)");
    // Only a file without a method name answers with the file itself.
    expect(printing.usage?.join("\n")).not.toContain("(list available methods)");
  });
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

  test("defaultCommandsFor forwards the default skill path to the command", () => {
    const registry = createCommandRegistry([alpha]);
    const skill = defaultCommandsFor(
      "demo",
      registry,
      undefined,
      "/repo/methods",
      "/repo/SKILL.mdx",
    ).find((cmd) => cmd.name === "skill");
    expect(skill?.usage?.join("\n")).toContain("(print the default method's skill)");
  });

  test("the runner registers the configured default skill path", () => {
    const help = makeRunner({
      methodsDir: "/repo/methods",
      defaultSkillPath: "/repo/SKILL.mdx",
    }).getHelp("skill");
    expect(help).toContain("(print the default method's skill)");
  });

  test("registers once methodsDir is supplied", () => {
    const help = makeRunner({ methodsDir: "/repo/methods" }).getHelp();
    expect(help).toContain("skill");
    expect(help).toContain("Print skill text for a Counter method");
  });

  test("its help names the consuming CLI", () => {
    expect(makeRunner({ methodsDir: "/repo/methods" }).getHelp("skill")).toContain(
      "demo skill create-trade-plan",
    );
  });

  test("its help lists its own flags under Options", () => {
    const help = makeRunner({ methodsDir: "/repo/methods" }).getHelp("skill");
    const optionsStart = help.indexOf("Options:");
    expect(optionsStart).toBeGreaterThan(-1);
    const options = help.slice(optionsStart);
    expect(options).toContain("--refs");
    expect(options).toContain("--reference");
  });

  test("withoutDefaultCommand drops it even with a methodsDir", () => {
    const help = makeRunner({
      methodsDir: "/repo/methods",
      withoutDefaultCommand: ["skill"],
    }).getHelp();
    // `skills` shares the "skill" prefix, so assert on the dropped command's
    // description rather than the substring both names contain.
    expect(help).not.toContain("Print raw skill text");
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
    expect(cap.logs.join("\n")).toContain("Print skill text for a Counter method");
  });

});
