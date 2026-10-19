import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { loadProjectEnv } from "../loadProjectEnv";

const KEY = "CLI_KIT_ENV_TEST_VALUE";
// Empty until a test builds a tree, so cleanup only runs after one did.
let root = "";

/** A throwaway tree; returns the created directories' absolute paths. */
function makeTree(): { pkg: string; nested: string; entry: string } {
  root = mkdtempSync(join(tmpdir(), "cli-kit-env-"));
  const pkg = join(root, "pkg");
  const nested = join(pkg, "dist", "runner");
  mkdirSync(nested, { recursive: true });
  return { pkg, nested, entry: join(nested, "cli.js") };
}

beforeEach(() => {
  delete process.env[KEY];
});

afterEach(() => {
  delete process.env[KEY];
  if (root) rmSync(root, { recursive: true, force: true });
});

describe("loadProjectEnv", () => {
  test("walks up from the entry script to the nearest .env", () => {
    const { pkg, entry } = makeTree();
    writeFileSync(join(pkg, ".env"), `${KEY}=from-pkg\n`);

    expect(loadProjectEnv({ entry })).toBe(join(pkg, ".env"));
    expect(process.env[KEY]).toBe("from-pkg");
  });

  test("nearest wins — a deeper .env shadows the package one", () => {
    const { pkg, nested, entry } = makeTree();
    writeFileSync(join(pkg, ".env"), `${KEY}=outer\n`);
    writeFileSync(join(nested, ".env"), `${KEY}=inner\n`);

    expect(loadProjectEnv({ entry })).toBe(join(nested, ".env"));
    expect(process.env[KEY]).toBe("inner");
  });

  test("keeps walking up past directories without a .env", () => {
    const { pkg, entry } = makeTree();
    mkdirSync(join(pkg, "deep", "deeper"), { recursive: true });
    writeFileSync(join(pkg, ".env"), `${KEY}=found\n`);

    expect(loadProjectEnv({ entry: join(pkg, "deep", "deeper", "cli.js") })).toBe(
      join(pkg, ".env")
    );
    expect(process.env[KEY]).toBe("found");
  });

  test("returns undefined and changes nothing when no .env exists", () => {
    const { entry } = makeTree();

    expect(loadProjectEnv({ entry })).toBeUndefined();
    expect(process.env[KEY]).toBeUndefined();
  });

  test("an existing environment variable beats the file", () => {
    const { pkg, entry } = makeTree();
    writeFileSync(join(pkg, ".env"), `${KEY}=from-file\n`);
    process.env[KEY] = "from-shell";

    loadProjectEnv({ entry });
    expect(process.env[KEY]).toBe("from-shell");
  });

  test("an explicit envFile is read instead of walking", () => {
    const { pkg, entry } = makeTree();
    const other = join(pkg, "custom.env");
    writeFileSync(join(pkg, ".env"), `${KEY}=nearest\n`);
    writeFileSync(other, `${KEY}=explicit\n`);

    expect(loadProjectEnv({ envFile: other, entry })).toBe(other);
    expect(process.env[KEY]).toBe("explicit");
  });

  test("envFile: false loads nothing, even when a .env is right there", () => {
    const { pkg, entry } = makeTree();
    writeFileSync(join(pkg, ".env"), `${KEY}=ignored\n`);

    expect(loadProjectEnv({ envFile: false, entry })).toBeUndefined();
    expect(process.env[KEY]).toBeUndefined();
  });

  test("a missing explicit envFile is not an error", () => {
    const { pkg, entry } = makeTree();

    expect(loadProjectEnv({ envFile: join(pkg, "nope.env"), entry })).toBeUndefined();
    expect(process.env[KEY]).toBeUndefined();
  });

  test("quoted values and inner quotes survive parsing", () => {
    const { pkg, entry } = makeTree();
    writeFileSync(join(pkg, ".env"), `${KEY}='("a" OR "b") (c OR d)'\n`);

    loadProjectEnv({ entry });
    expect(process.env[KEY]).toBe('("a" OR "b") (c OR d)');
  });

  test("defaults the entry to the running script when none is given", () => {
    const { pkg } = makeTree();
    writeFileSync(join(pkg, ".env"), `${KEY}=from-argv1\n`);
    const original = process.argv[1];
    process.argv[1] = join(pkg, "dist", "runner", "cli.js");
    try {
      expect(loadProjectEnv()).toBe(join(pkg, ".env"));
      expect(process.env[KEY]).toBe("from-argv1");
    } finally {
      // `argv[1]` is absent under `bun -e`, so restore it rather than assign
      // back a possibly-undefined value.
      if (original === undefined) delete process.argv[1];
      else process.argv[1] = original;
    }
  });

  test("loads nothing when there is no entry to walk up from", () => {
    const original = process.argv[1];
    // `bun -e` and `node -e` run with no entry script at all, so there is no
    // directory to start the walk from.
    delete process.argv[1];
    try {
      expect(loadProjectEnv()).toBeUndefined();
    } finally {
      if (original !== undefined) process.argv[1] = original;
    }
  });

  test("an empty entry is treated as no entry", () => {
    expect(loadProjectEnv({ entry: "" })).toBeUndefined();
  });

  /** A tree whose nearest `.env` is a directory, so reading it throws. */
  function makeUnreadableTree() {
    const tree = makeTree();
    writeFileSync(join(tree.pkg, ".env"), `${KEY}=real\n`);
    // The walk stops at the first `.env`, so this directory shadows the real
    // file above it — `readFileSync` throws on the directory.
    mkdirSync(join(tree.nested, ".env"));
    return tree;
  }

  test("an unreadable .env is not an error", () => {
    const { entry } = makeUnreadableTree();

    expect(loadProjectEnv({ entry })).toBeUndefined();
  });

  test("an unreadable .env leaves the environment untouched", () => {
    const { entry } = makeUnreadableTree();

    loadProjectEnv({ entry });
    expect(process.env[KEY]).toBeUndefined();
  });

  test("applies keys independently — only unset ones come from the file", () => {
    const { pkg, entry } = makeTree();
    const other = "CLI_KIT_ENV_TEST_OTHER";
    writeFileSync(join(pkg, ".env"), `${KEY}=from-file\n${other}=from-file\n`);
    process.env[other] = "from-shell";
    try {
      loadProjectEnv({ entry });
      expect([process.env[KEY], process.env[other]]).toEqual([
        "from-file",
        "from-shell",
      ]);
    } finally {
      delete process.env[other];
    }
  });

  /**
   * A package installed under `node_modules`, inside a project that has its own
   * `.env`. Returns the entry script the runtime would report for it.
   */
  function makeInstalledCli(options: { projectEnv: boolean }) {
    root = mkdtempSync(join(tmpdir(), "cli-kit-install-"));
    const project = join(root, "project");
    const cli = join(project, "node_modules", "some-cli");
    const dist = join(cli, "dist");
    mkdirSync(dist, { recursive: true });
    writeFileSync(join(project, "package.json"), '{"name":"consumer"}');
    writeFileSync(join(cli, "package.json"), '{"name":"some-cli"}');
    if (options.projectEnv) writeFileSync(join(project, ".env"), `${KEY}=project\n`);
    return { project, cli, entry: join(dist, "cli.js") };
  }

  test("walks past node_modules to the consuming project's .env", () => {
    const { project, entry } = makeInstalledCli({ projectEnv: true });

    expect(loadProjectEnv({ entry })).toBe(join(project, ".env"));
  });

  test("stops at the project root rather than reading an unrelated .env above it", () => {
    const { entry } = makeInstalledCli({ projectEnv: false });
    // The directory above the project holds a `.env` that is none of this CLI's
    // business — the case a globally installed bin would otherwise hit.
    writeFileSync(join(root, ".env"), `${KEY}=unrelated\n`);

    expect(loadProjectEnv({ entry })).toBeUndefined();
  });

  test("a global install walking out of node_modules reads nothing above it", () => {
    root = mkdtempSync(join(tmpdir(), "cli-kit-global-"));
    const prefix = join(root, "prefix");
    const entry = join(prefix, "lib", "node_modules", "some-cli", "dist", "cli.js");
    mkdirSync(dirname(entry), { recursive: true });
    writeFileSync(join(prefix, ".env"), `${KEY}=unrelated\n`);

    expect(loadProjectEnv({ entry })).toBeUndefined();
  });
});
