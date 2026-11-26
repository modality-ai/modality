import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { measureTestsCommand } from "../measure-tests";

const execute = measureTestsCommand.execute as (
  args: Record<string, unknown>,
) => Promise<string>;

describe("measure-tests", () => {
  test("measures each test file in a project-relative directory", async () => {
    const dir = mkdtempSync(join(tmpdir(), "measure-tests-"));
    mkdirSync(join(dir, "nested"), { recursive: true });
    writeFileSync(
      join(dir, "passing.test.ts"),
      `import { expect, test } from "bun:test";\ntest("ok", () => expect(1).toBe(1));\n`,
    );
    writeFileSync(
      join(dir, "nested", "failing.test.ts"),
      `import { expect, test } from "bun:test";\ntest("bad", () => expect(1).toBe(2));\n`,
    );
    try {
      const report = await execute({ "tests-dir": dir, top: 1 });
      expect(report).toContain("Found 2 test files");
      expect(report).toContain("✓ ");
      expect(report).toContain("passing.test.ts");
      expect(report).toContain("✗ ");
      expect(report).toContain("nested/failing.test.ts");
      expect(report).toContain("=== TOP 1 SLOWEST TEST FILES ===");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
