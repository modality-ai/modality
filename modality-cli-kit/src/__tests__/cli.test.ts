/**
 * modality-cli bin — the CLI is built into dist/cli.js before tests run (kit
 * `test` runs `build` first), so the test exercises the real bundled entry.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = new URL("../../dist/cli.js", import.meta.url).pathname;
let dir: string;
let out: string;

function run(args: string[], options: { cwd?: string } = {}) {
  return Bun.spawnSync([process.execPath, CLI, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    cwd: options.cwd,
  });
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "modality-cli-"));
  out = join(dir, "generated.commands.ts");
  writeFileSync(
    join(dir, "foo.ts"),
    `export const fooCommand = { name: "foo", execute: async () => ({ success: true }) };\n`,
  );
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("modality-cli generate-commands", () => {
  test("writes a static index for the given directory", () => {
    const res = run(["generate-commands", dir, "--out", out]);
    expect(res.exitCode).toBe(0);
    expect(existsSync(out)).toBe(true);
    const source = readFileSync(out, "utf-8");
    expect(source).toContain('import { fooCommand } from "./foo";');
    expect(source).toContain(
      "export const commands: CLICommand[] = [fooCommand];",
    );
  });

  test("help exits 0 and names the subcommand", () => {
    const res = run(["--help"]);
    expect(res.exitCode).toBe(0);
    expect(res.stdout.toString()).toContain("generate-commands");
  });

  test("unknown subcommand exits 1 with the message on stderr", () => {
    const res = run(["frobnicate"]);
    expect(res.exitCode).toBe(1);
    expect(res.stderr.toString()).toContain('unknown command "frobnicate"');
  });

  test("resolves the consumer project's commands directory by default", () => {
    const project = mkdtempSync(join(tmpdir(), "modality-cli-project-"));
    const commandsDir = join(project, "src", "scripts", "commands");
    mkdirSync(commandsDir, { recursive: true });
    writeFileSync(join(project, "package.json"), "{}\n");
    writeFileSync(
      join(commandsDir, "foo.ts"),
      `export const fooCommand = { name: "foo", execute: async () => ({ success: true }) };\n`,
    );
    try {
      const res = run(["generate-commands"], { cwd: project });
      expect(res.exitCode).toBe(0);
      // Default out lands next to the commands directory.
      const out = join(commandsDir, "..", "generated.commands.ts");
      expect(existsSync(out)).toBe(true);
      const source = readFileSync(out, "utf-8");
      expect(source).toContain('import { fooCommand } from "./commands/foo";');
      expect(source).toContain(
        "export const commands: CLICommand[] = [fooCommand];",
      );
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test("exits 1 and reports when the commands directory is missing", () => {
    const missing = join(dir, "does-not-exist");
    const res = run([
      "generate-commands",
      missing,
      "--out",
      join(dir, "missing.out.ts"),
    ]);
    expect(res.exitCode).toBe(1);
    expect(res.stderr.toString()).toContain("nothing generated");
  });

  test("invalid options exit 1 with a message instead of a stack trace", () => {
    const res = run(["generate-commands", "--bogus"]);
    expect(res.exitCode).toBe(1);
    expect(res.stderr.toString()).toContain("invalid options");
    expect(res.stderr.toString()).not.toContain("\n    at ");
  });
});