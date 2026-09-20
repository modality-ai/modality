/**
 * generateCommandsIndex — the build-time counterpart to the runtime directory
 * scan. It applies the same discovery rules (sorted, deduped, warn-and-skip on
 * a broken file) but emits a static module instead of importing at runtime,
 * so a bundled CLI renders one shared dependency graph.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateCommandsIndex } from "../commandsDir";

let dir: string;
let out: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "gen-cmds-"));
  out = join(dir, "generated.commands.ts");
  writeFileSync(
    join(dir, "foo.ts"),
    `export const fooCommand = { name: "foo", execute: async () => ({ success: true }) };\n`,
  );
  writeFileSync(
    join(dir, "bar.ts"),
    `export const barCommand = { name: "bar", execute: async () => ({ success: true }) };\n`,
  );
  // Broken files the generator must warn about and skip:
  writeFileSync(join(dir, "helper.ts"), `export const helper = 1;\n`); // no *Command export
  writeFileSync(
    join(dir, "dup.ts"),
    `export const aCommand = 1;\nexport const bCommand = 2;\n`, // two *Command exports
  );
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("generateCommandsIndex", () => {
  test("emits a static import and array entry for every valid command", async () => {
    const source = await generateCommandsIndex(dir, { out });
    expect(source).toContain('import { fooCommand } from "./foo";');
    expect(source).toContain('import { barCommand } from "./bar";');
    // Deterministic: commandFilesIn sorts by name.
    expect(source).toContain(
      "export const commands: CLICommand[] = [barCommand, fooCommand];",
    );
  });

  test("writes the module to out", async () => {
    await generateCommandsIndex(dir, { out });
    expect(existsSync(out)).toBe(true);
    expect(readFileSync(out, "utf-8")).toContain("fooCommand");
  });

  test("skips files without exactly one *Command export", async () => {
    const source = await generateCommandsIndex(dir, { out });
    expect(source).not.toContain("helper");
    expect(source).not.toContain("aCommand");
    expect(source).not.toContain("dup");
  });

  test("rejects a relative out path", async () => {
    await expect(generateCommandsIndex(dir, { out: "relative.ts" })).rejects.toThrow(
      "absolute",
    );
  });

  test("returns empty source when the commands directory is missing", async () => {
    const warnings: string[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => warnings.push(args.join(" "));
    let source: string;
    try {
      source = await generateCommandsIndex(join(dir, "missing"), {
        out: join(dir, "missing.out.ts"),
      });
    } finally {
      console.error = originalError;
    }
    expect(source).toBe("");
    expect(warnings.some((w) => w.includes("commands directory not found"))).toBe(
      true,
    );
  });

  test("regeneration skips the generated file when out sits inside the commands directory", async () => {
    const cmdDir = join(dir, "nested");
    mkdirSync(cmdDir, { recursive: true });
    writeFileSync(
      join(cmdDir, "foo.ts"),
      `export const fooCommand = { name: "foo", execute: async () => ({ success: true }) };\n`,
    );
    const out = join(cmdDir, "generated.commands.ts");

    const first = await generateCommandsIndex(cmdDir, { out });
    expect(first).toContain('import { fooCommand } from "./foo";');

    // Regenerating must not treat the module it is about to write as a command.
    const warnings: string[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => warnings.push(args.join(" "));
    let second: string;
    try {
      second = await generateCommandsIndex(cmdDir, { out });
    } finally {
      console.error = originalError;
    }
    expect(second).toContain('import { fooCommand } from "./foo";');
    expect(second).not.toContain("generated.commands");
    expect(warnings.some((w) => w.includes("generated.commands.ts"))).toBe(false);
  });

  test("skips a command file that throws at import time", async () => {
    writeFileSync(join(dir, "boom.ts"), `throw new Error("boom");\n`);
    const warnings: string[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => warnings.push(args.join(" "));
    let source: string;
    try {
      source = await generateCommandsIndex(dir, { out });
    } finally {
      console.error = originalError;
    }
    expect(source).not.toContain("boom");
    expect(source).toContain('import { fooCommand } from "./foo";');
    expect(
      warnings.some((w) => w.includes("failed to load") && w.includes("boom.ts")),
    ).toBe(true);
  });

  test("skips a *Command export that is not command-shaped", async () => {
    writeFileSync(join(dir, "bogus.ts"), `export const bogusCommand = 1;\n`);
    const source = await generateCommandsIndex(dir, { out });
    expect(source).not.toContain("bogus");
    expect(source).toContain('import { fooCommand } from "./foo";');
  });

  test("honors a custom exportSuffix", async () => {
    const customDir = join(dir, "suffixes");
    mkdirSync(customDir, { recursive: true });
    writeFileSync(
      join(customDir, "gizmo.ts"),
      `export const gizmoThing = { name: "gizmo", execute: async () => ({ success: true }) };\n`,
    );
    const source = await generateCommandsIndex(customDir, {
      out: join(customDir, "things.out.ts"),
      exportSuffix: "Thing",
    });
    expect(source).toContain('import { gizmoThing } from "./gizmo";');
    expect(source).toContain("[gizmoThing]");
  });

  test("refuses to overwrite an existing command file when out collides", async () => {
    // `out` pointing at a live command module must never destroy it.
    await expect(generateCommandsIndex(dir, { out: join(dir, "foo.ts") })).rejects
      .toThrow("refusing to overwrite");
    // The command file is still intact.
    expect(readFileSync(join(dir, "foo.ts"), "utf-8")).toContain("fooCommand");
  });

  test("refuses to overwrite when the commands directory is reached through a symlink", async () => {
    const realDir = join(dir, "collision-real");
    mkdirSync(realDir, { recursive: true });
    writeFileSync(
      join(realDir, "foo.ts"),
      `export const fooCommand = { name: "foo", execute: async () => ({ success: true }) };\n`,
    );
    const linkDir = join(dir, "collision-link");
    symlinkSync(realDir, linkDir, "dir");
    // The dir and the out spell the same file differently (/var vs /private/var).
    await expect(
      generateCommandsIndex(linkDir, { out: join(linkDir, "foo.ts") }),
    ).rejects.toThrow("refusing to overwrite");
    expect(readFileSync(join(realDir, "foo.ts"), "utf-8")).toContain("fooCommand");
  });

  test("emits clean relative imports when the commands directory is reached through a symlink", async () => {
    const realDir = join(dir, "spec-real");
    mkdirSync(realDir, { recursive: true });
    writeFileSync(
      join(realDir, "foo.ts"),
      `export const fooCommand = { name: "foo", execute: async () => ({ success: true }) };\n`,
    );
    const linkDir = join(dir, "spec-link");
    symlinkSync(realDir, linkDir, "dir");
    const source = await generateCommandsIndex(linkDir, {
      out: join(realDir, "generated.ts"),
    });
    expect(source).toContain('import { fooCommand } from "./foo";');
    expect(source).not.toContain("../../");
  });
});