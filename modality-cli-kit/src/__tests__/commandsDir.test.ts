import { describe, test, expect, spyOn, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCommandsFromDir, createCommandRegistryFromDir, resolveCommandsDir } from "../lib/commandsDir";

const FIXTURES = new URL("./fixtures/scanCommands", import.meta.url);

/**
 * Invalid files are reported on stderr, so every test that trips one silences
 * the warning to keep the suite output readable — and asserts on it where the
 * warning *is* the behavior under test.
 */
const silenceWarnings = () => spyOn(console, "error").mockImplementation(() => {});

afterEach(() => {
  spyOn(console, "error").mockRestore();
});

describe("loadCommandsFromDir", () => {
  test("loads every well-formed command module in the directory", async () => {
    const warn = silenceWarnings();
    const commands = await loadCommandsFromDir(FIXTURES);
    warn.mockRestore();
    expect(commands.map((c) => c.name)).toEqual(["alpha", "beta"]);
  });

  test("accepts an absolute path as well as a URL", async () => {
    const warn = silenceWarnings();
    const fromPath = await loadCommandsFromDir(new URL(FIXTURES).pathname);
    warn.mockRestore();
    expect(fromPath.map((c) => c.name)).toEqual(["alpha", "beta"]);
  });

  test("returns commands sorted by filename so help output is deterministic", async () => {
    const warn = silenceWarnings();
    const first = await loadCommandsFromDir(FIXTURES);
    const second = await loadCommandsFromDir(FIXTURES);
    warn.mockRestore();
    expect(first.map((c) => c.name)).toEqual(second.map((c) => c.name));
  });

  test("orders commands by filename, independent of filesystem order", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cli-kit-sort-"));
    writeFileSync(
      join(dir, "zebra.ts"),
      "export const zebraCommand = { name: 'zebra', summary: 'z', execute: async () => ({}) };",
    );
    writeFileSync(
      join(dir, "alpha.ts"),
      "export const alphaCommand = { name: 'alpha', summary: 'a', execute: async () => ({}) };",
    );
    writeFileSync(
      join(dir, "mike.ts"),
      "export const mikeCommand = { name: 'mike', summary: 'm', execute: async () => ({}) };",
    );

    const commands = await loadCommandsFromDir(dir);
    rmSync(dir, { recursive: true, force: true });

    expect(commands.map((c) => c.name)).toEqual(["alpha", "mike", "zebra"]);
  });

  test("skips a file that exports no command, and says which one", async () => {
    const warn = silenceWarnings();
    const commands = await loadCommandsFromDir(FIXTURES);
    const messages = warn.mock.calls.map((call) => String(call[0]));
    warn.mockRestore();
    expect(commands.some((c) => c.name === undefined)).toBe(false);
    expect(messages.some((m) => m.includes("helper.ts") && m.includes("exports no *Command"))).toBe(true);
  });

  test("never loads test files, even when they export a command-shaped value", async () => {
    const warn = silenceWarnings();
    const commands = await loadCommandsFromDir(FIXTURES);
    warn.mockRestore();
    expect(commands.some((c) => c.name === "gamma")).toBe(false);
  });

  test("never loads declaration files", async () => {
    const warn = silenceWarnings();
    const messages = (await (async () => {
      await loadCommandsFromDir(FIXTURES);
      return warn.mock.calls.map((call) => String(call[0]));
    })())!;
    warn.mockRestore();
    expect(messages.some((m) => m.includes("types.d.ts"))).toBe(false);
  });

  test("honors a custom export suffix", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cli-kit-suffix-"));
    writeFileSync(
      join(dir, "task.ts"),
      "export const taskAction = { name: 'task', summary: 'task', execute: async () => ({}) };",
    );

    const warn = silenceWarnings();
    const withDefault = await loadCommandsFromDir(dir);
    const withSuffix = await loadCommandsFromDir(dir, { exportSuffix: "Action" });
    warn.mockRestore();
    rmSync(dir, { recursive: true, force: true });

    // The same file is invisible under the default suffix and found under the
    // one it actually uses.
    expect(withDefault).toEqual([]);
    expect(withSuffix.map((c) => c.name)).toEqual(["task"]);
  });

  test("a non-object export with a matching name is not mistaken for a command", async () => {
    const warn = silenceWarnings();
    const commands = await loadCommandsFromDir(FIXTURES, { exportSuffix: "Value" });
    warn.mockRestore();
    // `helper.ts` exports `helperValue`, a number — a name match is not enough.
    expect(commands).toEqual([]);
  });

  test("an object with a matching name but no callable execute is skipped, not registered", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cli-kit-malformed-"));
    writeFileSync(
      join(dir, "broken.ts"),
      "export const brokenCommand = { name: 'broken' };",
    );

    const warn = silenceWarnings();
    const commands = await loadCommandsFromDir(dir);
    const messages = warn.mock.calls.map((call) => String(call[0]));
    warn.mockRestore();
    rmSync(dir, { recursive: true, force: true });

    expect(commands).toEqual([]);
    expect(messages.some((m) => m.includes("broken.ts") && m.includes("exports no *Command"))).toBe(true);
  });

  test("a module exporting several commands is skipped, not silently truncated", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cli-kit-multi-"));
    writeFileSync(
      join(dir, "multi.ts"),
      [
        "export const firstCommand = { name: 'first', summary: 'first', execute: async () => ({}) };",
        "export const secondCommand = { name: 'second', summary: 'second', execute: async () => ({}) };",
      ].join("\n"),
    );

    const warn = silenceWarnings();
    const commands = await loadCommandsFromDir(dir);
    const messages = warn.mock.calls.map((call) => String(call[0]));
    warn.mockRestore();
    rmSync(dir, { recursive: true, force: true });

    expect(commands).toEqual([]);
    expect(messages.some((m) => m.includes("multi.ts") && m.includes("expected exactly one"))).toBe(true);
  });

  test("a relative path is rejected instead of resolving against the cwd", async () => {
    await expect(loadCommandsFromDir("relative/path")).rejects.toThrow(/must be an absolute path/);
  });

  test("a missing directory yields no commands and names the path", async () => {
    const warn = silenceWarnings();
    const missing = join(tmpdir(), "modality-cli-kit-absent-commands");
    const commands = await loadCommandsFromDir(missing);
    const messages = warn.mock.calls.map((call) => String(call[0]));
    warn.mockRestore();
    expect(commands).toEqual([]);
    expect(messages.some((m) => m.includes(missing))).toBe(true);
  });

  test("an empty directory yields no commands and no warnings", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cli-kit-empty-"));
    const warn = silenceWarnings();
    const commands = await loadCommandsFromDir(dir);
    const calls = warn.mock.calls.length;
    warn.mockRestore();
    rmSync(dir, { recursive: true, force: true });
    expect(commands).toEqual([]);
    expect(calls).toBe(0);
  });

  test("a module that throws on import is skipped, not fatal", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cli-kit-throwing-"));
    writeFileSync(join(dir, "boom.ts"), "throw new Error('boom on import');");
    writeFileSync(
      join(dir, "ok.ts"),
      "export const okCommand = { name: 'ok', summary: 'ok', execute: async () => ({}) };",
    );

    const warn = silenceWarnings();
    const commands = await loadCommandsFromDir(dir);
    const messages = warn.mock.calls.map((call) => String(call[0]));
    warn.mockRestore();
    rmSync(dir, { recursive: true, force: true });

    expect(commands.map((c) => c.name)).toEqual(["ok"]);
    expect(messages.some((m) => m.includes("boom.ts") && m.includes("failed to load"))).toBe(true);
  });

  test("loads .js command modules, so a built directory scans like a source one", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cli-kit-built-"));
    writeFileSync(
      join(dir, "built.js"),
      "export const builtCommand = { name: 'built', summary: 'built', execute: async () => ({}) };",
    );

    const commands = await loadCommandsFromDir(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(commands.map((c) => c.name)).toEqual(["built"]);
  });

  test("a source file and its stale build are one command, with source winning", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cli-kit-dupe-"));
    writeFileSync(
      join(dir, "dual.ts"),
      "export const dualCommand = { name: 'dual', summary: 'from source', execute: async () => ({}) };",
    );
    writeFileSync(
      join(dir, "dual.js"),
      "export const dualCommand = { name: 'dual', summary: 'from build', execute: async () => ({}) };",
    );

    const commands = await loadCommandsFromDir(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(commands).toHaveLength(1);
    expect(commands[0]!.summary).toBe("from source");
  });
});

describe("createCommandRegistryFromDir", () => {
  test("builds a registry that resolves the scanned commands by name", async () => {
    const warn = silenceWarnings();
    const registry = await createCommandRegistryFromDir(FIXTURES);
    warn.mockRestore();
    expect(registry.all.map((c) => c.name)).toEqual(["alpha", "beta"]);
    expect(registry.get("beta")?.name).toBe("beta");
  });

  test("harvests each command's own aliases", async () => {
    const warn = silenceWarnings();
    const registry = await createCommandRegistryFromDir(FIXTURES);
    warn.mockRestore();
    expect(registry.aliases.alpha).toEqual(["a", "al"]);
    expect(registry.get("a")?.name).toBe("alpha");
    expect(registry.get("al")?.name).toBe("alpha");
  });

  test("a command without its own aliases contributes none", async () => {
    const warn = silenceWarnings();
    const registry = await createCommandRegistryFromDir(FIXTURES);
    warn.mockRestore();
    expect(registry.aliases.beta).toBeUndefined();
  });

  test("an explicit alias map overrides the command's own aliases", async () => {
    const warn = silenceWarnings();
    const registry = await createCommandRegistryFromDir(FIXTURES, { alpha: ["first"] });
    warn.mockRestore();
    expect(registry.aliases.alpha).toEqual(["first"]);
    expect(registry.get("first")?.name).toBe("alpha");
    // The overridden alias no longer resolves — the map is authoritative.
    expect(registry.get("a")).toBeUndefined();
  });

  test("an explicit map for one command leaves another's own aliases intact", async () => {
    const warn = silenceWarnings();
    const registry = await createCommandRegistryFromDir(FIXTURES, { beta: ["b"] });
    warn.mockRestore();
    expect(registry.aliases.beta).toEqual(["b"]);
    expect(registry.aliases.alpha).toEqual(["a", "al"]);
  });

  test("scanned commands execute through the registry", async () => {
    const warn = silenceWarnings();
    const registry = await createCommandRegistryFromDir(FIXTURES);
    warn.mockRestore();
    expect(await registry.execute("alpha", {})).toEqual({ success: true, ran: "alpha" });
  });

  test("prefix resolution works on a scanned registry", async () => {
    const warn = silenceWarnings();
    const registry = await createCommandRegistryFromDir(FIXTURES);
    warn.mockRestore();
    expect(registry.resolve("bet", { prefix: true })).toMatchObject({ found: true, name: "beta" });
  });
});

describe("resolveCommandsDir", () => {
  test("resolves commands dir from package root relative to given path", () => {
    const resolved = resolveCommandsDir({ from: import.meta.url, subpath: "src/__tests__/fixtures/scanCommands" });
    expect(resolved).toContain("scanCommands");
  });

  test("falls back to commands directory if package.json not found", () => {
    const resolved = resolveCommandsDir({ from: "/nonexistent/path/file.ts" });
    expect(resolved).toBe("/nonexistent/path/commands");
  });

  test("accepts a URL instance as well as a string file URL", () => {
    const resolved = resolveCommandsDir({
      from: new URL(import.meta.url),
      subpath: "src/__tests__/fixtures/scanCommands",
    });
    expect(resolved).toContain("scanCommands");
  });
});
