/**
 * Directory-scanned command registry — the commands directory *is* the index.
 *
 * {@link createCommandRegistry} needs an explicit list of commands, which means
 * a hand-maintained index module that imports each one. This module removes
 * that file: point it at a `commands/` directory and every module in it that
 * exports a `*Command` is registered. Adding a command is dropping in a file;
 * removing one is deleting that file. There is nothing else to edit.
 *
 * ## Quick start
 *
 * ```ts
 * import { createCommandRegistryFromDir } from "modality-cli-kit";
 *
 * export const registry = await createCommandRegistryFromDir(
 *   new URL("./commands", import.meta.url),
 * );
 * ```
 *
 * ## Why a URL
 *
 * `import.meta.url` is rewritten by the bundler to the *output* path of the
 * module it appears in, so it keeps resolving relative to the caller only while
 * that module retains its depth in the build. A call site inlined into another
 * chunk reports the chunk's location instead, which is why a bundled CLI should
 * resolve the directory from a stable location (the package root) rather than
 * `import.meta.url` — see README's "Bundled CLIs" note. A plain absolute path
 * is accepted too, for callers that compute one themselves.
 *
 * ## Aliases
 *
 * A scanned command carries its own `aliases`, so a deleted file takes its
 * aliases with it and no central map can go stale. An explicit alias map passed
 * as the second argument still wins for any command it names, preserving the
 * behavior of {@link createCommandRegistry}.
 *
 * ## Build requirement
 *
 * Bundlers only emit modules something imports, and scanning imports nothing
 * statically. A bundled CLI must therefore name the command files as build
 * entrypoints — e.g. `bun build ./src/cli.ts ./src/scripts/commands/*.ts` —
 * or the scan will find an empty directory at runtime.
 */
import { readdirSync, writeFileSync, existsSync, realpathSync, type Dirent } from "node:fs";
import { join, basename, extname, isAbsolute, dirname, sep, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { CLICommand } from "./help/types";
import { createCommandRegistry, type CommandRegistry } from "./registry";
import { isCommandFile } from "./command-file";

/** Options for {@link resolveCommandsDir}. */
export interface ResolveCommandsDirOptions {
  /**
   * Caller's `import.meta.url` or file path, used to locate the package root
   * by walking up until `package.json` is found. Default: caller must pass
   * their own `import.meta.url` when invoked from an external package.
   */
  from?: string | URL;
  /**
   * Subpath under the `dist` or `src` directory where commands live.
   * Default: `"scripts/commands"`.
   */
  subpath?: string;
}

/**
 * Locate the commands directory from the package root.
 *
 * `new URL("./commands", import.meta.url)` fails in bundled code because
 * bundlers inline modules into chunks, shifting `import.meta.url` away from its
 * source relative depth. Anchoring on the package root (`package.json`) provides
 * a stable reference across both development (`src/`) and production builds (`dist/`).
 *
 * Which tree to scan follows the calling module: if called from within a `dist`
 * directory, `dist/<subpath>` is preferred; otherwise `src/<subpath>` is preferred.
 *
 * @param options  Configuration options including `from` location and `subpath`.
 */
export function resolveCommandsDir(options: ResolveCommandsDirOptions = {}): string {
  const from = options.from ?? import.meta.url;
  // `from` may be a `file:` string, a `URL` instance, or a plain absolute path.
  // Only the plain path is used as-is; both file-url forms go through
  // fileURLToPath, or dirname sees a bogus "file:/..." path (a URL string is
  // not a real filesystem path) and no longer satisfies isAbsolute later.
  const fromPath =
    typeof from === "string" && !from.startsWith("file:") ? from : fileURLToPath(from);
  const here = dirname(fromPath);
  const subpath = options.subpath ?? join("scripts", "commands");

  let root = here;
  while (!existsSync(join(root, "package.json"))) {
    const parent = dirname(root);
    if (parent === root) return join(here, "commands");
    root = parent;
  }

  // Split on the platform separator rather than matching "/dist/": on Windows
  // `here` is backslash-separated, so a substring test would never fire.
  const isDist = here.split(sep).includes("dist");
  const trees = isDist ? ["dist", "src"] : ["src", "dist"];
  for (const tree of trees) {
    const candidate = join(root, tree, subpath);
    if (existsSync(candidate)) return candidate;
  }
  return join(root, trees[0]!, subpath);
}

/** Options shared by {@link loadCommandsFromDir} and {@link createCommandRegistryFromDir}. */
export interface LoadCommandsOptions {
  /**
   * Required suffix of the export that holds the command. Default: `"Command"`,
   * so `foo.ts` is expected to export `fooCommand`. Matches the suffix enforced
   * by `setupCommandExportValidation`, so one project setting covers both.
   */
  exportSuffix?: string;
}

/**
 * Accept a `file:` URL or an absolute path and return a filesystem path.
 * Relative strings are rejected — they would resolve against the process cwd,
 * so the same call site could discover a different commands directory
 * depending on where the CLI was started.
 */
function resolveDir(dir: string | URL, caller = "loadCommandsFromDir"): string {
  if (typeof dir !== "string") return fileURLToPath(dir);
  if (!isAbsolute(dir)) {
    throw new Error(
      `${caller}: commandsDir must be an absolute path – ${dir}`,
    );
  }
  return dir;
}

/**
 * The command files in `dir`, sorted by name and deduped by basename.
 *
 * Sorting makes registration order — and therefore help output — deterministic
 * rather than dependent on filesystem order. Deduping matters when a directory
 * holds both `foo.ts` and `foo.js` (a stale build beside its source): they are
 * the same command, and registering both would trip the duplicate-name warning
 * on every run. Source wins, since that is what the author is editing.
 */
function commandFilesIn(dir: string): string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    // `loadCommandsFromDir` already names the missing-directory case; anything
    // still throwing here (permissions, the directory removed mid-scan) must
    // not take the whole CLI down either.
    console.error(`[registry] Warning: cannot read commands directory — ${dir}`);
    return [];
  }
  const byBasename = new Map<string, string>();
  for (const name of entries
    .filter(isCommandFile)
    .map((entry) => entry.name)
    .sort()) {
    const key = basename(name, extname(name));
    const existing = byBasename.get(key);
    if (existing && existing.endsWith(".ts")) continue;
    byBasename.set(key, name);
  }
  return [...byBasename.values()].sort();
}

/**
 * Is this export actually a command, rather than something whose name merely
 * ends with the suffix? A command must carry a string `name` and a callable
 * `execute` — the two things the registry dispatches on. Checking here means a
 * malformed export is reported as a skipped file instead of failing later, at
 * dispatch time, with a confusing error.
 */
function isCommandShaped(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const { name, execute } = value as { name?: unknown; execute?: unknown };
  return typeof name === "string" && name.length > 0 && typeof execute === "function";
}

/**
 * Pick the command out of a loaded module: the single export whose name ends
 * with `exportSuffix`, returned together with its key. Returns `undefined` when
 * the module has none — a helper that landed in the directory by mistake, or a
 * command whose export was renamed mid-refactor. A module exporting several
 * matches is equally broken and is skipped with a warning naming the file,
 * instead of silently keeping only the first.
 *
 * The key matters to {@link generateCommandsIndex}, which must emit a static
 * `import { <key> }` for each command it finds.
 */
function commandExportOf(
  mod: Record<string, unknown>,
  exportSuffix: string,
  file: string,
): { key: string; command: CLICommand } | undefined {
  const matches = Object.entries(mod).filter(
    ([key, value]) => key.endsWith(exportSuffix) && isCommandShaped(value),
  );
  if (matches.length === 1)
    return { key: matches[0]![0]!, command: matches[0]![1] as CLICommand };
  // Zero or several matches are equally broken files — name the problem
  // precisely so the author can find and fix it.
  console.error(
    matches.length === 0
      ? `[registry] Warning: "${file}" exports no *${exportSuffix} — skipped`
      : `[registry] Warning: "${file}" exports ${matches.length} *${exportSuffix} exports — expected exactly one — skipped`,
  );
  return undefined;
}

function commandFromModule(
  mod: Record<string, unknown>,
  exportSuffix: string,
  file: string,
): CLICommand | undefined {
  return commandExportOf(mod, exportSuffix, file)?.command;
}

/**
 * Load every command module in a directory.
 *
 * A file that exports no command, exports several, or throws while being
 * imported, is reported on stderr and skipped — one broken file must not take
 * down the whole CLI, which would also lose `--help` and every working command
 * with it. The strict check belongs in tests: `setupCommandExportValidation`
 * fails the build on exactly these files, which is where strictness costs
 * nothing.
 *
 * @param dir  The commands directory, as a `file:` URL or an absolute path.
 */
export async function loadCommandsFromDir(
  dir: string | URL,
  options: LoadCommandsOptions = {},
): Promise<CLICommand[]> {
  const { exportSuffix = "Command" } = options;
  const dirPath = resolveDir(dir);

  if (!existsSync(dirPath)) {
    // A missing directory yields an empty CLI, which is confusing enough to be
    // worth naming the path that was actually looked at.
    console.error(`[registry] Warning: commands directory not found — ${dirPath}`);
    return [];
  }

  const commands: CLICommand[] = [];
  for (const file of commandFilesIn(dirPath)) {
    const path = join(dirPath, file);
    let mod: Record<string, unknown>;
    try {
      // A bare absolute path is not a valid specifier on Windows ("C:\..." is
      // read as a protocol); a file: URL is portable everywhere.
      mod = (await import(pathToFileURL(path).href)) as Record<string, unknown>;
    } catch (error) {
      console.error(
        `[registry] Warning: failed to load "${file}" — ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }

    const command = commandFromModule(mod, exportSuffix, file);
    if (!command) continue;
    commands.push(command);
  }

  return commands;
}

/**
 * Scan a directory and build a {@link CommandRegistry} from what it finds.
 *
 * Each command's own `aliases` are collected into the registry's alias map. An
 * entry in `aliases` overrides the command's own list for that command, so a
 * caller can still centralize aliases when it wants to.
 *
 * @param dir      The commands directory, as a `file:` URL or an absolute path.
 * @param aliases  Optional `commandName → [alias, ...]` overrides.
 */
export async function createCommandRegistryFromDir(
  dir: string | URL,
  aliases: Record<string, string[]> = {},
  options: LoadCommandsOptions = {},
): Promise<CommandRegistry> {
  // Validate here so a relative path is reported against the function the
  // caller actually invoked, then hand the resolved path down.
  const dirPath = resolveDir(dir, "createCommandRegistryFromDir");
  return createCommandRegistry(await loadCommandsFromDir(dirPath, options), aliases);
}

/** Options for {@link generateCommandsIndex}. */
export interface GenerateCommandsIndexOptions extends LoadCommandsOptions {
  /** Absolute path to write the generated module to. */
  out: string | URL;
}

/**
 * The import specifier a generated module should use to reach a command module
 * sitting next to it: a relative, extension-free, `./`-prefixed path.
 */
function importSpecifier(fromFile: string, toFile: string): string {
  let rel = relative(dirname(fromFile), toFile).split(sep).join("/");
  rel = rel.replace(/\.\w+$/, ""); // drop the source extension (.ts / .js)
  return rel.startsWith(".") ? rel : `./${rel}`;
}

/**
 * Canonical form of a may-not-exist-yet file path. Generated output is
 * compared against scanned files and turned into relative imports, so both
 * sides must share the same spelling — a symlinked cwd (`/var` → `/private/var`
 * on macOS, for instance) would otherwise defeat the `out` collision guard and
 * emit imports that walk across the symlink boundary.
 */
function canonicalFilePath(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    try {
      return join(realpathSync(dirname(p)), basename(p));
    } catch {
      return p;
    }
  }
}

/**
 * Generate a static commands-index module from a commands directory.
 *
 * Applies the *same* discovery rules as {@link loadCommandsFromDir} — sorted,
 * basename-deduped, warn-and-skip on a broken file — but instead of importing
 * every command at runtime it emits a TypeScript module that statically imports
 * each one into a single `commands` array:
 *
 * ```ts
 * // generated.commands.ts
 * import { fooCommand } from "./commands/foo";
 * import { barCommand } from "./commands/bar";
 * export const commands: CLICommand[] = [fooCommand, barCommand];
 * ```
 *
 * A CLI builds its registry with {@link createCommandRegistry} on that list, so
 * the bundler renders **one shared dependency graph** — no per-command
 * entrypoints, and no runtime directory scan on every launch. The directory
 * stays the source of truth: adding a command is dropping in a file and
 * re-running this during the build; there is no hand-written index to maintain.
 * This is the production counterpart to the runtime scan: use it when startup
 * cost matters and the commands are known at build time.
 *
 * @param dir      The commands directory, as a `file:` URL or an absolute path.
 * @param options  `out` (required, absolute) and `exportSuffix` (default "Command").
 * @returns        The generated module source (written to `out` as a side effect).
 */
export async function generateCommandsIndex(
  dir: string | URL,
  options: GenerateCommandsIndexOptions,
): Promise<string> {
  const { exportSuffix = "Command", out } = options;
  const dirPath = resolveDir(dir, "generateCommandsIndex");
  if (typeof out === "string" && !isAbsolute(out)) {
    throw new Error(
      `generateCommandsIndex: out must be an absolute path – ${out}`,
    );
  }
  const outPath = canonicalFilePath(
    typeof out === "string" ? resolve(out) : fileURLToPath(out),
  );
  if (!existsSync(dirPath)) {
    console.error(`[registry] Warning: commands directory not found — ${dirPath}`);
    return "";
  }
  // Scan the canonical directory so generated specifiers and the `out`
  // collision check compare like for like — see {@link canonicalFilePath}.
  const scanDir = realpathSync(dirPath);

  const imports: string[] = [];
  const names: string[] = [];
  for (const file of commandFilesIn(scanDir)) {
    const path = join(scanDir, file);
    // Never scan the module this very call is about to write — a generated
    // file is not a command, so an `out` placed inside the directory must not
    // be re-scanned (and warned about) on the next regeneration. The one
    // exception: a real command file sitting at `out` (e.g. `--out` named an
    // existing command by mistake) — overwriting it would destroy it, so refuse.
    if (resolve(path) === outPath) {
      // A normal regeneration replaces the previous generated module — do not
      // scan it (that would re-warn about it as a non-command). The exception:
      // a real command file sitting at `out` (e.g. `--out` named an existing
      // command by mistake) — overwriting it would destroy it, so refuse.
      try {
        const existing = (await import(
          pathToFileURL(path).href,
        )) as Record<string, unknown>;
        const isCommand = Object.entries(existing).some(
          ([key, value]) =>
            key.endsWith(exportSuffix) && isCommandShaped(value),
        );
        if (isCommand) {
          throw new Error(
            `generateCommandsIndex: out names an existing command file — refusing to overwrite — ${outPath}`,
          );
        }
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes("refusing to overwrite")
        ) {
          throw error;
        }
        // Not importable as a module (e.g. a stale generated file) — safe to
        // replace with fresh output.
      }
      continue;
    }
    let mod: Record<string, unknown>;
    try {
      // A bare absolute path is not a valid specifier on Windows; file: URL is.
      mod = (await import(pathToFileURL(path).href)) as Record<string, unknown>;
    } catch (error) {
      console.error(
        `[registry] Warning: failed to load "${file}" — ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }
    const found = commandExportOf(mod, exportSuffix, file);
    if (!found) continue;
    imports.push(`import { ${found.key} } from "${importSpecifier(outPath, path)}";`);
    names.push(found.key);
  }

  const source =
    [
      `// ── Generated by modality-cli-kit — do not edit by hand.`,
      `// Regenerate with generateCommandsIndex(); the commands directory is the`,
      `// single source of truth.`,
      `import type { CLICommand } from "modality-cli-kit";`,
      ...imports,
      ``,
      `export const commands: CLICommand[] = [${names.join(", ")}];`,
      ``,
    ].join("\n");

  writeFileSync(outPath, source, "utf-8");
  return source;
}
