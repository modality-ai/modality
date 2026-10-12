/**
 * Turn a Counter method's declared parameters into a Zod schema, and parse argv
 * the way Counter itself does.
 *
 * Both halves live here because they must agree. `@modality-counter/core` reads
 * a method's params off the command line with its own rules, and a validator
 * that normalized keys differently — or expected values in a different shape —
 * would reject calls Counter accepts, or pass calls it cannot use. The two
 * rules it applies, both mirrored in {@link parseCounterParams}:
 *
 *  - **Keys are kebab→snake**: `--dataset-snapshot` becomes `dataset_snapshot`.
 *    (Note this is *not* the kit's own camel→kebab convention in `zod-cli.ts`,
 *    which is why the runner's validator cannot be reused here.)
 *  - **Values are only ever `string` or `true`**: `--k v` yields `"v"`, `--k=v`
 *    yields `"v"`, and a bare `--k` yields `true`. Nothing is coerced to a
 *    number and nothing is JSON-parsed.
 *
 * So the schemas built here **validate the wire form and never transform it**.
 * A `type: object` parameter is checked by parsing its string to confirm it is
 * a JSON object, but the caller still forwards the original argv — Counter must
 * receive exactly what it receives today.
 *
 * An undeclared parameter is an error, and so is a declared one whose `type`
 * this mapper does not recognize. There is deliberately no permissive fallback:
 * `z.any()` for an unknown type would silently switch validation off for that
 * parameter, and omitting `parameters:` from a method would become a way to opt
 * out of validation entirely.
 */
import { z } from "zod";

/** One entry of a method's `usage.parameters` block, as authored in its MDX. */
interface MethodParameter {
  /** Declared value type. Required — an unrecognized or missing type throws. */
  type?: string;
  /** Whether the method cannot run without it. */
  required?: boolean;
  /** Value Counter substitutes when the flag is absent. Implies optional. */
  default?: unknown;
  /** Allowed values; when present the parameter is validated as an enum. */
  options?: unknown[];
  /** Human description (unused here — it documents, it does not constrain). */
  description?: string;
}

/** A method's declared parameters, keyed by the name Counter expects. */
export type MethodParameters = Record<string, MethodParameter>;

/** Values Counter can produce for a parameter: a string, or `true` for a bare flag. */
const WIRE_VALUE = "expected a value (a bare flag yields no value)";

/**
 * `--k v`, `--k=v` and `--k` exactly as `@modality-counter/core` reads them. A
 * bare `--` is skipped — it is the argv terminator, not a parameter — while
 * the tokens after it are still read as flags, so validation stays as strict
 * as the rules it mirrors.
 */
export function parseCounterParams(argv: string[]): Record<string, string | true> {
  const params: Record<string, string | true> = {};

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    // A bare `--` would otherwise parse as a flag with an empty key.
    if (!token.startsWith("--") || token === "--") continue;

    const equals = token.indexOf("=");
    if (equals !== -1) {
      params[normalizeKey(token.slice(2, equals))] = token.slice(equals + 1);
      continue;
    }

    const key = normalizeKey(token.slice(2));
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      params[key] = next;
      i++;
    } else {
      params[key] = true;
    }
  }

  return params;
}

/** Counter's key convention: `--dataset-snapshot` → `dataset_snapshot`. */
function normalizeKey(flag: string): string {
  return flag.replace(/-/g, "_");
}

/** A string that parses as JSON of the given kind, checked without rewriting it. */
function jsonOfKind(kind: "object" | "array"): z.ZodType {
  return z.string(WIRE_VALUE).refine(
    (raw) => {
      try {
        const parsed: unknown = JSON.parse(raw);
        return kind === "array" ? Array.isArray(parsed) : isPlainObject(parsed);
      } catch {
        return false;
      }
    },
    { message: `expected a JSON ${kind}` },
  );
}

function isPlainObject(value: unknown): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The Zod type for one declared parameter, before optionality is applied.
 *
 * `options` wins over `type`: a parameter listing allowed values is an enum
 * whatever its declared type, which matches how Counter documents them.
 */
function typeFor(name: string, param: MethodParameter): z.ZodType {
  const options = param.options;
  if (options !== undefined && options.length > 0) {
    return z.enum(options.map(String) as [string, ...string[]]);
  }

  switch (param.type) {
    case "string":
      return z.string(WIRE_VALUE);
    case "number":
      // Counter never coerces, so the wire value is a numeric *string*; a bare
      // flag (`true`) must fail rather than quietly coerce to 1.
      return z.string(WIRE_VALUE).refine((raw) => raw.trim() !== "" && Number.isFinite(Number(raw)), {
        message: "expected a number",
      });
    case "boolean":
      // Both spellings a shell can produce: the bare flag, or an explicit word.
      return z.union([z.literal(true), z.enum(["true", "false"])]);
    case "object":
      return jsonOfKind("object");
    case "array":
      return jsonOfKind("array");
    default:
      throw new Error(
        `Parameter "${name}" declares ${param.type === undefined ? "no type" : `unsupported type "${param.type}"`}. ` +
          `Supported: string, number, boolean, object, array. Fix the method's usage.parameters block.`,
      );
  }
}

/**
 * Build the strict schema for a method's parameters.
 *
 * A parameter is required only when it says so; a declared `default` means
 * Counter fills it in, so the flag is optional here. The default is *not*
 * injected into the parsed output — Counter applies its own, and adding ours
 * would change what the method receives.
 *
 * @param parameters The method's `usage.parameters`, or `undefined` when it
 *   declares none — which yields a schema accepting no parameters at all.
 */
export function buildMethodParamsSchema(
  parameters: MethodParameters | undefined,
): z.ZodObject<Record<string, z.ZodType>> {
  const shape: Record<string, z.ZodType> = {};

  for (const [name, param] of Object.entries(parameters ?? {})) {
    const type = typeFor(name, param);
    shape[name] = param.required === true ? type : type.optional();
  }

  // Strict: an undeclared parameter is an error, not something to strip. A
  // plain `z.object` would silently drop it and report success.
  return z.strictObject(shape);
}
