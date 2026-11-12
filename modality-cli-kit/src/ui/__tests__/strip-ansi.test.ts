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

  // Non-SGR CSI sequences (cursor movement, erase, clear) are now stripped too.
  it("strips cursor-positioning sequence", () => {
    expect(stripAnsi("\x1b[1;1Hhello")).toBe("hello");
  });

  it("strips erase-screen sequence", () => {
    expect(stripAnsi("\x1b[2Jhello")).toBe("hello");
  });

  it("strips clear-line sequence", () => {
    expect(stripAnsi("hello\x1b[K")).toBe("hello");
  });

  it("strips mixed SGR and cursor sequences", () => {
    expect(stripAnsi("\x1b[31m\x1b[2Jred\x1b[0m\x1b[K")).toBe("red");
  });
});

describe("stripAnsi OSC sequences", () => {
  it("strips OSC terminated by BEL", () => {
    expect(stripAnsi("\x1b]0;title\x07hello")).toBe("hello");
  });

  it("strips OSC terminated by ST (ESC backslash)", () => {
    expect(stripAnsi("\x1b]0;title\x1b\\hello")).toBe("hello");
  });

  it("strips terminal hyperlink (BEL terminator)", () => {
    expect(stripAnsi("\x1b]8;;https://example.com\x07click\x1b]8;;\x07")).toBe("click");
  });

  it("strips terminal hyperlink (ST terminator)", () => {
    expect(stripAnsi("\x1b]8;;https://example.com\x1b\\click\x1b]8;;\x1b\\")).toBe("click");
  });

  it("strips multiple OSC sequences", () => {
    expect(stripAnsi("\x1b]8;;a\x07x\x1b]8;;\x07 \x1b]8;;b\x1b\\y\x1b]8;;\x1b\\")).toBe("x y");
  });

  it("strips OSC mixed with SGR", () => {
    expect(stripAnsi("\x1b]8;;url\x07\x1b[31mred\x1b[0m\x1b]8;;\x07")).toBe("red");
  });

  it("leaves OSC without terminator untouched", () => {
    expect(stripAnsi("text \x1b]8;;url no terminator")).toBe("text \x1b]8;;url no terminator");
  });

  it("preserves plain text around OSC", () => {
    expect(stripAnsi("before \x1b]0;t\x07 after")).toBe("before  after");
  });
});
