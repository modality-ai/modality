/** Strip ANSI escape sequences so toContain / character indexing works on colored output. */
export const stripAnsi = (s: string | undefined): string =>
  (s ?? "")
    // OSC sequences (including terminal hyperlink escapes) terminate with BEL (\x07) or ST (ESC \)
    .replace(/\x1b\][^\x07]*?(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-9;:?]*[a-zA-Z]/g, "");
