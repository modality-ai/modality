/**
 * Minimal ambient types for `@modality-counter/core`.
 *
 * The package is an *optional* dependency: only a CLI that supplies
 * `methodsDir` registers the `skill` default command, and only that command
 * imports it — lazily, inside `execute`. Declaring the two functions here keeps
 * `tsc` green without forcing every kit consumer (and its `react` /
 * `react-dom` peers) to install Counter just to build.
 *
 * Kept to the surface `defaultCommands/commands/skill.ts` actually calls; widen
 * it only when that file starts using more.
 */
declare module "@modality-counter/core" {
  /** Terminal styling hooks `toCounterCLIHelp` uses to render its help page. */
  export interface HelpFormat {
    bold?: (text: string) => string;
    dim?: (text: string) => string;
    header?: (text: string) => string;
    example?: (text: string) => string;
  }

  /**
   * Help handler for a Counter passthrough. Resolves `true` when it handled the
   * args (and printed), `false` when the caller should carry on.
   */
  export function toCounterCLIHelp(
    cliName: string,
    baseDir: string,
    format?: HelpFormat,
    commandName?: string,
  ): (args: string[]) => Promise<boolean>;

  /** Runner that prints the raw skill text for a Counter method. */
  export function toCounterCLI(
    baseDir: string,
    options?: { cliName?: string; command?: string },
  ): (args: string[]) => Promise<void>;

  /** One discovered Counter item (a method, persona, …). */
  export interface CounterItem {
    /** The name used on the command line. */
    id: string;
    /** Absolute path to the item's MDX source. */
    filePath: string;
    folderPath?: string;
    category?: string;
    description?: string;
  }

  /** Discover items of the given kinds under a Counter base directory. */
  export function getAllCounterItems(kinds: string[], baseDir: string): Promise<CounterItem[]>;

  /**
   * Read an MDX file's YAML front matter. `method.usage.parameters` is the
   * declaration this command validates against.
   */
  export function readMdxYaml(filePath: string): Promise<{
    method?: {
      usage?: {
        parameters?: Record<string, { type?: string; required?: boolean; default?: unknown; options?: unknown[]; description?: string }>;
      };
    };
  }>;
}
