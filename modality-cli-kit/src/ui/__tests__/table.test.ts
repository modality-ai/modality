import { describe, expect, test, spyOn } from "bun:test";
import { displayWidth } from "../displayWidth";
import { pad, renderTable } from "../table";

// ── pad ──────────────────────────────────────────────────────────────────────

describe("pad — basic alignment", () => {
  test("left-pad ASCII", () => expect(pad("hi", 5)).toBe("hi   "));
  test("right-pad ASCII", () => expect(pad("hi", 5, "right")).toBe("   hi"));
  test("exact width returns value unchanged", () => expect(pad("hi", 2)).toBe("hi"));
});

describe("pad — CJK alignment", () => {
  test("CJK padded left to display width 8", () => {
    // "停更" = display width 4, needs 4 spaces.
    expect(pad("停更", 8)).toBe("停更    ");
  });
  test("CJK right-aligned", () => {
    expect(pad("停更", 8, "right")).toBe("    停更");
  });
});

describe("pad — emoji alignment", () => {
  test("⏸停更 padded to display width 8 → 5 chars + 3 spaces", () => {
    expect(pad("⏸停更", 8)).toBe("⏸停更   ");
  });
  test("⚡ padded to display width 4 → ⚡ + 2 spaces", () => {
    expect(pad("⚡", 4)).toBe("⚡  ");
  });
});

// ── renderTable — integration with emoji rows ────────────────────────────────

describe("renderTable — column alignment with emoji in cells", () => {
  test("rows with ⏸停更 in one column don't break alignment", () => {
    const logs: string[] = [];
    const spy = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.join(" "));
    });

    renderTable(
      ["代號", "異常"],
      [
        ["FX:USDTWD", "⚡"],
        ["CBOE:VX1!", "⏸停更"],
        ["00697B", ""],
      ],
    );

    spy.mockRestore();

    // All data rows should have the same right-border position.
    const borders = logs.filter((l) => l.startsWith("│"));
    if (borders.length >= 2) {
      // Right border │ should be at same display width for every row.
      const widths = borders.map((l) => {
        const trimmed = l.endsWith("│") ? l.slice(0, -1) : l;
        return displayWidth(trimmed) + 1; // +1 for the trailing │
      });
      const first = widths[0]!;
      for (const w of widths) {
        expect(w).toBe(first);
      }
    }
  });
});
