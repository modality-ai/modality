import { describe, test, expect } from "bun:test";
import { z } from "zod";
import { GlobalFlagsSchema, isJsonFromArgs, withGlobalFlags } from "../../output/output";

describe("GlobalFlagsSchema", () => {
  test("exposes json and human flags", () => {
    expect(Object.keys(GlobalFlagsSchema.shape)).toEqual(["json", "human"]);
  });

  test("accepts boolean json/human", () => {
    expect(GlobalFlagsSchema.safeParse({ json: true }).success).toBe(true);
    expect(GlobalFlagsSchema.safeParse({ human: true }).success).toBe(true);
    expect(GlobalFlagsSchema.safeParse({}).success).toBe(true);
  });
});

describe("isJsonFromArgs", () => {
  test("json: true → true", () => {
    expect(isJsonFromArgs({ json: true })).toBe(true);
  });
  test("json: false → false", () => {
    expect(isJsonFromArgs({ json: false })).toBe(false);
  });
  test("human: true → false", () => {
    expect(isJsonFromArgs({ human: true })).toBe(false);
  });
  test("human: false → true", () => {
    expect(isJsonFromArgs({ human: false })).toBe(true);
  });
  test("neither → undefined", () => {
    expect(isJsonFromArgs({})).toBeUndefined();
    expect(isJsonFromArgs(null)).toBeUndefined();
    expect(isJsonFromArgs(undefined)).toBeUndefined();
  });
});

describe("withGlobalFlags", () => {
  test("extends a ZodObject with json/human", () => {
    const schema = z.object({ verbose: z.boolean().optional() });
    const extended = withGlobalFlags(schema);
    expect(Object.keys((extended as any).shape)).toEqual(["verbose", "json", "human"]);
  });

  test("non-ZodObject schema is returned unchanged", () => {
    const schema = z.string();
    expect(withGlobalFlags(schema as any)).toBe(schema);
  });

  test("null/undefined-ish schema returned unchanged", () => {
    expect(withGlobalFlags(null as any)).toBeNull();
  });
});
