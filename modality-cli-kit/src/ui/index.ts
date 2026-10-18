/**
 * `modality-cli-kit/ui` — Composable terminal UI primitives.
 *
 * Zero-dependency text rendering: width-aware tables and boxes, plus the
 * escape and timer vocabulary for in-place `--watch` loops. Everything here
 * is terminal-agnostic and carries no domain model.
 *
 * ## Quick start
 *
 * ```ts
 * import { renderTable, header } from "modality-cli-kit/ui";
 *
 * console.log(header("Positions"));
 * renderTable(["Symbol", "Change"], [["2330", "+1.5%"]]);
 * ```
 *
 * Width correctness: `displayWidth` measures CJK, emoji, and ANSI-colored
 * strings, so `renderTable` / `renderBox` stay aligned where `String.length`
 * would not.
 *
 * For ANSI color helpers, see `modality-cli-kit/help` (`cmd`, `header`, `dim`,
 * `bold`, `success`, `error`, …) — color output is not part of this surface.
 */

// Width-aware text helper, ANSI-aware. The root dependency of table.
export { stripAnsi } from "./strip-ansi";

// Terminal column measurement (CJK + emoji + grapheme clustering).
export { displayWidth, charWidth } from "./displayWidth";

// Text layout: pad, wrap, and the table/box/side-by-side renderers.
export { pad, wrapToWidth, renderTable, renderBox, sideBySide } from "./table";
export type { Align, TableOptions } from "./table";

// Escape sequences and timer/status vocabulary for in-place `--watch` loops.
export {
  CURSOR_HOME,
  HIDE_CURSOR,
  SHOW_CURSOR,
  CLEAR_SCREEN,
  CLEAR_BELOW,
  SET_TITLE,
  BELL,
  termWidth,
  sleep,
  draw,
  writeTitle,
  refreshingStatus,
  nextTickStatus,
  taipeiClock,
  liveStatus,
  errorStatus,
  watchCountdown,
} from "./terminal";
