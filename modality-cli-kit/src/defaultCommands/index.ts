/**
 * Default commands — the ones {@link createCliRunner} registers on a CLI's
 * behalf, so every kit-based CLI gets them without declaring anything.
 *
 * Adding one is a change to this folder alone: drop the module into
 * `commands/` beside `merge.ts` — one command per file, one export each, as
 * `commands/__tests__/exports.test.ts` enforces — and add its factory to
 * {@link DEFAULT_COMMANDS}. This file is the only place they are wired
 * together, which is why it sits outside `commands/`. The runner reads
 * the map, the `DefaultCommandName` union widens automatically, and the
 * `withoutDefaultCommand` option accepts the new name with no further wiring.
 *
 * Each factory receives a {@link DefaultCommandContext}, so a default command
 * can tailor its help to the CLI it lands in — and can decline to register at
 * all (return `undefined`) when that CLI supplies nothing for it to work on.
 */
import type { CLICommand } from "../help/types";
import type { CommandRegistry } from "../registry";
import { createMergeCommand } from "./commands/merge";
import { createSkillCommand } from "./commands/skill";
import { createSkillsCommand } from "./commands/skills";

/** What a default command knows about the CLI it is being registered into. */
interface DefaultCommandContext {
  /** Binary name, for help and examples. */
  cliName: string;
  /** The CLI's own commands, so a default can tailor its examples. */
  registry: CommandRegistry;
  /**
   * Absolute path to the CLI's Counter `methods/` tree, when it has one. A
   * default that needs it returns `undefined` without one rather than
   * registering a command that cannot work.
   */
  methodsDir?: string;
  /**
   * Absolute path to the CLI's default skill file (`SKILL.mdx`/`SKILL.md`).
   * `skill` prints it when no method is named; without one, that invocation
   * auto-detects a file at `methodsDir/../src/` before falling back to
   * Counter's method list.
   */
  defaultSkillPath?: string;
}

/**
 * Builds a default command for the CLI it is being registered into, or
 * `undefined` when that CLI supplies nothing for it to work on.
 */
type DefaultCommandFactory = (context: DefaultCommandContext) => CLICommand | undefined;

/** Every default command, keyed by the name it registers under. */
const DEFAULT_COMMANDS = {
  merge: ({ cliName, registry }) =>
    createMergeCommand({ cliName, exampleCommands: exampleCommandNames(registry) }),
  skill: ({ cliName, methodsDir, defaultSkillPath }) =>
    methodsDir === undefined
      ? undefined
      : createSkillCommand({ cliName, methodsDir, defaultSkillPath }),
  skills: ({ cliName, methodsDir }) =>
    methodsDir === undefined ? undefined : createSkillsCommand({ cliName, methodsDir }),
} satisfies Record<string, DefaultCommandFactory>;

/** Name of a command the runner supplies by default. */
export type DefaultCommandName = keyof typeof DEFAULT_COMMANDS;

/**
 * Two of the CLI's own command names, so a default command's examples are
 * copy-pasteable instead of placeholders. Falls back to generic names when the
 * registry is too small to supply a pair.
 */
function exampleCommandNames(registry: CommandRegistry): [string, string] {
  const [first = "alpha", second = "beta"] = registry.all.map((cmd) => cmd.name!);
  return [first, second];
}

/**
 * Resolve which default commands to append: those not switched off, and not
 * already defined by the CLI itself — a command the registry owns under the
 * same name always wins, so shadowing needs no opt-out.
 *
 * A factory that returns `undefined` — because the CLI supplies nothing for it
 * to work on — is dropped just as quietly as a disabled one.
 *
 * @param disabled `true` to register none, or the names to leave out.
 * @param methodsDir The CLI's Counter `methods/` tree, when it has one.
 * @param defaultSkillPath The file `skill` prints when no method is named.
 */
export function defaultCommandsFor(
  cliName: string,
  registry: CommandRegistry,
  disabled: boolean | DefaultCommandName[] | undefined,
  methodsDir?: string,
  defaultSkillPath?: string,
): CLICommand[] {
  if (disabled === true) return [];
  const off = new Set<string>(Array.isArray(disabled) ? disabled : []);
  const context: DefaultCommandContext = { cliName, registry, methodsDir, defaultSkillPath };

  return Object.entries(DEFAULT_COMMANDS)
    .filter(([name]) => !off.has(name) && !registry.get(name))
    .map(([, build]) => build(context))
    .filter((command): command is CLICommand => command !== undefined);
}

export { createMergeCommand } from "./commands/merge";
export type { MergeCommandOptions } from "./commands/merge";
export { createSkillCommand } from "./commands/skill";
export type { SkillCommandOptions } from "./commands/skill";
export { createSkillsCommand } from "./commands/skills";
export type { SkillsCommandOptions } from "./commands/skills";
