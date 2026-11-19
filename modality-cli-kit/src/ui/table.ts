// CLI text-art table renderer with CJK + emoji width handling.
// Inspired by coco-shell's Table, kept functional rather than class-based.

import { displayWidth, charWidth } from "./displayWidth";
import { termWidth } from "./termWidth";
import { stripAnsi } from "./strip-ansi";

export type Align = "left" | "right";

export interface TableOptions {
  align?: Align[];
  /**
   * Usable width for RWD rendering. Defaults to `termWidth()` on a TTY;
   * piped (non-TTY) output stays unbounded and always uses grid layout.
   */
  width?: number;
}

function truncateToWidth(text: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";
  if (displayWidth(text) <= maxWidth) return text;
  let w = 0;
  let result = "";
  let i = 0;
  while (i < text.length) {
    if (text[i] === "\x1b" && text[i + 1] === "[") {
      const end = text.indexOf("m", i + 2);
      if (end !== -1) { result += text.slice(i, end + 1); i = end + 1; continue; }
    }
    const cp = text.codePointAt(i) ?? 0;
    const char = String.fromCodePoint(cp);
    const cw = charWidth(cp);
    if (w + cw > maxWidth - 1) break;
    w += cw;
    result += char;
    i += char.length;
  }
  // Never leave a dangling zero-width code point (combining mark, ZWJ,
  // variation selector) before the ellipsis — strip trailing zero-width chars.
  while (result.length > 0) {
    let idx = result.length - 1;
    if (idx > 0 && result.charCodeAt(idx) >= 0xdc00 && result.charCodeAt(idx) <= 0xdfff) idx--;
    const cp = result.codePointAt(idx) ?? 0;
    if (charWidth(cp) === 0) {
      result = result.slice(0, idx);
    } else {
      break;
    }
  }
  return result + "\x1b[0m…";
}

export function pad(value: string, width: number, align: Align = "left"): string {
  const gap = width - displayWidth(value);
  if (gap < 0)  return truncateToWidth(value, width);
  if (gap === 0) return value;
  return align === "right" ? " ".repeat(gap) + value : value + " ".repeat(gap);
}

const RESET = "\x1b[0m";

export function wrapToWidth(text: string, maxWidth: number): string[] {
  if (maxWidth <= 0 || displayWidth(text) <= maxWidth) return [text];
  const lines: string[] = [];
  let line = "";
  let width = 0;
  let openAnsi = false;
  let i = 0;
  while (i < text.length) {
    // Pass ANSI escape sequences through without counting their width.
    if (text[i] === "\x1b" && text[i + 1] === "[") {
      const end = text.indexOf("m", i + 2);
      if (end !== -1) {
        const seq = text.slice(i, end + 1);
        line += seq;
        openAnsi = seq !== RESET;
        i = end + 1;
        continue;
      }
    }
    const cp = text.codePointAt(i) ?? 0;
    const char = String.fromCodePoint(cp);
    const cw = charWidth(cp);
    if (width > 0 && width + cw > maxWidth) {
      // A space that doesn't fit simply ends the line — the line itself fits.
      if (char === " ") {
        lines.push(line.trimEnd() + (openAnsi ? RESET : ""));
        line = "";
        width = 0;
        openAnsi = false;
        i += char.length;
        continue;
      }
      // Prefer breaking at the last space on this line (word wrap); CJK and
      // unbroken runs fall back to a hard break.
      const cut = line.lastIndexOf(" ");
      if (cut > 0) {
        lines.push(line.slice(0, cut).trimEnd() + (openAnsi ? RESET : ""));
        line = line.slice(cut).replace(/^ /, "");
        // Recompute whether an ANSI style is still open on the carried-over
        // remainder so styling survives the word-wrap cut.
        const lastSeq = [...line.matchAll(/\x1b\\[[0-9;]*m/g)].pop()?.[0];
        openAnsi = !!lastSeq && lastSeq !== RESET;
        width = displayWidth(line);
        continue; // retry the current char against the moved-back line
      }
      lines.push(line.trimEnd() + (openAnsi ? RESET : ""));
      line = "";
      width = 0;
      openAnsi = false;
    }
    line += char;
    width += cw;
    i += char.length;
  }
  if (line) lines.push(line.trimEnd());
  return lines;
}

// ── RWD: grid vs card layout ─────────────────────────────────────────────────

// "│ " + cells joined by " │ " + " │" → 3 cells of border per column + 1.
const gridOverhead = (cols: number): number => cols * 3 + 1;

const gridWidth = (widths: number[]): number =>
  widths.reduce((a, b) => a + b, 0) + gridOverhead(widths.length);

/**
 * Display width of the longest unbreakable (space-separated) word — the floor
 * a column can shrink to in wide mode before its cells start wrapping mid-word.
 */
function longestWordWidth(text: string): number {
  let max = 0;
  for (const word of stripAnsi(text).split(/\s+/)) {
    if (!word) continue;
    const hasWide = [...word].some((ch) => (ch.codePointAt(0) ?? 0) > 0x7f);
    if (hasWide) {
      let charMax = 0;
      for (const ch of word) charMax = Math.max(charMax, charWidth(ch.codePointAt(0) ?? 0) || 1);
      max = Math.max(max, charMax || 1);
    } else {
      max = Math.max(max, displayWidth(word));
    }
  }
  return max || 1;
}

/**
 * Shrink the widest columns greedily until the grid fits `width`. Returns null
 * when every column is already at its longest-word floor and it still overflows.
 */
function fitWidths(widths: number[], mins: number[], width: number): number[] | null {
  const fitted = [...widths];
  let over = gridWidth(fitted) - width;
  while (over > 0) {
    let widest = -1;
    for (let i = 0; i < fitted.length; i++) {
      if (fitted[i]! > mins[i]! && (widest === -1 || fitted[i]! > fitted[widest]!)) widest = i;
    }
    if (widest === -1) return null;
    fitted[widest]!--;
    over--;
  }
  return fitted;
}

function renderGrid(
  headers: string[],
  rows: string[][],
  widths: number[],
  align: (i: number) => Align,
): void {
  const border = (left: string, mid: string, right: string) =>
    left + widths.map((w) => "─".repeat(w + 2)).join(mid) + right;

  // Wrap each cell to its column, then emit one physical line per row slice so
  // multi-line cells keep the grid intact. Headers wrap too — never truncated.
  const row = (cells: string[], alignOverride?: Align) => {
    const cellLines = cells.map((cell, i) => wrapToWidth(cell, widths[i] ?? 0));
    const height = Math.max(1, ...cellLines.map((l) => l.length));
    for (let ln = 0; ln < height; ln++) {
      console.log(
        "│ " +
          cellLines
            .map((l, i) => pad(l[ln] ?? "", widths[i] ?? 0, alignOverride ?? align(i)))
            .join(" │ ") +
          " │",
      );
    }
  };

  console.log(border("┌", "┬", "┐"));
  row(headers, "left");
  console.log(border("├", "┼", "┤"));
  for (const cells of rows) row(cells);
  console.log(border("└", "┴", "┘"));
}

/**
 * Narrow layout: each row becomes a `Header: value` card — one line per
 * header, rows separated by a short rule (Claude Code style). Header labels
 * are not padded, so colons follow each label directly.
 */
function renderCards(headers: string[], rows: string[][], width: number): void {
  for (const cells of rows) {
    headers.forEach((header, i) => {
      const valueStart = displayWidth(header) + 2; // ": " after the label
      const wrapped = wrapToWidth(cells[i] ?? "", Math.max(1, width - valueStart));
      console.log(header + ": " + wrapped[0]);
      const indent = " ".repeat(valueStart);
      for (let ln = 1; ln < wrapped.length; ln++) console.log(indent + wrapped[ln]);
    });
    console.log("─".repeat(Math.max(1, Math.floor(width / 2))));
  }
}

export function renderTable(headers: string[], rows: string[][], opts: TableOptions = {}): void {
  const width = opts.width ?? (process.stdout.isTTY ? termWidth() : Infinity);
  const widths = headers.map((header, i) => Math.max(
    1,
    displayWidth(header),
    ...rows.map((row) => displayWidth(row[i] ?? "")),
  ));
  const align = (i: number): Align => opts.align?.[i] ?? "left";

  if (gridWidth(widths) <= width) {
    renderGrid(headers, rows, widths, align);
    return;
  }
  // Too wide for the terminal: shrink wide columns down to their longest-word
  // floor (long cells wrap inside the grid). Still no fit → card layout.
  const mins = headers.map((header, i) => Math.max(
    1,
    longestWordWidth(header),
    ...rows.map((row) => longestWordWidth(row[i] ?? "")),
  ));
  const fitted = fitWidths(widths, mins, width);
  if (fitted) {
    renderGrid(headers, rows, fitted, align);
    return;
  }
  renderCards(headers, rows, width);
}

export function renderBox(title: string, lines: string[], width: number): string[] {
  const innerW  = width - 2;
  const top     = title
    ? `┌─ ${title} ${"─".repeat(Math.max(0, innerW - 3 - displayWidth(title)))}┐`
    : `┌${"─".repeat(innerW)}┐`;
  const bottom  = `└${"─".repeat(innerW)}┘`;
  const contentW = innerW - 2;
  const result: string[] = [top];
  for (const line of lines) {
    for (const wrapped of wrapToWidth(line, contentW)) {
      result.push(`│ ${pad(wrapped, contentW)} │`);
    }
  }
  result.push(bottom);
  return result;
}

export function sideBySide(left: string[], right: string[]): string[] {
  const maxLen = Math.max(left.length, right.length);
  const leftWidth = left.reduce((max, line) => Math.max(max, displayWidth(line)), 0);
  const result: string[] = [];
  for (let i = 0; i < maxLen; i++) {
    const l = pad(left[i] ?? "", leftWidth);
    const r = right[i] ?? "";
    result.push(l + " " + r);
  }
  return result;
}
