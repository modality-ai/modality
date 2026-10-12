/**
 * The global options every CLI gets for free.
 *
 * These are the flags whose meaning the kit itself owns — output format and
 * cache bypass — so a consuming CLI should not have to redeclare them just to
 * have them appear in help and be accepted by per-command validation. They are
 * merged into whatever `globalOptionsSchema` the CLI passes; see
 * {@link resolveGlobalOptions} for the merge rule.
 *
 * Adding one is a change to this file alone: add the key below. The
 * {@link GlobalOptionName} union, the merged schema, the accepted-flag set, and
 * the `withoutDefaultGlobalOption` opt-out all widen with no further wiring.
 */
import { z } from "zod";

/** Options the runner supplies unless switched off. */
const DEFAULT_GLOBAL_OPTIONS = {
  json: z.boolean().optional().describe("output JSON (CLIResult envelope, pretty)"),
  human: z.boolean().optional().describe("render human output instead of JSON"),
  "no-cache": z.boolean().optional().describe("bypass caches; force a live fetch"),
  trace: z.boolean().optional().describe("print the runner's dispatch path to stderr"),
} satisfies Record<string, z.ZodType>;

/** Name of a global option the runner supplies by default. */
export type GlobalOptionName = keyof typeof DEFAULT_GLOBAL_OPTIONS;

/**
 * Merge the CLI's global options over the defaults.
 *
 * The CLI's own keys win, so a project can reword a default without having to
 * switch it off first. Defaults keep their declaration order, which
 * is the order help renders them in.
 *
 * @param supplied The CLI's `globalOptionsSchema`, if it passed one.
 * @param disabled `true` to take none of the defaults, or the names to leave out.
 */
export function resolveGlobalOptions(
  supplied: z.ZodObject<Record<string, z.ZodType>> | undefined,
  disabled: boolean | GlobalOptionName[] | undefined,
): z.ZodObject<Record<string, z.ZodType>> {
  const suppliedShape = supplied?.shape ?? {};
  if (disabled === true) return z.object(suppliedShape);

  const off = new Set<string>(Array.isArray(disabled) ? disabled : []);
  const defaults = Object.fromEntries(
    Object.entries(DEFAULT_GLOBAL_OPTIONS).filter(([name]) => !off.has(name)),
  );

  return z.object({ ...defaults, ...suppliedShape });
}
