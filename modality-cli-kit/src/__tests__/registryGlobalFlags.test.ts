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
