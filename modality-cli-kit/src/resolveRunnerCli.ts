/**
 * The one place that turns a CLI's declared config into its help-ready form:
 * default global options merged in, default commands appended, and the
 * output-format footer written. Both `createCliRunner` and the root `getHelp`
 * go through it, so help output is identical wherever it is rendered.
 */
import type { z } from "zod";
import { buildCliFromTools } from "./help/cli-builder";
import { resolveGlobalOptions } from "./globalOptions";
import { outputFormatEnvNames, type OutputFormat } from "./ui/output";
import { createCommandRegistry } from "./registry";
import { defaultCommandsFor } from "./defaultCommands";
import { markRawArgv, takesRawArgv } from "./defaultCommands/internal";
import type { CliRunnerOptions } from "./createCliRunner";

/**
 * The flag that selects each format.
 *
 * `human` is the flagless default for most CLIs, but a CLI whose handlers
 * default to machine output (and opt into rendering with `--human`) can declare
 * `human` in its `globalOptionsSchema` — then the environment can drive it just
 * like the other two. Absence still means human whenever it is not declared.
 */
export const FORMAT_FLAG: Record<OutputFormat, string> = {
  json: "json",
  jsonl: "jsonl",
  human: "human",
};

/**
 * The format flags to name in the help footer — whichever of them this CLI
 * kept. A CLI that dropped them all gets no promise it cannot honor.
 */
export function formatFlagsFooter(
  globalOptions: z.ZodObject<Record<string, z.ZodType>>
): string {
  const present = Object.values(FORMAT_FLAG)
    .filter((flag) => flag in globalOptions.shape)
    .map((flag) => `--${flag}`);
  return present.length > 0 ? present.join(" or ") : "no format flag";
}

/** The config fields that shape help; the rest of the runner options do not. */
export type HelpCliOptions = Pick<
  CliRunnerOptions,
  | "cliName"
  | "tagline"
  | "registry"
  | "globalOptionsSchema"
  | "globalOptionsKeyMap"
  | "skipFields"
  | "globalExamples"
  | "footer"
  | "withoutDefaultCommand"
  | "withoutDefaultGlobalOption"
  | "methodsDir"
>;

export function resolveRunnerCli(options: HelpCliOptions) {
  const {
    cliName,
    tagline,
    registry: suppliedRegistry,
    globalOptionsSchema: suppliedGlobalOptions,
    globalOptionsKeyMap,
    skipFields,
    globalExamples,
    footer: suppliedFooter,
    withoutDefaultCommand,
    withoutDefaultGlobalOption,
    methodsDir,
  } = options;

  // Fold in the defaults here rather than in the consuming package, so
  // `globalOptionsSchema` stays that package's own declaration of what it adds.
  const globalOptionsSchema = resolveGlobalOptions(
    suppliedGlobalOptions,
    withoutDefaultGlobalOption
  );

  // Append the default commands here rather than in the consuming package, so
  // `registry` stays that package's own declaration of what it owns.
  const defaults = defaultCommandsFor(
    cliName,
    suppliedRegistry,
    withoutDefaultCommand,
    methodsDir
  );
  const registry = defaults.length
    ? createCommandRegistry(
        [...suppliedRegistry.all, ...defaults],
        suppliedRegistry.aliases
      )
    : suppliedRegistry;

  // `createCommandRegistry` normalizes every command into a fresh object, so
  // the raw-argv grant — which is held by object identity — does not survive
  // registration. Re-apply it to the objects the registry will actually
  // dispatch.
  for (const command of defaults) {
    if (!takesRawArgv(command)) continue;
    const registered = registry.get(command.name!);
    if (registered) markRawArgv(registered);
  }

  // `buildCliFromTools` reads aliases off each command object, so project them
  // from the registry's alias map — keeping the registry the one source.
  const cli = buildCliFromTools(
    registry.all.map((cmd) => ({
      ...cmd,
      aliases: registry.aliases[cmd.name ?? ""] ?? [],
    })),
    {
      cliName,
      tagline,
      skipFields,
      globalOptionsSchema,
      globalOptionsKeyMap,
      globalExamples,
      // The env default is invisible in the flag list, so name it where the
      // reader is already looking for global output control.
      footer:
        suppliedFooter ??
        [
          `Run \`${cliName} <command> --help\` for more information about a command.`,
          `Output format: pass ${formatFlagsFooter(globalOptionsSchema)}, or set ${outputFormatEnvNames(cliName).join(" / ")} (human | json | jsonl). A flag beats the environment.`,
        ].join("\n"),
    }
  );

  return { cli, registry, defaults, globalOptionsSchema };
}
