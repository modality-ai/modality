import { describe, test, expect } from "bun:test";
import { z } from "zod";
import { resolveGlobalOptions } from "../lib/globalOptions";

describe("resolveGlobalOptions", () => {
  test("merges the CLI's schema over the defaults", () => {
    const schema = resolveGlobalOptions(
      z.object({ verbose: z.boolean().optional() }),
      undefined,
    );
    expect(Object.keys(schema.shape)).toEqual(["json", "human", "no-cache", "trace", "verbose"]);
  });

  test("a supplied key of the same name replaces the default", () => {
    const schema = resolveGlobalOptions(
      z.object({ json: z.string().optional() }),
      undefined,
    );
    // The CLI's own declaration wins, so `json` now follows its rule...
    expect(schema.safeParse({ json: "yes" }).success).toBe(true);
    // ...and the default's boolean rule no longer applies.
    expect(schema.safeParse({ json: true }).success).toBe(false);
  });

  test("disabled=true keeps only the CLI's own schema", () => {
    const schema = resolveGlobalOptions(z.object({ verbose: z.boolean().optional() }), true);
    expect(Object.keys(schema.shape)).toEqual(["verbose"]);
  });

  test("disabled=true with no schema yields an empty schema", () => {
    const schema = resolveGlobalOptions(undefined, true);
    expect(Object.keys(schema.shape)).toEqual([]);
  });

  test("disabled=[name] drops just that default", () => {
    const schema = resolveGlobalOptions(undefined, ["human"]);
    expect(Object.keys(schema.shape)).toEqual(["json", "no-cache", "trace"]);
  });
});
