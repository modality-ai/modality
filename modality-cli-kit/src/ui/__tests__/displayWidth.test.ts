import { describe, expect, test } from "bun:test";
import { displayWidth, charWidth } from "../displayWidth";

// Unit tests for the terminal-width model in ../displayWidth.
//
// Two layers are covered:
//   • displayWidth() — grapheme-cluster measurement of a whole string
//   • charWidth()    — per-code-point measurement used by table truncation
//
// Every expectation below encodes a deliberate rendering decision from the
// source (the EMOJI_PRESENTATION table, isWide, and isZeroWidthCodePoint), not
// an incidental value — so a failure here means a real alignment regression.

describe("displayWidth — ASCII baseline", () => {
  test("empty string → 0", () => expect(displayWidth("")).toBe(0));
  test("pure ASCII → character count", () => expect(displayWidth("hello")).toBe(5));
  test("digits and punctuation", () => expect(displayWidth("32.20")).toBe(5));
  test("spaces count as width 1", () => expect(displayWidth("  ")).toBe(2));
});

describe("displayWidth — CJK characters (width 2)", () => {
  test("single CJK character", () => expect(displayWidth("停")).toBe(2));
  test("two CJK characters", () => expect(displayWidth("停更")).toBe(4));
  test("mixed ASCII + CJK", () => expect(displayWidth("代號")).toBe(4));
  test("longer CJK string", () => expect(displayWidth("外匯資金流向")).toBe(12));
});

describe("displayWidth — media control emoji", () => {
  // U+23F8 ⏸ DOUBLE VERTICAL BAR — Emoji_Presentation in Unicode but macOS
  // terminals render bare U+23F8 as width 1. Excluded from EMOJI_PRESENTATION
  // table. With FE0F (emoji variation selector) the terminal renders 2 cells.
  test("⏸ (U+23F8) → width 1", () => expect(displayWidth("⏸")).toBe(1));

  // U+23F9 ⏹ BLACK SQUARE FOR STOP — same exclusion range.
  test("⏹ (U+23F9) → width 1", () => expect(displayWidth("⏹")).toBe(1));

  // U+23FA ⏺ BLACK CIRCLE FOR RECORD — same exclusion range.
  test("⏺ (U+23FA) → width 1", () => expect(displayWidth("⏺")).toBe(1));

  // The real-world combo from the FX command flag.
  test("⏸停更 → 1 + 2 + 2 = 5", () => expect(displayWidth("⏸停更")).toBe(5));
});

describe("displayWidth — BMP emoji presentation (width 2)", () => {
  // U+26A1 ⚡ HIGH VOLTAGE — still in EMOJI_PRESENTATION, renders width 2.
  test("⚡ (U+26A1) → width 2", () => expect(displayWidth("⚡")).toBe(2));

  // U+25B6 ▶ BLACK RIGHT-POINTING TRIANGLE — still in EMOJI_PRESENTATION.
  test("▶ (U+25B6) → width 2", () => expect(displayWidth("▶")).toBe(2));

  // U+2600 ☀ BLACK SUN WITH RAYS — still in EMOJI_PRESENTATION.
  test("☀ (U+2600) → width 2", () => expect(displayWidth("☀")).toBe(2));
});

describe("displayWidth — SMP emoji (width 2 via isWide)", () => {
  // U+1F534 🔴 RED CIRCLE — SMP, handled by isWide's 0x1f300..0x1faff range.
  test("🔴 (U+1F534) → width 2", () => expect(displayWidth("🔴")).toBe(2));

  // U+1F7E2 🟢 GREEN CIRCLE — same SMP range.
  test("🟢 (U+1F7E2) → width 2", () => expect(displayWidth("🟢")).toBe(2));
});

describe("displayWidth — directional arrows (width 1)", () => {
  // U+2191 ↑ UPWARDS ARROW — not in EMOJI_PRESENTATION, not in isWide.
  test("↑ (U+2191) → width 1", () => expect(displayWidth("↑")).toBe(1));
  test("↓ (U+2193) → width 1", () => expect(displayWidth("↓")).toBe(1));
  test("→ (U+2192) → width 1", () => expect(displayWidth("→")).toBe(1));
});

describe("displayWidth — variation selectors", () => {
  // FE0F (VS16) after a width-1 non-ASCII char upgrades it to width 2
  // (emoji presentation mode in the terminal).
  test("⏸\\uFE0F → width 2", () => expect(displayWidth("⏸️")).toBe(2));
  // ⚠ (U+26A0) is NOT in EMOJI_PRESENTATION but FE0F makes it width 2.
  test("⚠\\uFE0F → width 2", () => expect(displayWidth("⚠️")).toBe(2));
  // FE0F after an already-wide char is a no-op.
  test("🍅\\uFE0F still → width 2", () => expect(displayWidth("🍅️")).toBe(2));
  // ZWJ (U+200D) should not add width.
  test("ZWJ between chars not counted", () => expect(displayWidth("a‍b")).toBe(2));
  // Complex emoji: skin tone modifier should keep width 2.
  test("thumbs up with skin tone → width 2", () => expect(displayWidth("👍🏽")).toBe(2));
  // ZWJ sequence emoji (family) → width 2.
  test("family ZWJ sequence → width 2", () => expect(displayWidth("👨‍👩‍👧‍👦")).toBe(2));
  // Combining accent mark does not add width.
  test("combining accent on ASCII → width 1", () => expect(displayWidth("é")).toBe(1));
  // Isolated zero-width code points (no base to attach to) → width 0.
  test("isolated combining accent (U+0301) → width 0", () => expect(displayWidth("́")).toBe(0));
  test("isolated skin tone modifier (U+1F3FD) → width 0", () => expect(displayWidth("\u{1F3FD}")).toBe(0));
  // Isolated ZWJ / FE0F must not gain width from the ZWJ / FE0F branches.
  test("isolated ZWJ (U+200D) → width 0", () => expect(displayWidth("‍")).toBe(0));
  test("isolated FE0F (U+FE0F) → width 0", () => expect(displayWidth("️")).toBe(0));
  // Regional-indicator flag pair → width 2 (the grapheme merge must not halve it).
  test("flag 🇹🇼 → width 2", () => expect(displayWidth("🇹🇼")).toBe(2));
  // A lone regional indicator stays width 1 (isWide excludes RI on purpose).
  test("lone regional indicator (U+1F1F9) → width 1", () => expect(displayWidth("\u{1F1F9}")).toBe(1));
  // ZWJ between WIDE chars: the leading CJK char keeps width 2 and the
  // trailing "文" keeps width 2 — the ZWJ branch must not collapse it to one.
  test("CJK + ZWJ (中‍文) → 2 + 2 = 4", () => expect(displayWidth("中‍文")).toBe(4));
  // Remaining isolated zero-width code points in isZeroWidthCodePoint that
  // aren't covered above — BOM (U+FEFF) is the risky one: a file-read output
  // carrying a BOM must not shift table alignment by 1.
  test("isolated ZWSP (U+200B) → width 0", () => expect(displayWidth("​")).toBe(0));
  test("isolated ZWNJ (U+200C) → width 0", () => expect(displayWidth("‌")).toBe(0));
  test("isolated BOM (U+FEFF) → width 0", () => expect(displayWidth("﻿")).toBe(0));
  // One representative per Combining block in isZeroWidthCodePoint: U+0300,
  // U+1AB0, U+20D0 (combining for symbols), U+FE20 (combining half marks).
  test("isolated combining U+0300 → width 0", () => expect(displayWidth("̀")).toBe(0));
  test("isolated combining U+1AB0 → width 0", () => expect(displayWidth("᪰")).toBe(0));
  test("isolated combining U+20D0 → width 0", () => expect(displayWidth("⃐")).toBe(0));
  test("isolated combining U+FE20 → width 0", () => expect(displayWidth("︠")).toBe(0));
  // Flag followed by a lone RI: the flag pair consumes 2 cells, the lone RI
  // stays 1 — total 3.
  test("flag + lone RI (🇹🇼🇹) → 2 + 1 = 3", () => expect(displayWidth("🇹🇼\u{1F1F9}")).toBe(3));
  // Flag pair followed by ZWNJ stays 2 — the RI-pair branch must not be
  // disturbed by a trailing zero-width code point inside the same cluster.
  test("flag + ZWNJ (🇹🇼‌) → 2", () => expect(displayWidth("🇹🇼‌")).toBe(2));
});

describe("displayWidth — ANSI escape sequences stripped", () => {
  test("red ANSI text width = plain text width", () => {
    expect(displayWidth("\x1b[31mhello\x1b[0m")).toBe(5);
  });
  test("CJK with ANSI", () => {
    expect(displayWidth("\x1b[1m停更\x1b[0m")).toBe(4);
  });
});

// ── charWidth — code-point level ─────────────────────────────────────────────
//
// charWidth is the per-codepoint counterpart displayWidth uses when truncating.
// Built via String.fromCodePoint so the source stays ASCII-clean rather than
// embedding invisible literals.

const cp = (s: string): number => s.codePointAt(0) ?? 0;

describe("charWidth — narrow (width 1)", () => {
  test("ASCII letter", () => expect(charWidth(0x61)).toBe(1));           // a
  test("digit", () => expect(charWidth(0x39)).toBe(1));                  // 9
  test("space", () => expect(charWidth(0x20)).toBe(1));
  // Excluded from EMOJI_PRESENTATION on purpose — see the mirror case below.
  test("⚠ (U+26A0) is NOT emoji presentation", () => expect(charWidth(0x26a0)).toBe(1));
  test("⏸ (U+23F8) media control excluded", () => expect(charWidth(0x23f8)).toBe(1));
  test("↑ (U+2191) arrow not widened", () => expect(charWidth(0x2191)).toBe(1));
  // isWide deliberately excludes regional indicators (a lone RI is width 1).
  test("lone regional indicator (U+1F1F9)", () => expect(charWidth(0x1f1f9)).toBe(1));
});

describe("charWidth — wide (width 2)", () => {
  test("CJK 停 (U+505C)", () => expect(charWidth(0x505c)).toBe(2));
  test("Hangul 가 (U+AC00)", () => expect(charWidth(0xac00)).toBe(2));
  test("fullwidth Ａ (U+FF21)", () => expect(charWidth(0xff21)).toBe(2));
  test("⚡ (U+26A1) is emoji presentation", () => expect(charWidth(0x26a1)).toBe(2));
  test("▶ (U+25B6) is emoji presentation", () => expect(charWidth(0x25b6)).toBe(2));
  test("🔴 (U+1F534) wide via SMP range", () => expect(charWidth(0x1f534)).toBe(2));
});

describe("charWidth — zero width", () => {
  test("combining U+0300", () => expect(charWidth(0x0300)).toBe(0));
  test("combining U+1AB0", () => expect(charWidth(0x1ab0)).toBe(0));
  test("combining U+1DC0", () => expect(charWidth(0x1dc0)).toBe(0));
  test("combining for symbols U+20D0", () => expect(charWidth(0x20d0)).toBe(0));
  test("combining half mark U+FE20", () => expect(charWidth(0xfe20)).toBe(0));
  test("ZWSP U+200B", () => expect(charWidth(0x200b)).toBe(0));
  test("ZWNJ U+200C", () => expect(charWidth(0x200c)).toBe(0));
  test("ZWJ U+200D", () => expect(charWidth(0x200d)).toBe(0));
  test("FE0F variation selector", () => expect(charWidth(0xfe0f)).toBe(0));
  test("BOM U+FEFF", () => expect(charWidth(0xfeff)).toBe(0));
  test("skin tone U+1F3FD", () => expect(charWidth(0x1f3fd)).toBe(0));
});

// The two layers agree on every non-clustering single code point. They diverge
// only where grapheme clustering merges code points — a regional-indicator pair
// is displayWidth 2 from two charWidth-1 halves, and "a" + ZWJ + "b" is
// displayWidth 2 across three code points (covered above).
describe("displayWidth / charWidth agreement on single code points", () => {
  const singles: Array<[string, number]> = [
    ["a", 0x61],
    ["停", 0x505c],
    ["⚡", 0x26a1],
    ["▶", 0x25b6],
    ["🔴", 0x1f534],
    ["↑", 0x2191],
    ["⏸", 0x23f8],
    ["combining U+0301", 0x0301],
    ["ZWJ", 0x200d],
    ["FE0F", 0xfe0f],
    ["BOM", 0xfeff],
    ["skin tone", 0x1f3fd],
  ];

  for (const [label, codePoint] of singles) {
    test(`${label} → displayWidth === charWidth`, () => {
      expect(displayWidth(String.fromCodePoint(codePoint))).toBe(charWidth(codePoint));
    });
  }
});
