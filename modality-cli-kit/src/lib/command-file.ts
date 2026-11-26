/**
 * Command-file predicate shared by the scanner and the export validator.
 *
 * The scanner (`commandsDir.ts`) and the strict test-time validator
 * (`command-export-validation.ts`) decide "is this a command module?" with the
 * exact same rule — keep it in one place so a change like ".js counts too"
 * cannot land in one copy and not the other.
 */
import type { Dirent } from "node:fs";

/**
 * Is this directory entry a command module eligible to load or validate?
 *
 * Accepts `.ts` and `.js` — the same directory is source in development and
 * build output in `dist`. Excludes non-files, every other extension,
 * declaration files (.d.ts), and test files (.test.*, .spec.*).
 */
export function isCommandFile(entry: Dirent): boolean {
  if (!entry.isFile()) return false;
  const { name } = entry;
  // Both spellings count: the same directory is scanned as `.ts` from source
  // and as `.js` from a build.
  if (!name.endsWith(".ts") && !name.endsWith(".js")) return false;
  return (
    !name.endsWith(".d.ts") &&
    !name.endsWith(".test.ts") &&
    !name.endsWith(".test.js") &&
    !name.endsWith(".spec.ts") &&
    !name.endsWith(".spec.js")
  );
}
