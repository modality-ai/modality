import { describe, test, expect } from "bun:test";
import { type Dirent } from "node:fs";
import { setupCommandExportValidation } from "../lib/command-export-validation";
import { isCommandFile } from "../lib/command-file";

// Self-test against the fixtures: foo.ts and index.ts pass the one-export rule;
// .d.ts, .test.ts, and .spec.ts files are excluded from validation.
setupCommandExportValidation(import.meta.dir + "/fixtures/commands");

// ── isCommandFile (pure predicate) ──────────────────────────────────────────

function dirent(name: string, isFile = true): Dirent {
  return { name, isFile: () => isFile } as Dirent;
}

describe("isCommandFile", () => {
  test("includes regular .ts command files", () => {
    expect(isCommandFile(dirent("foo.ts"))).toBe(true);
  });

  test("excludes .d.ts declaration files", () => {
    expect(isCommandFile(dirent("types.d.ts"))).toBe(false);
  });

  test("excludes .test.ts test files", () => {
    expect(isCommandFile(dirent("foo.test.ts"))).toBe(false);
  });

  test("excludes .spec.ts spec files", () => {
    expect(isCommandFile(dirent("foo.spec.ts"))).toBe(false);
  });

  test("includes built .js command files", () => {
    expect(isCommandFile(dirent("foo.js"))).toBe(true);
  });

  test("excludes .test.js test files", () => {
    expect(isCommandFile(dirent("foo.test.js"))).toBe(false);
  });

  test("excludes .spec.js spec files", () => {
    expect(isCommandFile(dirent("foo.spec.js"))).toBe(false);
  });

  test("excludes files with unrelated extensions", () => {
    expect(isCommandFile(dirent("readme.md"))).toBe(false);
  });

  test("excludes directories", () => {
    expect(isCommandFile(dirent("subdir", false))).toBe(false);
  });
});

// ── setupCommandExportValidation guards ─────────────────────────────────────

describe("setupCommandExportValidation guards", () => {
  test("throws on missing directory", () => {
    expect(() =>
      setupCommandExportValidation("/nonexistent/commands"),
    ).toThrow(
      "setupCommandExportValidation: commandsDir not found – /nonexistent/commands",
    );
  });

  test("throws on relative path", () => {
    expect(() => setupCommandExportValidation("relative/path")).toThrow(
      "setupCommandExportValidation: commandsDir must be an absolute path – relative/path",
    );
  });
});
