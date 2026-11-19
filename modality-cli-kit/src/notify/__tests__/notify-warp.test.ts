import { describe, test, expect } from "bun:test";
import {
  escapeAscii,
  sendMacOSNotification,
} from "../notify-macos";
import {
  escapeAscii as escapeAsciiReexport,
  formatWarpSequence,
  formatWarpAgentSequence,
  planWarpSequences,
  resetWarpSession,
  sendWarpNotification,
  writeOscSequence,
} from "../notify-warp";

describe("escapeAscii", () => {
  test("escapes backslash, quote, semicolon, newline", () => {
    expect(escapeAscii('a\\b"c;d\ne')).toBe('a\\\\b\\"c\\;d\\ne'.replace(/\\n/g, "\\n"));
  });
  test("strips control chars", () => {
    expect(escapeAscii("a\x01b\x1fc")).toBe("abc");
  });
  test("empty string", () => {
    expect(escapeAscii("")).toBe("");
  });
});

describe("escapeAscii (re-exported)", () => {
  test("same function reference", () => {
    expect(escapeAsciiReexport).toBe(escapeAscii);
  });
});

describe("formatWarpSequence", () => {
  test("legacy format with subtitle", () => {
    const seq = formatWarpSequence({ title: "T", subtitle: "S", message: "M" });
    expect(seq).toBe("\x1b]777;notify;T;S — M\x07");
  });
  test("legacy format without subtitle", () => {
    const seq = formatWarpSequence({ title: "T", subtitle: "", message: "M" });
    expect(seq).toBe("\x1b]777;notify;T;M\x07");
  });
  test("escapes semicolons in title/body", () => {
    const seq = formatWarpSequence({ title: "a;b", subtitle: "", message: "c;d" });
    expect(seq).toContain("a\\;b");
    expect(seq).toContain("c\\;d");
  });
});

describe("formatWarpAgentSequence", () => {
  test("produces structured payload", () => {
    const seq = formatWarpAgentSequence("stop", { response: "hi" });
    expect(seq.startsWith("\x1b]777;notify;warp://cli-agent;")).toBe(true);
    expect(seq.endsWith("\x07")).toBe(true);
    expect(seq).toContain('"event":"stop"');
    expect(seq).toContain('"response":"hi"');
  });
  test("escapes semicolons in payload", () => {
    const seq = formatWarpAgentSequence("stop", { response: "a;b" });
    expect(seq).toContain("\\u003b");
    expect(seq).not.toContain("a;b");
  });
});

describe("planWarpSequences", () => {
  test("legacy path when no protocol", () => {
    const seqs = planWarpSequences(
      { title: "T", subtitle: "S", message: "M" },
      { hasProtocol: false, sessionRegistered: false },
    );
    expect(seqs).toHaveLength(1);
    expect(seqs[0]).toBe("\x1b]777;notify;T;S — M\x07");
  });
  test("protocol path registers session once", () => {
    resetWarpSession();
    const seqs1 = planWarpSequences(
      { title: "T", subtitle: "", message: "M" },
      { hasProtocol: true, sessionRegistered: false },
    );
    // session_start + prompt_submit + stop
    expect(seqs1).toHaveLength(3);
    expect(seqs1[0]).toContain('"event":"session_start"');
    expect(seqs1[1]).toContain('"event":"prompt_submit"');
    expect(seqs1[2]).toContain('"event":"stop"');

    const seqs2 = planWarpSequences(
      { title: "T", subtitle: "", message: "M" },
      { hasProtocol: true, sessionRegistered: true },
    );
    expect(seqs2).toHaveLength(1);
    expect(seqs2[0]).toContain('"event":"stop"');
  });
});

describe("resetWarpSession", () => {
  test("resets flag without throwing", () => {
    expect(() => resetWarpSession()).not.toThrow();
  });
});

describe("sendWarpNotification / sendMacOSNotification (smoke)", () => {
  test("sendWarpNotification does not throw", () => {
    expect(() =>
      sendWarpNotification({ title: "T", subtitle: "S", message: "M" }),
    ).not.toThrow();
  });
  test("sendMacOSNotification does not throw (osascript may be absent)", () => {
    expect(() =>
      sendMacOSNotification({ title: "T", subtitle: "S", message: "M" }),
    ).not.toThrow();
  });
});

describe("writeOscSequence (smoke)", () => {
  test("does not throw", () => {
    expect(() => writeOscSequence("\x1b]777;notify;T;M\x07")).not.toThrow();
  });
});
