import { expect, test } from "bun:test";
import { createCommandRegistry } from "../lib/registry";
import type { CLICommand } from "../help/types";

interface TestDeps {
  marker: string;
}

interface TestArgs {
  id: string;
}

test("a registered command keeps its typed create seam callable", async () => {
  const command: CLICommand<TestDeps, TestArgs, TestArgs> = {
    name: "di-cmd",
    summary: "di-cmd",
    description: "di-cmd",
    execute: async (args) => ({ id: String(args.id) }),
    create: (deps) => async (args) => ({ id: `${deps.marker}:${args.id}` }),
  };

  const resolved = createCommandRegistry([command]).get("di-cmd");
  if (!resolved?.create) throw new Error("create seam missing after registration");

  expect(await resolved.create({ marker: "injected" })({ id: "7" })).toEqual({
    id: "injected:7",
  });
});
