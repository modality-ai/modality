/**
 * Usable terminal width in columns. Subtracts 1 because many terminals clip
 * the last column (pushing right borders off-screen). Falls back to 120 when
 * stdout is not a TTY.
 */
export function termWidth(): number {
  return Math.max(40, (process.stdout.columns ?? 120) - 1);
}
