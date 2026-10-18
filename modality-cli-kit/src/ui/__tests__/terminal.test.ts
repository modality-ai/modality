import { describe, expect, test, spyOn } from "bun:test";
import * as terminal from "../terminal";
import {
  CURSOR_HOME,
  HIDE_CURSOR,
  SHOW_CURSOR,
  CLEAR_SCREEN,
  CLEAR_BELOW,
  SET_TITLE,
  BELL,
  sleep,
  draw,
  writeTitle,
  refreshingStatus,
  nextTickStatus,
  watchCountdown,
  taipeiClock,
  liveStatus,
  errorStatus,
  termWidth,
} from "../terminal";

describe("terminal — escape code constants", () => {
  test("CURSOR_HOME moves cursor to top-left", () =>
    expect(CURSOR_HOME).toBe("\x1b[H"));
  test("HIDE_CURSOR hides cursor", () =>
    expect(HIDE_CURSOR).toBe("\x1b[?25l"));
  test("SHOW_CURSOR shows cursor", () =>
    expect(SHOW_CURSOR).toBe("\x1b[?25h"));
  test("CLEAR_SCREEN clears entire screen", () =>
    expect(CLEAR_SCREEN).toBe("\x1b[2J"));
  test("CLEAR_BELOW clears to end of screen", () =>
    expect(CLEAR_BELOW).toBe("\x1b[0J"));
  test("SET_TITLE is OSC 0 escape", () => expect(SET_TITLE).toBe("\x1b]0;"));
  test("BELL is ASCII 0x07", () => expect(BELL).toBe("\x07"));
});

describe("terminal — sleep", () => {
  test("returns a Promise", () => {
    const result = sleep(1);
    expect(result).toBeInstanceOf(Promise);
  });

  test("resolves after the given ms", async () => {
    const start = performance.now();
    await sleep(10);
    expect(performance.now() - start).toBeGreaterThanOrEqual(5);
  });
});

describe("terminal — draw", () => {
  test("writes CURSOR_HOME + cleared lines + CLEAR_BELOW", () => {
    const write = spyOn(process.stdout, "write").mockImplementation(() => true);

    draw("hello\nworld");

    // First call: CURSOR_HOME + "hello\x1b[K\nworld\x1b[K\n" + CLEAR_BELOW
    const callArg = write.mock.calls[0]?.[0] as string;
    expect(callArg).toStartWith(CURSOR_HOME);
    expect(callArg).toContain("hello\x1b[K");
    expect(callArg).toContain("world\x1b[K");
    expect(callArg).toEndWith(CLEAR_BELOW);

    write.mockRestore();
  });

  test("single line is wrapped with clear-to-EOL", () => {
    const write = spyOn(process.stdout, "write").mockImplementation(() => true);

    draw("hello");

    const callArg = write.mock.calls[0]?.[0] as string;
    expect(callArg).toContain("hello\x1b[K");

    write.mockRestore();
  });
});

describe("terminal — writeTitle", () => {
  test("writes SET_TITLE + title + BELL to stdout", () => {
    const spy = spyOn(process.stdout, "write").mockImplementation(() => true);
    writeTitle("test-title");
    expect(spy).toHaveBeenCalledWith(`${SET_TITLE}test-title${BELL}`);
    spy.mockRestore();
  });

  test("works with emoji in title", () => {
    const spy = spyOn(process.stdout, "write").mockImplementation(() => true);
    writeTitle("🟢 🔴  TXF  09:28");
    expect(spy).toHaveBeenCalledWith(`${SET_TITLE}🟢 🔴  TXF  09:28${BELL}`);
    spy.mockRestore();
  });

  test("works with empty title", () => {
    const spy = spyOn(process.stdout, "write").mockImplementation(() => true);
    writeTitle("");
    expect(spy).toHaveBeenCalledWith(`${SET_TITLE}${BELL}`);
    spy.mockRestore();
  });
});

describe("terminal — refreshingStatus", () => {
  test("plain form without a timestamp", () =>
    expect(refreshingStatus()).toBe("[Refreshing...]"));

  test("timestamped form appends the Taipei clock string", () =>
    expect(refreshingStatus("06:48:12")).toBe("[Refreshing  06:48:12]"));
});

describe("terminal — nextTickStatus", () => {
  test("pads the remaining seconds to the interval's width", () => {
    // interval 10 → width 2: " 5" aligns under "10"
    expect(nextTickStatus("[Live  09:00:00]", 5, 10)).toBe(
      "[Live  09:00:00]  next:  5s"
    );
    expect(nextTickStatus("[Live  09:00:00]", 10, 10)).toBe(
      "[Live  09:00:00]  next: 10s"
    );
  });

  test("single-digit interval keeps no padding", () =>
    expect(nextTickStatus("[Live  09:00:00]", 2, 5)).toBe(
      "[Live  09:00:00]  next: 2s"
    ));

  test("three-digit interval pads to width 3", () =>
    expect(nextTickStatus("[Live  09:00:00]", 5, 100)).toBe(
      "[Live  09:00:00]  next:   5s"
    ));
});

describe("terminal — taipeiClock", () => {
  test("returns a Taipei HH:MM:SS clock string", () =>
    expect(taipeiClock()).toMatch(/^\d{2}:\d{2}:\d{2}$/));
});

describe("terminal — liveStatus", () => {
  test("wraps the clock string in the live label", () =>
    expect(liveStatus("06:48:12")).toBe("[Live  06:48:12]"));
});

describe("terminal — errorStatus", () => {
  test("keeps short messages whole", () =>
    expect(errorStatus("boom", "06:48:12")).toBe("[Error: boom  06:48:12]"));

  test("truncates messages longer than 50 chars", () =>
    expect(errorStatus("a".repeat(60), "06:48:12")).toBe(
      `[Error: ${"a".repeat(50)}  06:48:12]`
    ));

  test("keeps messages exactly 50 chars", () =>
    expect(errorStatus("a".repeat(50), "06:48:12")).toBe(
      `[Error: ${"a".repeat(50)}  06:48:12]`
    ));
});

describe("terminal — watchCountdown", () => {
  test("ticks from interval down to 1, once per second", async () => {
    const sleepSpy = spyOn(terminal, "sleep").mockImplementation(() =>
      Promise.resolve()
    );
    const ticks: number[] = [];
    await watchCountdown(3, (t) => ticks.push(t));
    expect(ticks).toEqual([3, 2, 1]);
    expect(sleepSpy).toHaveBeenCalledTimes(3);
    sleepSpy.mockRestore();
  });

  test("interval 1 fires a single tick", async () => {
    const sleepSpy = spyOn(terminal, "sleep").mockImplementation(() =>
      Promise.resolve()
    );
    const ticks: number[] = [];
    await watchCountdown(1, (t) => ticks.push(t));
    expect(ticks).toEqual([1]);
    expect(sleepSpy).toHaveBeenCalledTimes(1);
    sleepSpy.mockRestore();
  });
});

describe("terminal — termWidth", () => {
  test("returns columns minus 1 when stdout is a TTY", () => {
    const orig = process.stdout.columns;
    Object.defineProperty(process.stdout, "columns", { value: 120, configurable: true });
    expect(termWidth()).toBe(119);
    Object.defineProperty(process.stdout, "columns", { value: orig, configurable: true });
  });

  test("falls back to 119 when columns is undefined (non-TTY)", () => {
    const orig = process.stdout.columns;
    Object.defineProperty(process.stdout, "columns", { value: undefined, configurable: true });
    expect(termWidth()).toBe(119);  // (120 - 1)
    Object.defineProperty(process.stdout, "columns", { value: orig, configurable: true });
  });

  test("floors at 40 for very narrow terminals", () => {
    const orig = process.stdout.columns;
    Object.defineProperty(process.stdout, "columns", { value: 30, configurable: true });
    expect(termWidth()).toBe(40);
    Object.defineProperty(process.stdout, "columns", { value: orig, configurable: true });
  });
});
