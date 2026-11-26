/**
 * Project-root `.env` loading, for CLIs run from anywhere.
 *
 * Bun only auto-loads `.env` from the working directory, which never fires for a
 * globally installed bin invoked from another folder.
 *
 * A kit cannot find the consuming package from `import.meta.dir` — inside a
 * dependency that resolves to `node_modules/modality-cli-kit/dist/`. The running
 * script can: `process.argv[1]` is the real, symlink-resolved path of the entry
 * file the runtime started, so walking up from it reaches the package that owns
 * the CLI — including through a `node_modules/.bin` shim.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { parseEnv } from "node:util";

/** Options for {@link loadProjectEnv}. */
export interface LoadProjectEnvOptions {
  /**
   * Explicit `.env` path, or `false` to load nothing and run on the ambient
   * environment. Omitted searches upward from {@link LoadProjectEnvOptions.entry}.
   */
  envFile?: string | false;
  /**
   * File whose directory the upward search starts from (its own directory, then
   * each parent). Defaults to `process.argv[1]` — the running entry script.
   */
  entry?: string;
}

/**
 * The first `.env` at or above `start`, or `undefined` at the project boundary.
 *
 * The walk ends at the project root, so a globally installed CLI cannot pick up
 * a `.env` from an unrelated directory above it. `node_modules` is passed
 * through: a dependency's `package.json` is not a project boundary, and walking
 * past it is how a locally installed CLI reaches the project that installed it.
 */
function findUpward(start: string): string | undefined {
  let dir = start;
  // Set once the walk steps out of a `node_modules` tree, which makes the
  // current directory the last one worth considering — it is the consuming
  // project, or nothing at all for a global install.
  let pastNodeModules = false;

  for (;;) {
    const candidate = join(dir, ".env");
    if (existsSync(candidate)) return candidate;

    const inNodeModules = dir.split(sep).includes("node_modules");
    // Past the dependency tree there is no project left to belong to: a further
    // `.env` would be an install prefix's (`/usr/local/.env`) or a home one's.
    if (pastNodeModules && !inNodeModules) return undefined;
    // A project root with no `.env` of its own ends the search too — the file
    // above it belongs to some other project.
    if (!inNodeModules && existsSync(join(dir, "package.json")))
      return undefined;

    pastNodeModules = inNodeModules;

    const parent = dirname(dir);
    // dirname("/") is "/" — the walk is done.
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * Apply a `.env` to `process.env` and return the file that was read.
 *
 * Variables already in the environment win, so an explicit export — or a value
 * Bun loaded from the working directory — still beats the file. Nothing to load
 * is the common case, not an error: a missing or unreadable file leaves the
 * environment untouched and returns `undefined`. (`parseEnv` is lenient and does
 * not throw on malformed content, so only a read failure reaches the catch.)
 */
export function loadProjectEnv(
  options: LoadProjectEnvOptions = {}
): string | undefined {
  const { envFile, entry = process.argv[1] } = options;
  if (envFile === false) return undefined;

  const file = envFile ?? (entry ? findUpward(dirname(entry)) : undefined);
  if (file === undefined) return undefined;

  try {
    for (const [key, value] of Object.entries(parseEnv(readFileSync(file, "utf-8"))))
      if (process.env[key] === undefined) process.env[key] = value;
  } catch {
    return undefined;
  }
  return file;
}
