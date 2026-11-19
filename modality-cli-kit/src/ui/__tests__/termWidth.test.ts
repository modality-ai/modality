import { describe, expect, test } from "bun:test";
import { termWidth } from "../termWidth";

describe("termWidth", () => {
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
