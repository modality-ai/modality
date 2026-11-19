import { describe, expect, test, spyOn } from "bun:test";
import { displayWidth } from "../displayWidth";
import { pad, renderTable, wrapToWidth } from "../table";

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

// ── renderTable — RWD: grid / card layout switch ─────────────────────────────

describe("renderTable — RWD", () => {
  test("wide-enough width renders grid", () => {
    const logs: string[] = [];
    const spy = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.join(" "));
    });
    renderTable(["A", "B"], [["1", "2"]], { width: 40 });
    spy.mockRestore();
    expect(logs[0]).toBe("┌───┬───┐");
    expect(logs[1]).toBe("│ A │ B │");
  });

  test("slightly-too-narrow width shrinks a wide column but stays grid", () => {
    const logs: string[] = [];
    const spy = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.join(" "));
    });
    // "left-word longword" (17) + "x" (1) + overhead 7 = 25 natural; cap at 20.
    renderTable(["L", "R"], [["left-word longword", "x"]], { width: 20 });
    spy.mockRestore();
    expect(logs[0]!.startsWith("┌")).toBe(true);
    expect(logs.some((l) => l.includes("longword"))).toBe(true);
  });

  test("too-narrow width falls back to card layout", () => {
    const logs: string[] = [];
    const spy = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.join(" "));
    });
    renderTable(
      ["Round", "Gate"],
      [["1", "ACCEPT_NEW_BEST"]],
      { width: 24 },
    );
    spy.mockRestore();
    // No grid borders at all.
    expect(logs.every((l) => !l.startsWith("┌"))).toBe(true);
    // Colon attached to the label, value on the same line.
    const cards = logs.filter((l) => l.includes(":"));
    expect(cards[0]).toBe("Round: 1");
    expect(cards[1]).toBe("Gate: ACCEPT_NEW_BEST");
    // Short rule between rows.
    expect(logs.at(-1)).toMatch(/^─+$/);
  });

  test("card mode handles CJK labels", () => {
    const logs: string[] = [];
    const spy = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.join(" "));
    });
    renderTable(["Round", "動作"], [["1", "x"]], { width: 10 });
    spy.mockRestore();
    expect(logs).toContain("Round: 1");
    expect(logs).toContain("動作: x");
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

// ── wrapToWidth — word wrap ──────────────────────────────────────────────────

describe("wrapToWidth — word wrap", () => {
  test("breaks at the last space instead of mid-word", () => {
    expect(wrapToWidth("hello world foo", 10)).toEqual(["hello", "world foo"]);
  });

  test("returns the input unchanged when it already fits", () => {
    expect(wrapToWidth("short", 10)).toEqual(["short"]);
  });
});
