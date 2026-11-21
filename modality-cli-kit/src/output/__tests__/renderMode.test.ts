import { describe, test, expect } from "bun:test";
import { getRenderMode, isJsonMode } from "../../output/renderMode";
import { outputFormatEnvNames } from "../../output/output";

describe("getRenderMode", () => {
  test("argv flags take precedence: --jsonl", () => {
    expect(getRenderMode(["node", "cli", "--jsonl"])).toBe("jsonl");
  });

  test("argv flags: --json", () => {
    expect(getRenderMode(["node", "cli", "--json"])).toBe("json");
  });

  test("argv flags: --human", () => {
    expect(getRenderMode(["node", "cli", "--human"])).toBe("human");
  });

  test("defaults to human with no flags/env", () => {
    expect(getRenderMode(["node", "cli"], undefined, {})).toBe("human");
  });

  test("shared OUTPUT env var is consulted when no cliName", () => {
    expect(getRenderMode(["node", "cli"], undefined, { OUTPUT: "json" })).toBe("json");
  });

  test("scoped env var is consulted when cliName given", () => {
    const names = outputFormatEnvNames("use-code-cli");
    const scoped = names[0]!;
    const env: Record<string, string | undefined> = {};
    env[scoped] = "jsonl";
    expect(getRenderMode(["node", "cli"], "use-code-cli", env)).toBe("jsonl");
  });

  test("scoped env var takes precedence over shared OUTPUT", () => {
    const names = outputFormatEnvNames("use-code-cli");
    const scoped = names[0]!;
    const env: Record<string, string | undefined> = { OUTPUT: "human" };
    env[scoped] = "json";
    expect(getRenderMode(["node", "cli"], "use-code-cli", env)).toBe("json");
  });

  test("env value is case-insensitive", () => {
    expect(getRenderMode(["node", "cli"], undefined, { OUTPUT: "JSON" })).toBe("json");
  });

  test("unrecognized env value degrades to human", () => {
    expect(getRenderMode(["node", "cli"], undefined, { OUTPUT: "nope" })).toBe("human");
  });

  test("argv flag beats env", () => {
    expect(getRenderMode(["node", "cli", "--human"], undefined, { OUTPUT: "json" })).toBe("human");
  });
});

describe("isJsonMode", () => {
  test("true for json/jsonl", () => {
    expect(isJsonMode(["node", "cli", "--json"], undefined, {})).toBe(true);
    expect(isJsonMode(["node", "cli", "--jsonl"], undefined, {})).toBe(true);
  });

  test("false for human", () => {
    expect(isJsonMode(["node", "cli"], undefined, {})).toBe(false);
  });
});
