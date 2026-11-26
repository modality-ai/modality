/**
 * `measure-tests` — time each test file in a project separately.
 *
 * The kit owns the script so consuming projects only run
 * `modality-cli measure-tests`; they never copy it into their own tools/ dir.
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import type { CLICommand } from "../../help/types";

// Keys are kebab-case: the runner normalizes validated args to the spelling
// users type (`--tests-dir`, positional #1), and hands that shape to execute.
const MeasureTestsArgsSchema = z.object({
  "tests-dir": z
    .string()
    .optional()
    .describe("Directory to scan for test files (default: <cwd>/src, or <cwd>)"),
  top: z.coerce
    .number()
    .int()
    .positive()
    .optional()
    .describe("How many of the slowest files to list (default: 10)"),
});

type MeasureTestsArgs = z.infer<typeof MeasureTestsArgsSchema>;
type TestResult = {
  file: string;
  duration: number;
  testCount: number;
  status: "PASS" | "FAIL";
};

const SKIP_DIRS = new Set(["node_modules", "dist", ".git"]);

function findTestFiles(dir: string, results: string[] = []): string[] {
  if (!existsSync(dir)) return results;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) findTestFiles(path, results);
    } else if (entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.js")) {
      results.push(path);
    }
  }
  return results.sort();
}

async function measureTestFile(file: string, cwd: string): Promise<TestResult> {
  const start = performance.now();
  let output = "";
  const code = await new Promise<number | null>((done) => {
    // process.execPath is the bun running this bin — no PATH lookup needed.
    const child = spawn(process.execPath, ["test", file], { cwd, stdio: "pipe" });
    child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    child.on("error", () => done(null));
    child.on("close", (exitCode: number | null) => done(exitCode));
  });

  const count = output.match(/(\d+)\s+pass/);
  return {
    file,
    duration: Math.round(performance.now() - start),
    testCount: count ? Number(count[1]) : 0,
    status: code === 0 ? "PASS" : "FAIL",
  };
}

function report(results: TestResult[], cwd: string, top: number): string {
  const lines = [`Found ${results.length} test files. Measuring performance...`, ""];
  for (const result of results) {
    const mark = result.status === "PASS" ? "✓" : "✗";
    lines.push(
      `${mark} ${relative(cwd, result.file)} - ${result.duration}ms (${result.testCount} tests)`,
    );
  }
  lines.push("", `=== TOP ${top} SLOWEST TEST FILES ===`, "");
  results
    .sort((a, b) => b.duration - a.duration)
    .slice(0, top)
    .forEach((result, index) => {
      lines.push(`${index + 1}. ${relative(cwd, result.file).split(sep).pop()}`);
      lines.push(`   Duration: ${result.duration}ms`);
      lines.push(`   Tests: ${result.testCount}`);
      lines.push(`   Path: ${relative(cwd, result.file)}`);
      lines.push("");
    });
  return lines.join("\n");
}

async function measureTests(args: MeasureTestsArgs): Promise<string> {
  const cwd = process.cwd();
  const defaultDir = join(cwd, "src");
  const dir = resolve(args["tests-dir"] ?? (existsSync(defaultDir) ? defaultDir : cwd));
  const top = args.top ?? 10;

  const results: TestResult[] = [];
  for (const file of findTestFiles(dir)) {
    results.push(await measureTestFile(file, cwd));
  }
  return report(results, cwd, top);
}

export const measureTestsCommand: CLICommand = {
  name: "measure-tests",
  description: "Time each test file separately and list the slowest",
  inputSchema: MeasureTestsArgsSchema,
  positionalKeys: ["tests-dir"],
  examples: [
    "modality-cli measure-tests",
    "modality-cli measure-tests ./tests --top 5",
  ],
  execute: (args: MeasureTestsArgs) => measureTests(args),
};
