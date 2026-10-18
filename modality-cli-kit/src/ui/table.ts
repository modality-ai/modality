// CLI text-art table renderer with CJK + emoji width handling.
// Inspired by coco-shell's Table, kept functional rather than class-based.

import { displayWidth, charWidth } from "./displayWidth";

export { displayWidth } from "./displayWidth";

export type Align = "left" | "right";

export interface TableOptions {
  align?: Align[];
}

function truncateToWidth(text: string, maxWidth: number): string {
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

export function renderTable(headers: string[], rows: string[][], opts: TableOptions = {}): void {
  const widths = headers.map((header, i) => Math.max(
    displayWidth(header),
    ...rows.map((row) => displayWidth(row[i] ?? "")),
  ));
  const align = (i: number): Align => opts.align?.[i] ?? "left";

  const border = (left: string, mid: string, right: string) =>
    left + widths.map((w) => "─".repeat(w + 2)).join(mid) + right;

  const row = (cells: string[], alignHeader = false) =>
    "│ " + cells.map((cell, i) => pad(cell, widths[i] ?? 0, alignHeader ? "left" : align(i))).join(" │ ") + " │";

  console.log(border("┌", "┬", "┐"));
  console.log(row(headers, true));
  console.log(border("├", "┼", "┤"));
  for (const cells of rows) console.log(row(cells));
  console.log(border("└", "┴", "┘"));
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
  const leftWidth = left[0] !== undefined ? displayWidth(left[0]) : 0;
  const result: string[] = [];
  for (let i = 0; i < maxLen; i++) {
    const l = left[i] ?? " ".repeat(leftWidth);
    const r = right[i] ?? "";
    result.push(l + " " + r);
  }
  return result;
}
