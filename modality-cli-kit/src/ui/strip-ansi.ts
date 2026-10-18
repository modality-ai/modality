/** Strip ANSI escape sequences so toContain / character indexing works on colored output. */
export const stripAnsi = (s: string | undefined): string =>
  (s ?? "").replace(/\x1b\[[0-9;]*m/g, "");
