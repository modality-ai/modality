import { describe, expect, it } from "bun:test";
import { stripAnsi } from "../strip-ansi";

describe("stripAnsi", () => {
  it("returns empty string for undefined", () => {
    expect(stripAnsi(undefined)).toBe("");
  });

  it("returns empty string for empty string", () => {
    expect(stripAnsi("")).toBe("");
  });

  it("returns plain text unchanged", () => {
    expect(stripAnsi("hello world")).toBe("hello world");
  });

  it("strips single SGR sequence", () => {
    expect(stripAnsi("\x1b[31mred\x1b[0m")).toBe("red");
  });

  it("strips multiple SGR sequences", () => {
    expect(stripAnsi("\x1b[1m\x1b[31mbold red\x1b[0m")).toBe("bold red");
  });

  it("strips 256-color sequences", () => {
    expect(stripAnsi("\x1b[38;5;196mred\x1b[0m")).toBe("red");
  });

  it("strips truecolor sequences", () => {
    expect(stripAnsi("\x1b[38;2;255;0;0mred\x1b[0m")).toBe("red");
  });

  it("preserves non-ANSI content around stripped sequences", () => {
    expect(stripAnsi("before \x1b[32m after")).toBe("before  after");
  });
});
