import { describe, expect, test } from "bun:test";
import { escapeAscii } from "../notify-macos";

describe("escapeAscii — AppleScript-string safety", () => {
  test("plain text is unchanged", () =>
    expect(escapeAscii("hello world")).toBe("hello world"));
  test("double quote is escaped", () =>
    expect(escapeAscii('say "hi"')).toBe('say \\"hi\\"'));
  test("backslash is escaped", () =>
    expect(escapeAscii("a\\b")).toBe("a\\\\b"));
  test("newline becomes literal backslash-n", () =>
    expect(escapeAscii("a\nb")).toBe("a\\nb"));
  test("backslash is escaped before quote (order-safe)", () =>
    expect(escapeAscii('\\"')).toBe('\\\\\\"'));
  test("unicode passes through untouched", () =>
    expect(escapeAscii("漲停 🟢")).toBe("漲停 🟢"));
  test("semicolon is escaped (OSC 777 field delimiter)", () =>
    expect(escapeAscii("buy;sell")).toBe("buy\\;sell"));
  test("semicolons in mixed content", () =>
    expect(escapeAscii('say "hi";price=100')).toBe('say \\"hi\\"\\;price=100'));
  test("raw ESC and BEL control chars are stripped (no injection)", () =>
    expect(escapeAscii("a\x1bb\x07c")).toBe("abc"));
});