import { describe, test, expect } from "bun:test";
import { markRawArgv, takesRawArgv } from "../internal";
import { createCommandRegistry } from "../../lib/registry";
import type { CLICommand } from "../../help/types";

// The raw-argv lock is the one place a command can skip runner validation, so
// these tests exist to keep that hole exactly as narrow as it is today. If one
// of them starts failing, the lock has widened — do not "fix" it by loosening
// the assertion.

const makeCommand = (name: string) =>
  ({ name, description: "x", execute: async () => ({ success: true }) }) as unknown as CLICommand;

describe("raw-argv lock", () => {
  test("an unmarked command is not granted the raw path", () => {
    expect(takesRawArgv(makeCommand("plain"))).toBe(false);
  });

  test("marking grants it, and returns the same object for chaining", () => {
    const command = makeCommand("marked");
    expect(markRawArgv(command)).toBe(command);
    expect(takesRawArgv(command)).toBe(true);
  });

  test("the mark is per object, not per name", () => {
    markRawArgv(makeCommand("skill"));
    // A different object with the same name gains nothing from the first.
    expect(takesRawArgv(makeCommand("skill"))).toBe(false);
  });

  test("a spread copy does NOT inherit the mark", () => {
    // This is the trap the WeakSet exists to avoid. `createCliRunner` builds
    // `{ ...cmd, aliases }` copies for help generation; if the mark rode along
    // on a property, those copies would carry it and the lock would be a lie.
    // Dispatch must keep using the original object the registry holds.
    const command = markRawArgv(makeCommand("skill"));
    expect(takesRawArgv({ ...command })).toBe(false);
  });

  test("the mark leaves no trace on the object", () => {
    // Nothing to discover by inspection, so nothing to copy or forge: no own
    // key (string or symbol), and nothing that survives serialization.
    const command = markRawArgv(makeCommand("skill"));
    const plain = makeCommand("skill");
    expect(Reflect.ownKeys(command)).toEqual(Reflect.ownKeys(plain));
    expect(Object.getOwnPropertySymbols(command)).toEqual([]);
    expect(JSON.parse(JSON.stringify(command))).toEqual(JSON.parse(JSON.stringify(plain)));
  });

  test("registration drops the mark — the runner must re-apply it", () => {
    // `createCommandRegistry` normalizes commands into `{ ...cmd, summary,
    // description }`, so the object it hands to dispatch is never the one the
    // factory returned. This is pinned rather than worked around: if the
    // registry ever stops copying, the re-marking in `createCliRunner` becomes
    // dead code and should be removed with this test.
    const command = markRawArgv(makeCommand("skill"));
    const registered = createCommandRegistry([command]).get("skill")!;
    expect(registered).not.toBe(command);
    expect(takesRawArgv(registered)).toBe(false);
  });

  test("an outside object cannot fake membership", () => {
    // Every shape an outsider might reach for, none of which the lock reads.
    const faked = {
      ...makeCommand("skill"),
      rawArgs: true,
      rawArgv: true,
      [Symbol.for("rawArgv")]: true,
    } as unknown as CLICommand;
    expect(takesRawArgv(faked)).toBe(false);
  });
});
