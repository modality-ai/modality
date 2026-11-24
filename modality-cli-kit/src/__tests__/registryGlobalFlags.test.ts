import { describe, test, expect } from "bun:test";
import { z } from "zod";
import { createCommandRegistry } from "../registry";
import type { CLICommand } from "../help/types";

describe("createCommandRegistry global flags enrichment", () => {
  test("merges json/human into a ZodObject inputSchema", () => {
    const cmd = {
      name: "foo",
      summary: "foo",
      description: "foo",
      inputSchema: z.object({ target: z.string().optional() }),
      execute: async () => ({}),
    } as unknown as CLICommand;
    const registry = createCommandRegistry([cmd]);
    const got = registry.get("foo")!;
    expect(Object.keys((got.inputSchema as any).shape)).toEqual(["target", "json", "human"]);
  });

  test("merges flags into a refined schema with a caller-declared json", () => {
    const cmd = {
      name: "refined",
      summary: "refined",
      description: "refined",
      inputSchema: z
        .object({ target: z.string(), json: z.string().optional() })
        .refine((v) => v.target.length > 0, { message: "target required" }),
      execute: async () => ({}),
    } as unknown as CLICommand;
    const registry = createCommandRegistry([cmd]);
    const schema = registry.get("refined")!.inputSchema as z.ZodTypeAny;
    expect(Object.keys((schema as any).shape)).toEqual(["target", "json", "human"]);
    expect(schema.safeParse({ target: "x", json: "y" }).success).toBe(true);
    expect(schema.safeParse({ target: "x", json: true }).success).toBe(false);
    expect(schema.safeParse({ target: "", json: "y" }).success).toBe(false);
  });

  test("leaves non-ZodObject inputSchema untouched", () => {
    const cmd = {
      name: "bar",
      summary: "bar",
      description: "bar",
      inputSchema: undefined,
      execute: async () => ({}),
    } as unknown as CLICommand;
    const registry = createCommandRegistry([cmd]);
    expect(registry.get("bar")!.inputSchema).toBeUndefined();
  });
});
