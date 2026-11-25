/**
 * Strip ANSI escape sequences so colored output is plain text. Byte-level only:
 * YAML decoding lives in {@link stripYamlAnsi}, for Counter's output alone.
 */
const stripEscapeBytes = (s: string): string =>
  s
    // OSC sequences (including terminal hyperlink escapes) terminate with BEL (\x07) or ST (ESC \)
    .replace(/\x1b\][^\x07]*?(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-9;:?]*[a-zA-Z]/g, "");

export const stripAnsi = (s: string | undefined): string =>
  s === undefined ? "" : stripEscapeBytes(s);

/**
 * Counter serializes colored text through YAML, where ESC becomes `\e` and a
 * folded line's leading space becomes `\ `. Decode those spellings before
 * stripping. Literal `\e[` in ordinary human text is data, not an escape.
 */
export const stripYamlAnsi = (s: string | undefined): string =>
  s === undefined
    ? ""
    : stripEscapeBytes(
        s
          .replace(/\\+e(?=\[|\]|\\)/g, "\x1b")
          .replace(/(\n[ \t]*)\\(?=[ \t])/g, "$1"),
      );

export const plainArgs = (args: unknown[]): unknown[] =>
  args.map((arg) => (typeof arg === "string" ? stripAnsi(arg) : arg));
