import { afterEach, describe, test, expect } from "bun:test";
import { z } from "zod";
import { createMergeCommand } from "../merge";
import { defaultCommandsFor } from "../..";
import { createCliRunner } from "../../../createCliRunner";
import { createCommandRegistry } from "../../../registry";
import { setNoColor } from "../../../help/colors";
import type { CLICommand } from "../../../help/types";

// The parsing this command delegates to is covered in
// `../../lib/__tests__/jsonDocs.test.ts`; these tests cover the command surface
// — option defaults and stdin handling — plus how the runner registers it.
//
// `merge` is the default that needs nothing from the consuming CLI, so it is
// also the vehicle for the generic registration rules (opting out, shadowing,
// aiTool bypass). The methodsDir-gated variant of those lives in `skill.test.ts`.

// Deterministic help strings.
setNoColor(true);

// The merge command reads process.stdin, so swap in a stub async iterable.
function stubStdin(chunks: string[], isTTY = false) {
  async function* generate() {
    for (const chunk of chunks) yield Buffer.from(chunk);
  }
  Object.defineProperty(process, "stdin", {
    value: { isTTY, [Symbol.asyncIterator]: generate },
    configurable: true,
  });
}

const realStdin = process.stdin;
afterEach(() => {
  Object.defineProperty(process, "stdin", { value: realStdin, configurable: true });
  // The runner reads its output format from the environment; an ambient
  // `OUTPUT` in the developer's shell would turn the routing assertions below
  // into JSON-format assertions.
  delete process.env.OUTPUT;
  delete process.env.DEMO_OUTPUT;
});

const alpha = {
  name: "alpha",
  description: "First command",
  inputSchema: z.object({}),
  execute: async () => ({ success: true, result: { a: 1 } }),
} as unknown as CLICommand;

const beta = {
  name: "beta",
  description: "Second command",
  inputSchema: z.object({}),
  execute: async () => ({ success: true, result: { b: 2 } }),
} as unknown as CLICommand;

const makeRunner = (options?: Partial<Parameters<typeof createCliRunner>[0]>) =>
  createCliRunner({
    cliName: "demo",
    tagline: "Demo CLI",
    registry: createCommandRegistry([alpha, beta]),
    envFile: false,
    ...options,
  });

describe("createMergeCommand", () => {
  test("defaults name, cliName and example commands", () => {
    const cmd = createMergeCommand();
    expect(cmd.name).toBe("merge");
    expect(cmd.usage?.[0]).toContain("{ <cli> alpha --json && <cli> beta --json; } | <cli> merge");
  });

  test("honors custom name, cliName and example commands", () => {
    const cmd = createMergeCommand({
      name: "fold",
      cliName: "mycli",
      exampleCommands: ["foo", "bar"],
    });
    expect(cmd.name).toBe("fold");
    expect(cmd.usage?.[0]).toContain("{ mycli foo --json && mycli bar --json; } | mycli fold");
  });

  test("fails fast on an interactive stdin with the usage hint", async () => {
    stubStdin([], true);
    const result = await createMergeCommand().execute({});
    expect(result).toEqual({
      success: false,
      error: expect.stringContaining("reads JSON on stdin"),
    });
  });

  test("fails with a hint when stdin is empty", async () => {
    stubStdin([]);
    const result = await createMergeCommand().execute({});
    expect(result).toEqual({
      success: false,
      error: expect.stringContaining("No input on stdin"),
    });
  });

  test("merges documents from stdin", async () => {
    stubStdin(['{"success":true,"result":{"a":1}}{"b":2}']);
    const result = await createMergeCommand().execute({});
    expect(result).toEqual({ success: true, result: [{ a: 1 }, { b: 2 }] });
  });

  test("concatenates stdin chunks before parsing", async () => {
    // readStdin joins every chunk — a regression that returned only the first
    // (or last) chunk would silently drop the other document.
    stubStdin(['{"a":1}', '{"b":2}']);
    const result = await createMergeCommand().execute({});
    expect(result).toEqual({ success: true, result: [{ a: 1 }, { b: 2 }] });
  });

  test("honors the flat flag", async () => {
    stubStdin(['{"a":1}{"a":2}']);
    const result = await createMergeCommand().execute({ flat: true });
    expect(result).toEqual({ success: true, result: { a: 2 } });
  });

  test("fails when stdin contains no JSON documents", async () => {
    stubStdin(["nothing here"]);
    const result = await createMergeCommand().execute({});
    expect(result).toEqual({
      success: false,
      error: expect.stringContaining("found no JSON documents"),
    });
  });
});

describe("merge registration", () => {
  test("is registered without the CLI declaring it", () => {
    expect(makeRunner().getHelp()).toContain("merge");
  });

  test("its help uses the CLI's own command names in examples", () => {
    const help = makeRunner().getHelp("merge");
    expect(help).toContain("demo alpha --json && demo beta --json");
    // The brace form is the only one that pipes both commands into the sink.
    expect(help).toContain("{ demo alpha");
  });

  test("withoutDefaultCommand: true registers none", () => {
    expect(makeRunner({ withoutDefaultCommand: true }).getHelp()).not.toContain("merge");
  });

  test('withoutDefaultCommand: ["merge"] drops just that one', () => {
    const help = makeRunner({ withoutDefaultCommand: ["merge"] }).getHelp();
    expect(help).not.toContain("merge");
    expect(help).toContain("alpha");
  });

  test("a CLI's own command of the same name wins over the default", () => {
    const ownMerge = {
      name: "merge",
      description: "Custom merge",
      inputSchema: z.object({}),
      execute: async () => ({ success: true, message: "mine" }),
    } as unknown as CLICommand;

    const runner = createCliRunner({
      cliName: "demo",
      tagline: "Demo CLI",
      registry: createCommandRegistry([alpha, ownMerge]),
    });
    expect(runner.getHelp()).toContain("Custom merge");
  });

  test("a default command bypasses the aiTool, which has no case for it", async () => {
    const seen: unknown[] = [];
    const runner = makeRunner({
      // An aiTool that would reject anything the consuming package didn't declare.
      aiTool: {
        execute: async (args: unknown) => {
          seen.push(args);
          return { success: false, error: "aiTool should not see default commands" };
        },
      } as never,
    });

    // Pose as a TTY so the sink returns its usage hint instead of blocking on
    // stdin; swallow that hint so it doesn't pollute the test output.
    stubStdin([], true);
    const origErr = console.error;
    console.error = () => {};
    try {
      await runner.run(["merge"]);
      expect(seen).toEqual([]);
    } finally {
      console.error = origErr;
    }
  });

  test("non-default commands still route through the aiTool", async () => {
    const seen: unknown[] = [];
    const runner = makeRunner({
      aiTool: {
        execute: async (args: unknown) => {
          seen.push(args);
          return { success: true };
        },
      } as never,
    });

    await runner.run(["alpha"]);
    expect(seen).toEqual([{ command: "alpha" }]);
  });
});

describe("defaultCommandsFor", () => {
  test("registers merge when nothing is disabled", () => {
    const commands = defaultCommandsFor("demo", createCommandRegistry([alpha, beta]), undefined);
    expect(commands.map((cmd) => cmd.name)).toEqual(["merge"]);
  });

  test("returns none when disabled is true", () => {
    expect(defaultCommandsFor("demo", createCommandRegistry([alpha, beta]), true)).toEqual([]);
  });

  test("drops the named default when disabled lists it", () => {
    expect(defaultCommandsFor("demo", createCommandRegistry([alpha, beta]), ["merge"])).toEqual([]);
  });

  test("skips a default the CLI already defines under the same name", () => {
    const ownMerge = {
      name: "merge",
      description: "Custom merge",
      inputSchema: z.object({}),
      execute: async () => ({ success: true }),
    } as unknown as CLICommand;

    expect(defaultCommandsFor("demo", createCommandRegistry([ownMerge]), undefined)).toEqual([]);
  });

  test("tailors the merge usage to the CLI name and its command names", () => {
    const [merge] = defaultCommandsFor("demo", createCommandRegistry([alpha, beta]), undefined);
    expect(merge?.usage?.[0]).toContain("{ demo alpha --json && demo beta --json; }");
  });

  test("falls back to alpha/beta when the registry has no commands", () => {
    const [merge] = defaultCommandsFor("demo", createCommandRegistry([]), undefined);
    expect(merge?.usage?.[0]).toContain("{ demo alpha --json && demo beta --json; }");
  });

  test("pairs a single command with the beta fallback", () => {
    const [merge] = defaultCommandsFor("demo", createCommandRegistry([alpha]), undefined);
    expect(merge?.usage?.[0]).toContain("{ demo alpha --json && demo beta --json; }");
  });

  test("an alias under the default's name also suppresses it", () => {
    // `get` resolves aliases too, so a CLI whose alias "merge" points at its own
    // command shadows the default without needing withoutDefaultCommand.
    const registry = createCommandRegistry([alpha, beta], { alpha: ["merge"] });
    expect(defaultCommandsFor("demo", registry, undefined)).toEqual([]);
  });
});
