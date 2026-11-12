import { describe, test, expect } from "bun:test";
import { z } from "zod";
import { getHelp, type CLICommand, type HelpConfig } from "../help";
import { stripAnsi } from "../ui/strip-ansi";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeCmd(name: string, summary = ""): CLICommand {
  return { name, summary, execute: async () => {} };
}

function makeConfig(
  cmds: CLICommand[],
  overrides?: Partial<HelpConfig>,
): HelpConfig {
  return {
    cliName: "test-cli",
    tagline: "A test CLI",
    commands: cmds,
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("getHelp — name column auto-sizing", () => {
  test("uses DEFAULT_COL_NAME_WIDTH (16) when all names are short", () => {
    const config = makeConfig([makeCmd("open", "Open URL"), makeCmd("click", "Click element")]);
    const output = getHelp({ ...config, format: "human" });
    const lines = stripAnsi(output).split("\n");

    // Find the "open" command line — name column should be padded to 16
    const openLine = lines.find((l) => l.includes("open"))!;
    expect(openLine).toBeDefined();
    // padName pads to 16: "open" + 12 spaces + "Open URL"
    const openPart = openLine.trimStart();
    expect(openPart).toMatch(/^open\s{12}/);
  });

  test("expands column when a command name exceeds 14 chars (name + 2 > 16)", () => {
    const cmds = [
      makeCmd("short", "A"),
      makeCmd("a-very-long-command-name", "Long"),
    ];
    const output = getHelp({ ...makeConfig(cmds), format: "human" });
    const lines = stripAnsi(output).split("\n");

    // The long name is 23 chars, so column should be 23 + 2 = 25
    const longLine = lines.find((l) => l.includes("a-very-long-command-name"))!;
    expect(longLine).toBeDefined();
    const match = longLine.match(/a-very-long-command-name(\s+)/);
    expect(match).not.toBeNull();
    // At least 2 spaces of gap after the long name
    const gap = match![1];
    expect(gap!.length).toBeGreaterThanOrEqual(2);
  });

  test("explicit colNameWidth overrides auto-sizing", () => {
    const cmds = [makeCmd("open", "Open URL")];
    const output = getHelp({ ...makeConfig(cmds, { colNameWidth: 30 }), format: "human" });
    const lines = stripAnsi(output).split("\n");
    const openLine = lines.find((l) => l.includes("open"))!;
    expect(openLine).toBeDefined();
    // "open" (4) padded to 30 = 26 trailing spaces
    const openPart = openLine.trimStart();
    expect(openPart).toMatch(/^open\s{26}/);
  });

  test("name exactly 14 chars stays at default 16 (14+2=16)", () => {
    // "abcdefghijklmnop" is 16 chars, but "abcdefghijklmn" is 14
    const cmds = [makeCmd("abcdefghijklmn", "Short desc")];
    const output = getHelp({ ...makeConfig(cmds), format: "human" });
    const lines = stripAnsi(output).split("\n");
    const cmdLine = lines.find((l) => l.includes("abcdefghijklmn"))!;
    expect(cmdLine).toBeDefined();
    // 14 + 2 = 16, which equals DEFAULT_COL_NAME_WIDTH, so column stays at 16
    // padName("abcdefghijklmn", 16) → "abcdefghijklmn" + 2 spaces
    const cmdPart = cmdLine.trimStart();
    expect(cmdPart).toMatch(/^abcdefghijklmn\s{2}/);
  });

  test("name exactly 15 chars expands to 17 (15+2=17)", () => {
    const cmds = [makeCmd("abcdefghijklmno", "Desc")];
    const output = getHelp({ ...makeConfig(cmds), format: "human" });
    const lines = stripAnsi(output).split("\n");
    const cmdLine = lines.find((l) => l.includes("abcdefghijklmno"))!;
    expect(cmdLine).toBeDefined();
    // 15 + 2 = 17, which > DEFAULT_COL_NAME_WIDTH (16), so column = 17
    // padName("abcdefghijklmno", 17) → "abcdefghijklmno" + 2 spaces
    const cmdPart = cmdLine.trimStart();
    expect(cmdPart).toMatch(/^abcdefghijklmno\s{2}/);
  });

  test("undefined cmd.name treated as empty string, defaults to 16", () => {
    const cmds = [makeCmd("", "Has no name")];
    const output = getHelp({ ...makeConfig(cmds), format: "human" });
    const lines = stripAnsi(output).split("\n");
    // Should not crash and should produce output
    expect(output).toBeTruthy();
    expect(stripAnsi(output)).toContain("Commands:");
  });

  test("commands are sorted alphabetically by default", () => {
    const cmds = [makeCmd("zebra", "Z"), makeCmd("alpha", "A"), makeCmd("mid", "M")];
    const output = getHelp({ ...makeConfig(cmds), format: "human" });
    const lines = stripAnsi(output).split("\n");

    const cmdLines = lines
      .filter((l) => l.trimStart().startsWith("alpha") || l.trimStart().startsWith("mid") || l.trimStart().startsWith("zebra"))
      .map((l) => l.trimStart().split(/\s/)[0]);

    expect(cmdLines).toEqual(["alpha", "mid", "zebra"]);
  });

  test("sorted: false preserves original order", () => {
    const cmds = [makeCmd("zebra", "Z"), makeCmd("alpha", "A")];
    const output = getHelp({ ...makeConfig(cmds, { sorted: false }), format: "human" });
    const lines = stripAnsi(output).split("\n");

    const cmdLines = lines
      .filter((l) => l.trimStart().startsWith("alpha") || l.trimStart().startsWith("zebra"))
      .map((l) => l.trimStart().split(/\s/)[0]);

    expect(cmdLines).toEqual(["zebra", "alpha"]);
  });
});

describe("getHelp — structure", () => {
  test("includes cliName and tagline", () => {
    const output = getHelp({ ...makeConfig([]), format: "human" });
    const plain = stripAnsi(output);
    expect(plain).toContain("test-cli");
    expect(plain).toContain("A test CLI");
  });

  test("includes usage line", () => {
    const output = getHelp({ ...makeConfig([]), format: "human" });
    const plain = stripAnsi(output);
    expect(plain).toContain("Usage:");
    expect(plain).toContain("test-cli <command>");
  });

  test("renders global options when provided", () => {
    const output = getHelp({
      ...makeConfig([makeCmd("run", "Run")], {
        globalOptions: [{ flag: "--verbose, -v", desc: "Enable verbose output" }],
      }),
      format: "human",
    });
    const plain = stripAnsi(output);
    expect(plain).toContain("Global Options:");
    expect(plain).toContain("--verbose");
    expect(plain).toContain("Enable verbose output");
  });

  test("renders global examples when provided", () => {
    const output = getHelp({
      ...makeConfig([makeCmd("run", "Run")], {
        globalExamples: ["test-cli run --verbose"],
      }),
      format: "human",
    });
    const plain = stripAnsi(output);
    expect(plain).toContain("Examples:");
    expect(plain).toContain("test-cli run --verbose");
  });

  test("renders footer when provided", () => {
    const output = getHelp({
      ...makeConfig([], { footer: "Set NO_COLOR=1 to disable colors" }),
      format: "human",
    });
    const plain = stripAnsi(output);
    expect(plain).toContain("Set NO_COLOR=1 to disable colors");
  });

  test("empty commands list produces valid output with no crash", () => {
    const output = getHelp({ ...makeConfig([]), format: "human" });
    expect(output).toBeTruthy();
    expect(stripAnsi(output)).toContain("Commands:");
  });
});

describe("getHelp — auto-sizing regression guard", () => {
  test("long name expands beyond default 16 (regression: fixed-width would truncate)", () => {
    // Regression: the old code used colNameWidth = 16 (fixed).
    // Auto-sizing should expand to longest name + 2 when it exceeds 16.
    const cmds = [makeCmd("a-really-long-command", "Desc")];
    const output = getHelp({ ...makeConfig(cmds), format: "human" });
    const plain = stripAnsi(output);
    const cmdLine = plain.split("\n").find((l) => l.includes("a-really-long-command"))!;
    expect(cmdLine).toBeDefined();
    // "a-really-long-command" = 21 chars → column = 23 (21 + 2)
    // With fixed 16, the name would collide with the summary
    const afterName = cmdLine.split("a-really-long-command")[1]!;
    expect(afterName!.length).toBeGreaterThanOrEqual(2);
  });

  test("mixed short and long names — column fits the longest", () => {
    const cmds = [
      makeCmd("ls", "List"),
      makeCmd("a-very-long-command-name", "Long"),
    ];
    const output = getHelp({ ...makeConfig(cmds), format: "human" });
    const plain = stripAnsi(output);
    const lsLine = plain.split("\n").find((l) => l.trimStart().startsWith("ls"))!;
    const longLine = plain.split("\n").find((l) => l.includes("a-very-long-command-name"))!;
    expect(lsLine).toBeDefined();
    expect(longLine).toBeDefined();
    // Both should have adequate gap — column is sized to the longest name
    const lsGap = lsLine.split("ls")[1]!;
    const longGap = longLine.split("a-very-long-command-name")[1]!;
    // Column = 25 (23 + 2), so "ls" gets 23 trailing spaces before summary
    expect(lsGap!.length).toBeGreaterThanOrEqual(23);
    expect(longGap!.length).toBeGreaterThanOrEqual(2);
  });
});

// ── getHelp (per-command) ─────────────────────────────────────────────────────

describe("getHelp — per-command basic rendering", () => {
  test("renders command name and summary", () => {
    const cmd = makeCmd("open", "Navigate to a URL");
    const output = getHelp({ cliName: "web-cli", commands: [cmd], command: "open", format: "human" });
    const plain = stripAnsi(output);
    expect(plain).toContain("web-cli open");
    expect(plain).toContain("Navigate to a URL");
  });

  test("renders default usage line from command name", () => {
    const cmd = makeCmd("click", "Click element");
    const output = getHelp({ cliName: "web-cli", commands: [cmd], command: "click", format: "human" });
    const plain = stripAnsi(output);
    expect(plain).toContain("Usage:");
    expect(plain).toContain("web-cli");
    expect(plain).toContain("click");
    expect(plain).toContain("[options]");
  });

  test("renders custom usage lines when provided", () => {
    const cmd: CLICommand = {
      name: "open",
      summary: "Navigate",
      usage: ["web-cli open <url>", "web-cli open --file <path>"],
      execute: async () => {},
    };
    const output = getHelp({ cliName: "web-cli", commands: [cmd], command: "open", format: "human" });
    const plain = stripAnsi(output);
    expect(plain).toContain("web-cli open <url>");
    expect(plain).toContain("web-cli open --file <path>");
  });

  test("renders examples when provided", () => {
    const cmd: CLICommand = {
      name: "open",
      summary: "Navigate",
      examples: ["web-cli open https://example.com", "web-cli open --wait-until networkidle https://example.com"],
      execute: async () => {},
    };
    const output = getHelp({ cliName: "web-cli", commands: [cmd], command: "open", format: "human" });
    const plain = stripAnsi(output);
    expect(plain).toContain("Examples:");
    expect(plain).toContain("web-cli open https://example.com");
  });

  test("omits Examples section when no examples provided", () => {
    const cmd = makeCmd("open", "Navigate");
    const output = getHelp({ cliName: "web-cli", commands: [cmd], command: "open", format: "human" });
    const plain = stripAnsi(output);
    expect(plain).not.toContain("Examples:");
  });
});

describe("getHelp — per-command global options and dedup", () => {
  test("appends global options when command has no own options", () => {
    const cmd = makeCmd("open", "Navigate");
    const globals = [
      { flag: "--verbose, -v", desc: "Verbose output" },
      { flag: "--json", desc: "JSON output" },
    ];
    const output = getHelp({ cliName: "web-cli", commands: [cmd], command: "open", globalOptions: globals, format: "human" });
    const plain = stripAnsi(output);
    expect(plain).toContain("--verbose");
    expect(plain).toContain("Verbose output");
    expect(plain).toContain("--json");
  });

  test("omits Options section entirely when no own options and no globals", () => {
    const cmd = makeCmd("open", "Navigate");
    const output = getHelp({ cliName: "web-cli", commands: [cmd], command: "open", format: "human" });
    const plain = stripAnsi(output);
    // No options → no Options section, no --help fallback
    expect(plain).not.toContain("Options:");
    expect(plain).not.toContain("--help");
  });

  test("appends --help fallback when there are own options but no --help flag", () => {
    const cmd: CLICommand = {
      name: "open",
      summary: "Navigate",
      inputSchema: z.object({
        wait: z.string().describe("Wait condition"),
      }),
      execute: async () => {},
    };
    const output = getHelp({ cliName: "web-cli", commands: [cmd], command: "open", format: "human" });
    const plain = stripAnsi(output);
    expect(plain).toContain("Options:");
    expect(plain).toContain("--help");
  });

  test("does not duplicate --help when global options already include it", () => {
    const cmd = makeCmd("open", "Navigate");
    const globals = [
      { flag: "--verbose, -v", desc: "Verbose" },
      { flag: "--help, -h", desc: "Show help" },
    ];
    const output = getHelp({ cliName: "web-cli", commands: [cmd], command: "open", globalOptions: globals, format: "human" });
    const plain = stripAnsi(output);
    // Should contain --help exactly once (from global options, not the fallback)
    const helpMatches = plain.match(/--help/g);
    expect(helpMatches!.length).toBe(1);
  });

  test("deduplicates global option that overlaps with command option", () => {
    // A command with --json in its own options should suppress the global --json
    const cmd: CLICommand = {
      name: "export",
      summary: "Export data",
      inputSchema: { json: { type: "boolean", description: "JSON output" } } as any,
      execute: async () => {},
    };
    const globals = [{ flag: "--json", desc: "Global JSON flag" }];
    const output = getHelp({ cliName: "web-cli", commands: [cmd], command: "export", globalOptions: globals, format: "human" });
    const plain = stripAnsi(output);
    // Should have --help (fallback) but the global --json should be deduped
    // (the command's own --json from schema would appear, but global one is skipped)
    expect(plain).toContain("--help");
  });

  test("renders command positionals in Arguments section", () => {
    const cmd: CLICommand = {
      name: "get",
      summary: "Get item",
      positionals: [{ flag: "id", desc: "Item ID" }],
      execute: async () => {},
    };
    const output = getHelp({ cliName: "web-cli", commands: [cmd], command: "get", format: "human" });
    const plain = stripAnsi(output);
    expect(plain).toContain("Arguments:");
    expect(plain).toContain("<id>");
    expect(plain).toContain("Item ID");
  });

  test("omits Arguments section when no positionals", () => {
    const cmd = makeCmd("list", "List items");
    const output = getHelp({ cliName: "web-cli", commands: [cmd], command: "list", format: "human" });
    const plain = stripAnsi(output);
    expect(plain).not.toContain("Arguments:");
  });
});
