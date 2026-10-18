// Display-width calculation for CLI text — CJK, emoji, and ANSI-aware.
//
// Each codepoint maps to either 1 (ASCII/narrow) or 2 (wide/emoji) terminal
// columns. ANSI escape sequences and variation selectors (FE0F, ZWJ) are
// stripped before measurement.

import { stripAnsi } from "./strip-ansi";

function isWide(codePoint: number): boolean {
  return codePoint >= 0x1100 && (
    codePoint <= 0x115f ||
    codePoint === 0x2329 ||
    codePoint === 0x232a ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x1f300 && codePoint <= 0x1faff)
  );
}

// Sorted BMP [start, end] pairs from Unicode Emoji_Presentation property (emoji-data.txt).
// Characters here default to emoji (2-column) presentation without a FE0F variation selector.
// Notably excludes U+26A0 (⚠ WARNING SIGN) which is Emoji but NOT Emoji_Presentation.
// Excludes U+23F8..U+23FA (⏸⏹⏺ media control symbols) — Emoji_Presentation in Unicode but
// macOS terminals render them as width 1, causing column misalignment in tables.
// Out of scope: regional-indicator flags (0x1F1E6..0x1F1FF) and other SMP emoji codepoints —
// the broad SMP block 0x1F300..0x1FAFF is handled by isWide() and not duplicated here.
const EMOJI_PRESENTATION: readonly [number, number][] = [
  [0x231a, 0x231b], [0x23e9, 0x23f3],
  [0x25aa, 0x25ab], [0x25b6, 0x25b6], [0x25c0, 0x25c0],
  [0x25fb, 0x25fe], [0x2600, 0x2604], [0x260e, 0x260e],
  [0x2611, 0x2611], [0x2614, 0x2615], [0x2618, 0x2618],
  [0x261d, 0x261d], [0x2620, 0x2620], [0x2622, 0x2623],
  [0x2626, 0x2626], [0x262a, 0x262a], [0x262e, 0x262f],
  [0x2638, 0x263a], [0x2640, 0x2640], [0x2642, 0x2642],
  [0x2648, 0x2653], [0x265f, 0x2660], [0x2663, 0x2663],
  [0x2665, 0x2666], [0x2668, 0x2668], [0x267b, 0x267b],
  [0x267e, 0x267f], [0x2692, 0x2697], [0x2699, 0x2699],
  [0x269b, 0x269c],
  [0x26a1, 0x26a1],          // ⚡ included; 0x26a0 ⚠ intentionally absent
  [0x26aa, 0x26ab], [0x26b0, 0x26b1], [0x26bd, 0x26be],
  [0x26c4, 0x26c5], [0x26ce, 0x26cf], [0x26d1, 0x26d1],
  [0x26d3, 0x26d4],          // includes ⛔ 0x26d4
  [0x26e9, 0x26ea], [0x26f0, 0x26f5],
  [0x26f7, 0x26fa], [0x26fd, 0x26fd], [0x2702, 0x2702],
  [0x2705, 0x2705], [0x2708, 0x270d], [0x270f, 0x270f],
  [0x2712, 0x2712], [0x2714, 0x2714], [0x2716, 0x2716],
  [0x271d, 0x271d], [0x2721, 0x2721], [0x2728, 0x2728],
  [0x2733, 0x2734], [0x2744, 0x2744], [0x2747, 0x2747],
  [0x274c, 0x274c], [0x274e, 0x274e], [0x2753, 0x2755],
  [0x2757, 0x2757], [0x2763, 0x2764], [0x2795, 0x2797],
  [0x27a1, 0x27a1], [0x27b0, 0x27b0], [0x27bf, 0x27bf],
  [0x2934, 0x2935], [0x2b05, 0x2b07], [0x2b1b, 0x2b1c],
  [0x2b50, 0x2b50], [0x2b55, 0x2b55], [0x3030, 0x3030],
  [0x303d, 0x303d], [0x3297, 0x3297], [0x3299, 0x3299],
];

function isEmojiPresentation(codePoint: number): boolean {
  let lo = 0, hi = EMOJI_PRESENTATION.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [start, end] = EMOJI_PRESENTATION[mid]!;
    if (codePoint < start) hi = mid - 1;
    else if (codePoint > end) lo = mid + 1;
    else return true;
  }
  return false;
}

const segmenter = new Intl.Segmenter("und", { granularity: "grapheme" });

// Pure combining characters and zero-width codes (width 0 when isolated)
function isZeroWidthCodePoint(cp: number): boolean {
  return (
    (cp >= 0x0300 && cp <= 0x036f) || // Combining Diacritical Marks
    (cp >= 0x1ab0 && cp <= 0x1aff) || // Combining Diacritical Marks Extended
    (cp >= 0x1dc0 && cp <= 0x1dff) || // Combining Diacritical Marks Supplement
    (cp >= 0x20d0 && cp <= 0x20ff) || // Combining Diacritical Marks for Symbols
    (cp >= 0xfe20 && cp <= 0xfe2f) || // Combining Half Marks
    cp === 0x200b ||                  // Zero Width Space
    cp === 0x200c ||                  // Zero Width Non-Joiner
    cp === 0x200d ||                  // Zero Width Joiner
    cp === 0xfe0f ||                  // Variation Selector-16 (emoji presentation)
    cp === 0xfeff                     // Zero Width No-Break Space (BOM)
  );
}

// Check if code point is a Fitzpatrick skin tone modifier (U+1F3FB..U+1F3FF)
function isSkinToneModifier(cp: number): boolean {
  return cp >= 0x1f3fb && cp <= 0x1f3ff;
}

/** Measure the terminal column width of a single grapheme cluster. */
function graphemeWidth(segment: string): number {
  const firstCp = segment.codePointAt(0) ?? 0;

  // 1. ZWJ sequence (e.g. 👨‍👩‍👧‍👦, 🏳️‍🌈, a‍b) — multi-char only; an isolated
  //    ZWJ (U+200D) is a zero-width control, not a sequence.
  if (segment.length > 1 && segment.includes("‍")) {
    // If the ZWJ connects standard characters (e.g. "a‍b" where 'b' is attached to 'a'),
    // base display width on the leading character.
    return isEmojiPresentation(firstCp) || isWide(firstCp) ? 2 : 1;
  }

  // 2. Emoji variation selector (FE0F) upgrades width-1 non-ASCII symbols
  //    (e.g. ⏸️, ⚠️) to 2 — multi-char only; an isolated FE0F is zero-width.
  if (segment.length > 1 && segment.includes("️")) {
    return firstCp > 0x7f ? 2 : 1;
  }

  // 3. Isolated zero-width code point
  if (segment.length === 1 && isZeroWidthCodePoint(firstCp)) {
    return 0;
  }

  // 4. Skin tone modifier alone should not occupy extra wide column
  if (isSkinToneModifier(firstCp)) {
    return 0;
  }

  // 5. Regional-indicator pair (country flag, e.g. 🇹🇼) — RIs merge only into
  //    flags, so a segment whose first TWO code points are RIs IS a flag.
  //    isWide excludes RI on purpose (a lone RI is width 1), so check both
  //    code points here. codePointAt(2) is the second one (each RI is a
  //    surrogate pair, i.e. 2 UTF-16 units).
  const secondCp = segment.codePointAt(2) ?? 0;
  if (
    firstCp >= 0x1f1e6 && firstCp <= 0x1f1ff &&
    secondCp >= 0x1f1e6 && secondCp <= 0x1f1ff
  ) {
    return 2;
  }

  // 6. Broad emoji / wide character presentation
  if (isEmojiPresentation(firstCp) || isWide(firstCp)) {
    return 2;
  }

  return 1;
}

/** Measure the terminal column width of `value`, stripping ANSI escapes. */
export function displayWidth(value: string): number {
  const clean = stripAnsi(value);
  if (!clean) return 0;

  let width = 0;
  for (const { segment } of segmenter.segment(clean)) {
    width += graphemeWidth(segment);
  }
  return width;
}

/** Character-level width — 2 for wide/emoji, 1 otherwise, 0 for zero-width
 *  codes (combining marks, ZWJ/FE0F/BOM, isolated skin tones) so truncate/wrap
 *  agree with displayWidth's grapheme-level model on those codepoints. */
export function charWidth(codePoint: number): number {
  if (isZeroWidthCodePoint(codePoint) || isSkinToneModifier(codePoint)) return 0;
  return isEmojiPresentation(codePoint) || isWide(codePoint) ? 2 : 1;
}
