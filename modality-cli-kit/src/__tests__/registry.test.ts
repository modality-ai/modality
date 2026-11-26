import { describe, test, expect } from "bun:test";
import { z } from "zod";
import { createCommandRegistry } from "../lib/registry";
import type { CLICommand } from "../help/types";

// Minimal real commands — each records the args it was executed with.
// Both one-liner fields are set, so the registry's summary/description
// backfill is a no-op and the command's identity is preserved.
const makeCmd = (name: string | undefined, ret: unknown = { success: true }): CLICommand =>
  ({
    name,
    summary: `${name} command`,
    description: `${name} command`,
    inputSchema: undefined,
    execute: async (args: unknown) => (ret === "echo" ? args : ret),
  }) as unknown as CLICommand;

describe("createCommandRegistry", () => {
  test("resolves a command by its canonical name", () => {
    const foo = makeCmd("foo");
    const registry = createCommandRegistry([foo]);
    expect(registry.get("foo")).toBe(foo);
  });

  test("resolves a command by any of its aliases", () => {
    const bar = makeCmd("bar");
    const registry = createCommandRegistry([bar], { bar: ["b", "baz"] });
    expect(registry.get("b")).toBe(bar);
    expect(registry.get("baz")).toBe(bar);
  });

  test("returns undefined for an unknown name", () => {
    const registry = createCommandRegistry([makeCmd("foo")]);
    expect(registry.get("nope")).toBeUndefined();
  });

  test("skips commands that have no name without breaking others", () => {
    const foo = makeCmd("foo");
    const nameless = makeCmd(undefined);
    const registry = createCommandRegistry([nameless, foo]);
    expect(registry.get("foo")).toBe(foo);
    // The nameless command is unreachable via get() but must not throw.
    expect(registry.get("")).toBeUndefined();
  });

  test("exposes all commands in declaration order", () => {
    const a = makeCmd("a");
    const b = makeCmd("b");
    const registry = createCommandRegistry([a, b]);
    expect(registry.all).toEqual([a, b]);
  });

  test("all excludes nameless commands so it matches what is registered", () => {
    const a = makeCmd("a");
    const nameless = makeCmd(undefined);
    const b = makeCmd("b");
    const registry = createCommandRegistry([a, nameless, b]);
    expect(registry.all).toEqual([a, b]);
  });

  test("exposes the supplied alias map, defaulting to empty", () => {
    expect(createCommandRegistry([makeCmd("a")]).aliases).toEqual({});
    const aliases = { a: ["x"] };
    expect(createCommandRegistry([makeCmd("a")], aliases).aliases).toBe(aliases);
  });

  // ── aliases declared on the command object ──────────────────────────────

  const withAliases = (name: string, aliases: string[]): CLICommand =>
    ({ ...makeCmd(name), aliases }) as CLICommand;

  test("a command's own aliases resolve when no map is supplied", () => {
    const foo = withAliases("foo", ["f", "fo"]);
    const registry = createCommandRegistry([foo]);
    expect(registry.get("f")!.name).toBe("foo");
    expect(registry.get("fo")!.name).toBe("foo");
    expect(registry.aliases.foo).toEqual(["f", "fo"]);
  });

  test("the supplied map overrides a command's own aliases", () => {
    const foo = withAliases("foo", ["f"]);
    const registry = createCommandRegistry([foo], { foo: ["eff"] });
    expect(registry.get("eff")!.name).toBe("foo");
    expect(registry.get("f")).toBeUndefined();
    expect(registry.aliases.foo).toEqual(["eff"]);
  });

  test("an empty map entry deliberately removes a command's own aliases", () => {
    const registry = createCommandRegistry([withAliases("foo", ["f"])], { foo: [] });
    expect(registry.get("f")).toBeUndefined();
    expect(registry.aliases.foo).toEqual([]);
  });

  test("mapped and self-declared aliases coexist across commands", () => {
    const registry = createCommandRegistry(
      [withAliases("foo", ["f"]), withAliases("bar", ["b"])],
      { foo: ["eff"] },
    );
    expect(registry.get("eff")!.name).toBe("foo");
    expect(registry.get("b")!.name).toBe("bar");
  });

  test("the supplied map is left untouched when commands contribute aliases", () => {
    const supplied = { foo: ["eff"] };
    const registry = createCommandRegistry(
      [withAliases("foo", ["f"]), withAliases("bar", ["b"])],
      supplied,
    );
    expect(supplied).toEqual({ foo: ["eff"] });
    expect(registry.aliases.bar).toEqual(["b"]);
  });

  test("a command with an empty aliases array contributes nothing", () => {
    const registry = createCommandRegistry([withAliases("foo", [])]);
    expect(registry.aliases).toEqual({});
  });

  test("execute() resolves and runs the command, forwarding args", async () => {
    const echo = makeCmd("echo", "echo");
    const registry = createCommandRegistry([echo]);
    expect(await registry.execute("echo", { target: "x" })).toEqual({ target: "x" });
  });

  test("execute() resolves via alias too", async () => {
    const echo = makeCmd("echo", "echo");
    const registry = createCommandRegistry([echo], { echo: ["e"] });
    expect(await registry.execute("e", { v: 1 })).toEqual({ v: 1 });
  });

  test("execute() returns a failure envelope for an unknown command", async () => {
    const registry = createCommandRegistry([makeCmd("foo")]);
    expect(await registry.execute("ghost", {})).toEqual({
      success: false,
      error: "Unknown command: ghost",
    });
  });

  // ── summary/description backfill ────────────────────────────────────────

  const oneLiner = (fields: Partial<CLICommand>): CLICommand =>
    ({ name: "x", inputSchema: undefined, execute: async () => ({}), ...fields }) as unknown as CLICommand;

  test("backfills summary from description when summary is absent", () => {
    const registry = createCommandRegistry([oneLiner({ description: "does x" })]);
    const got = registry.get("x")!;
    expect(got.summary).toBe("does x");
    expect(got.description).toBe("does x");
  });

  test("backfills description from summary when description is absent", () => {
    const registry = createCommandRegistry([oneLiner({ summary: "does x" })]);
    const got = registry.get("x")!;
    expect(got.description).toBe("does x");
    expect(got.summary).toBe("does x");
  });

  test("leaves a command that already sets both fields untouched (identity preserved)", () => {
    const cmd = makeCmd("z");
    const registry = createCommandRegistry([cmd]);
    expect(registry.get("z")).toBe(cmd);
    expect(registry.all[0]).toBe(cmd);
  });

  test("when both summary and description are absent, both remain undefined and identity is preserved", () => {
    const cmd = oneLiner({});
    const registry = createCommandRegistry([cmd]);
    const got = registry.get("x")!;
    expect(got.summary).toBeUndefined();
    expect(got.description).toBeUndefined();
    expect(got).toBe(cmd);
  });

  test("backfilled commands resolve correctly via aliases", () => {
    const cmd = oneLiner({ description: "does x" });
    const registry = createCommandRegistry([cmd], { x: ["xi"] });
    const got = registry.get("xi")!;
    expect(got).toBe(registry.get("x")!);
    expect(got.summary).toBe("does x");
  });

  test("nameless commands with undefined fields are filtered without error", () => {
    const nameless = oneLiner({ name: undefined, summary: undefined, description: undefined });
    const registry = createCommandRegistry([nameless]);
    expect(registry.all).toEqual([]);
  });

  // ── Regression / edge-case coverage ─────────────────────────────────────

  test("empty commands array produces an empty registry", () => {
    const registry = createCommandRegistry([]);
    expect(registry.all).toEqual([]);
    expect(registry.get("anything")).toBeUndefined();
  });

  test("multiple aliases for different commands resolve independently", () => {
    const a = makeCmd("alpha");
    const b = makeCmd("beta");
    const registry = createCommandRegistry([a, b], {
      alpha: ["a1", "a2"],
      beta: ["b1"],
    });
    expect(registry.get("a1")).toBe(a);
    expect(registry.get("a2")).toBe(a);
    expect(registry.get("b1")).toBe(b);
    expect(registry.get("b2")).toBeUndefined();
  });

  test("duplicate command names keep the last one registered", () => {
    const first = makeCmd("dup", { success: true, version: 1 });
    const second = makeCmd("dup", { success: true, version: 2 });
    const registry = createCommandRegistry([first, second]);
    // Last one wins in the map
    expect(registry.get("dup")).toBe(second);
  });

  test("execute() on empty registry returns failure envelope", async () => {
    const registry = createCommandRegistry([]);
    expect(await registry.execute("anything", {})).toEqual({
      success: false,
      error: "Unknown command: anything",
    });
  });

  test("execute() passes args object directly to the command", async () => {
    const echo = makeCmd("echo", "echo");
    const registry = createCommandRegistry([echo]);
    const args = { deep: { nested: true }, list: [1, 2, 3] };
    expect(await registry.execute("echo", args)).toEqual(args);
  });
});

describe("createCommandRegistry.resolve", () => {
  test("an exact name resolves without the prefix option", () => {
    const signals = makeCmd("signals");
    const registry = createCommandRegistry([signals]);
    expect(registry.resolve("signals")).toEqual({ found: true, name: "signals", command: signals });
  });

  test("an exact alias resolves to the canonical command", () => {
    const foo = makeCmd("foo");
    const registry = createCommandRegistry([foo], { foo: ["f"] });
    const r = registry.resolve("f");
    expect(r).toEqual({ found: true, name: "foo", command: foo });
  });

  test("a prefix is unknown unless prefix matching is enabled", () => {
    const registry = createCommandRegistry([makeCmd("signals")]);
    expect(registry.resolve("sig")).toEqual({ found: false, reason: "unknown", candidates: [] });
  });

  test("a unique prefix resolves with { prefix: true }", () => {
    const signals = makeCmd("signals");
    const registry = createCommandRegistry([signals, makeCmd("boom")]);
    expect(registry.resolve("sig", { prefix: true })).toEqual({ found: true, name: "signals", command: signals });
  });

  test("an ambiguous prefix reports the candidate names", () => {
    const registry = createCommandRegistry([makeCmd("start"), makeCmd("stop")]);
    const r = registry.resolve("st", { prefix: true });
    expect(r.found).toBe(false);
    if (!r.found) {
      expect(r.reason).toBe("ambiguous");
      expect(r.candidates.sort()).toEqual(["start", "stop"]);
    }
  });

  test("an exact match wins even when it is also a prefix of others", () => {
    const stop = makeCmd("stop");
    const registry = createCommandRegistry([stop, makeCmd("stopwatch")], {});
    expect(registry.resolve("stop", { prefix: true })).toEqual({ found: true, name: "stop", command: stop });
  });

  test("a name and its own alias sharing the prefix is one command, not ambiguous", () => {
    const foobar = makeCmd("foobar");
    const registry = createCommandRegistry([foobar], { foobar: ["foobaz"] });
    expect(registry.resolve("foo", { prefix: true })).toEqual({ found: true, name: "foobar", command: foobar });
  });

  test("a prefix that matches nothing is unknown", () => {
    const registry = createCommandRegistry([makeCmd("signals")]);
    expect(registry.resolve("zzz", { prefix: true })).toEqual({ found: false, reason: "unknown", candidates: [] });
  });

  test("resolve() on an empty registry returns unknown for any input", () => {
    const registry = createCommandRegistry([]);
    expect(registry.resolve("anything")).toEqual({ found: false, reason: "unknown", candidates: [] });
  });

  test("the CommandResolution type shape is a discriminated union on `found`", () => {
    const registry = createCommandRegistry([makeCmd("ok")], { ok: ["k"] });
    const success = registry.resolve("ok");
    const fail = registry.resolve("missing");
    // TypeScript already enforces the union; runtime checks guard against future drift.
    expect(success.found).toBe(true);
    if (success.found) {
      expect(typeof success.name).toBe("string");
      expect(typeof success.command.execute).toBe("function");
    }
    expect(fail.found).toBe(false);
    if (!fail.found) {
      expect(["unknown", "ambiguous"]).toContain(fail.reason);
      expect(Array.isArray(fail.candidates)).toBe(true);
    }
  });
});
