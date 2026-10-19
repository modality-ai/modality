# `modality-cli-kit`

Composable CLI utilities for building Bun/TypeScript command-line tools.

## Help Kit (`src/help/`)

A reusable CLI help generation system that powers both the co-chrome and use-stock CLIs.

### Features

- **Declarative metadata** — Define commands as typed data, not template strings
- **Bun-style ANSI colors** — Auto-detects TTY, respects `NO_COLOR`
- **Global help** — Lists all commands with one-line summaries
- **Per-command help** — Detailed flags, usage, and examples per command
- **Flag validation** — Rejects unknown flags with fuzzy-match suggestions
- **Optional-value flags** — One flag can be used bare (`--pin`) or with a value (`--pin 44460`)
- **Semantic helpers** — `cmd()`, `header()`, `opt()`, `arg()`, `dim()`, `example()`, etc.
- **Zero runtime dependencies** — Pure TypeScript

### Quick Start

```ts
import { getHelp } from "modality-cli-kit";
import type { CLICommand } from "modality-cli-kit";

const commands: CLICommand[] = [
  {
    name: "open",
    summary: "Navigate to a URL",
    options: [{ flag: "--url", arg: "<url>", desc: "The URL to open" }],
    examples: ["my-cli open --url https://example.com"],
  },
  {
    name: "click",
    summary: "Click an element",
    options: [{ flag: "--selector", arg: "<sel>", desc: "CSS selector" }],
    examples: ["my-cli click --selector button.submit"],
  },
];

// Global help
console.log(
  getHelp({
    cliName: "my-cli",
    tagline: "My CLI tool",
    commands,
  })
);

// Per-command help
console.log(getHelp({ cliName: "my-cli", commands, command: "open" }));
```

### API

| Function                                                   | Purpose                               |
| ---------------------------------------------------------- | ------------------------------------- |
| `getHelp(options)`                                         | Unified entry: global or per-command  |
| `defineCliConfig(config)`                                  | Declare the CLI config once, shared by `createCliRunner` and `getHelp` |
| `renderSection(heading, entries)`                          | Render a categorized command section  |
| `rejectUnknownFlags(command, args)`                        | Validate args against known flags     |
| `knownFlags(command, extraFlags?)`                         | Extract known flag set                |
| `levenshtein(a, b)`                                        | Edit distance for fuzzy flag matching |
| `optionalValueFlag(whenBare, whenOff?)`                    | Schema for a flag usable bare OR with a value |
| `autoDefault(whenBare, whenOff?)`                          | The `.transform()` behind it, for custom unions |

#### `getHelp(options)` Options

```ts
interface GetHelpOptions {
  cliName: string;           // CLI binary name, e.g. "my-cli"
  tagline?: string;          // One-line description (global help only)
  commands: CLICommand[];    // All commands to document
  format?: "human" | "json"; // Output format (default: "human")
  command?: string;          // Show help for a specific command by name
  sorted?: boolean;          // Sort commands alphabetically (default: true)
  globalOptions?: Option[];  // Global flags shown in footer
  globalExamples?: string[]; // Global usage examples
  footer?: string;           // Footer text (e.g. "Set NO_COLOR=1 …")
  colNameWidth?: number;     // Command-name column width
}
```

> `commands` (plural, required) is the full list of available commands. `command` (singular, optional) picks one from that list to show detailed help for.

### Optional-Value Flags

A flag's Zod type decides how argv is parsed:

| Shape | Schema | `--flag` alone | `--flag x` |
|---|---|---|---|
| Boolean switch | `z.boolean().optional()` | `true` | next token NOT consumed |
| Required value | `z.string()` / `z.coerce.number()` | error: *requires a value* | `"x"` / `x` |
| **Optional value** | `optionalValueFlag("auto")` | `"auto"` | `"x"` |

```ts
import { optionalValueFlag } from "modality-cli-kit";

const Args = z.object({
  pin: optionalValueFlag("auto").describe("bare = auto-pick; or pass a level"),
});

// --pin          → "auto"      (whenBare)
// --pin 44460    → "44460"
// --pin=noauto   → "noauto"
// --no-pin       → ""          (whenOff; override: optionalValueFlag("auto", "none"))
// (absent)       → undefined   (never invents a value)
```

It expands to `z.union([z.boolean(), z.string()]).optional().transform(autoDefault(whenBare, whenOff))`.
The **boolean member** is what makes the bare form parse; the transform folds it away so handlers
receive `string | undefined` and never `true`.

**Do not use `.default()` for this.** A Zod default fires when the flag is ABSENT, which turns the
feature on for every invocation that never mentioned it — a different thing from "given without a
value". Absent must stay `undefined` so a handler can tell "not requested" from "requested with
defaults".

#### Parser rules

- A bare optional-value flag **does not consume the next token when it looks like a flag** —
  `--pin --human` parses as `pin: "auto"` + `human: true`.
- **Negative numbers are values**: `--offset -5` → `-5`, while `--offset --verbose` errors.
- `--flag=value` always wins over the next-token rule.
- These rules apply to every value-taking flag, not just optional-value ones.

#### `autoDefault` for custom unions

`optionalValueFlag` hardcodes a free-string value member. When the value side needs its own schema,
build the union yourself and reuse the transform:

```ts
mode: z.union([z.boolean(), z.enum(["fast", "slow"])])
  .optional()
  .transform(autoDefault("fast")),
// --mode → "fast" · --mode slow → "slow" · --mode bogus → warning `mode: Invalid input`
```

Caveat: the union validates the **input**, so the transform's output is not re-checked — `--no-mode`
yields `whenOff` (`""`) even though it is not an enum member. Pass a valid member as the second
argument when the off-value must satisfy the same constraint.

### Color Helpers

```ts
import {
  cmd,
  header,
  opt,
  arg,
  dim,
  bold,
  example,
  success,
  error,
} from "modality-cli-kit/help";

console.log(cmd("my-cli open")); // cyan bold
console.log(header("Usage:")); // yellow bold
console.log(opt("--config")); // green
console.log(arg("<file>")); // blue
console.log(dim("description")); // gray dim
console.log(success("✓ done")); // green bold
console.log(error("✗ failed")); // red
```

## Resolving the Command in an aiTool

When Counter runs a method script (e.g. the kit's `skill` default command), it calls the script as `counterScript({ ...methodParams, _ctx: context })`, and the props carry no `command` selector. The context arrives merged into the single props argument as `_ctx`, and `resolveAiToolCommand` strips it from the returned args:

```ts
import { resolveAiToolCommand, type AiToolContext } from "modality-cli-kit";

type SkillProps = z.infer<typeof SkillSchema> & { _ctx?: AiToolContext };

async execute(props: SkillProps) {
  const { command, ...args } = resolveAiToolCommand(props);
  if (!command) return cli.getHelp();
  if (!registry.get(command)) return undefined; // kit default such as `skill`
  return registry.execute(command, args);
}
```

Requires `@modality-counter/core` with the `command` context argument on `toCounterCLI`.

## Output Format from the Environment

Set the format once instead of repeating `--json` on every command in a chain:

```bash
export OUTPUT=json
use-stock price && use-stock direction
```

`createCliRunner` reads a CLI-scoped variable first, then the shared one — so one tool's setting can't leak into another's:

| Source | Example | Wins over |
|---|---|---|
| Explicit flag | `--json` / `--jsonl` | everything |
| CLI-scoped env | `USE_STOCK_OUTPUT=json` | `OUTPUT` |
| Shared env | `OUTPUT=json` | the default |
| Default | — | `human` |

Accepted values are `human`, `json`, `jsonl` (case-insensitive). An unrecognized value is reported on stderr and ignored, so a typo degrades to the default rather than failing the run.

> **`VAR=x cmd1 && cmd2` sets the variable for `cmd1` only.** A command-prefix assignment scopes to that one command. Use `export OUTPUT=json` (or prefix each command) for a whole chain.

### It rewrites argv, not just the renderer

Handlers commonly read their own `--json` flag to decide what to print. If the environment only changed the *render* format, a handler could print human text that the runner then wrapped as JSON. So the runner appends the matching flag to argv, keeping validation, the handler, and the renderer on one source of truth.

Consequences worth knowing:

- A flag is injected only when the CLI keeps it globally — `json`, `human`, `no-cache`, and `trace` are on by default; drop one with `withoutDefaultGlobalOption`. A non-default flag (e.g. `jsonl`) must be declared in `globalOptionsSchema`, or per-command validation would reject the flag the runner just added.
- `human` injects `--human` by default (it is a default global option), so handlers that read `--human` get it from `OUTPUT=human` too. Only a CLI that drops `human` via `withoutDefaultGlobalOption` keeps `--human` as a per-command flag the environment never supplies.
- Commands your package dispatches before delegating to the runner (raw-passthrough argv) never see the injection.

## Project `.env` from Any Directory

Bun loads `.env` from the working directory only, which never fires for a globally installed bin. `createCliRunner` closes that gap: `run()` loads the project's `.env` before dispatch, so a CLI works the same from anywhere.

```bash
cd /tmp && use-job-hunt search    # still reads <package>/.env
```

The file is found by walking up from the running entry script — `process.argv[1]`, which the runtime resolves to the real path even through a `node_modules/.bin` symlink — to the nearest `.env`. A kit cannot do this from `import.meta.dir`, since inside a dependency that points at `node_modules/modality-cli-kit/dist/`.

The walk stops at the project root, so a globally installed bin never reads a `.env` that isn't the project's: it passes through `node_modules` (that is how a locally installed CLI reaches the project that installed it) but goes no higher than the first `package.json` outside it.

| Setting | Behavior |
|---|---|
| *(omitted)* | Walk up from the entry script to the nearest `.env`, stopping at the project root |
| `envFile: "/abs/path/.env"` | Read that file instead of walking |
| `envFile: false` | Load nothing; run on the ambient environment |

A variable already in the environment wins over the file, so `FOO=bar use-job-hunt search` still beats `.env`. A missing, unreadable, or unparsable file leaves the environment untouched — nothing to load is the common case, not an error.

Because the walk reads the real filesystem, a test that asserts on argv or output should pass `envFile: false` — otherwise the developer's own `.env` can reach it.

Call it directly when a CLI owns its own entry point:

```ts
import { loadProjectEnv } from "modality-cli-kit";

loadProjectEnv();                      // walk up from process.argv[1]
loadProjectEnv({ envFile: false });    // no-op
const path = loadProjectEnv();         // the file read, or undefined
```

## Tracing Dispatch with `--trace`

A CLI that misbehaves usually misbehaves *before* the handler runs: the wrong command resolved, an env var injected a format flag, an arg coerced to something unexpected. `--trace` turns that path into output.

```bash
use-stock pric --trace
[trace] use-stock: argv ["pric","--trace"]
[trace] use-stock: output format human
[trace] use-stock: resolved command pric -> price
[trace] use-stock: validated args {"trace":true}
[trace] use-stock: dispatch command.execute
```

- **Silence is the contract.** Without the flag the tracer is inert — no strings built, not one byte written.
- **Lines go to stderr, never stdout.** stdout is the data channel, so `cli cmd --json --trace | jq` stays valid and the trace still reaches the terminal.
- **It traces failures too** — an ambiguous or unknown command, a validation rejection, and the stack of an unexpected throw (which is otherwise suppressed in favor of just the message).
- **Secret-looking keys are redacted.** Values under keys matching `token`, `key`, `secret`, `password`, `auth`, or `credential` render as `***`, since trace output lands in CI logs and bug reports.
- It is a default global option, so drop it with `withoutDefaultGlobalOption: ["trace"]` like any other.

## Command Registry

`createCommandRegistry` resolves command names, aliases, and unique prefixes, then dispatches to each command's own `execute`.

### Scan a directory (`createCommandRegistryFromDir`)

The commands folder *is* the index — there is no module listing imports:

```ts
import { createCommandRegistryFromDir, resolveCommandsDir } from "modality-cli-kit";

export const registry = await createCommandRegistryFromDir(
  resolveCommandsDir({ from: import.meta.url }),
);
```

Every file in `commandsDir` that exports a `*Command` is registered. Adding a command is dropping in a file; removing one is deleting that file. Nothing else is edited, so no central list can be left pointing at a command that no longer exists.

The scan accepts a `file:` URL or an absolute path, loads both `.ts` and `.js` (the same directory is source in development and build output in `dist`), and ignores `.d.ts`, `.test.*`, and `.spec.*`. A file that exports no command — or that throws while importing — is reported on stderr and skipped, so one broken module cannot take `--help` and every working command down with it. `setupCommandExportValidation` is the strict counterpart: it fails the build on exactly those files, which is where strictness is free.

Use `loadCommandsFromDir` when you want the array rather than a registry, and `exportSuffix` when your commands export something other than `*Command`.

> **Bundled CLIs must emit the command files.** A bundler only emits modules something imports, and scanning imports nothing statically — so name the directory as an entrypoint glob (`bun build ./src/cli.ts ./src/scripts/commands/*.ts …`), or the scan finds an empty directory at runtime.
>
> For the same reason, resolve the directory from the **package root**, not from `import.meta.url`: the module that calls the scan is inlined into whichever chunk the bundler chooses, so `import.meta.url` reports that chunk's location rather than the source file's.

### Manual index

Pass commands explicitly when you want the list under version control:

```ts
export const registry = createCommandRegistry([fooCommand, barCommand]);
```

### Aliases

A command declares its own:

```ts
export const barCommand: CLICommand = {
  name: "bar",
  aliases: ["b", "baz"],
  …
};
```

Declaring them on the command is what makes a scanned registry self-maintaining — the file is the command's only declaration, so deleting it removes its aliases too.

The optional second argument to either constructor overrides that per command:

```ts
createCommandRegistry(commands, { bar: ["b"] });  // `bar`'s own aliases are ignored
```

A command the map does not name keeps its own list, and an empty array (`{ bar: [] }`) deliberately removes a command's aliases.

## Default Commands (`src/defaultCommands/`)

https://github.com/modality-ai/modality/tree/main/modality-cli-kit/src/defaultCommands/commands

Commands `createCliRunner` registers on your CLI's behalf. You declare nothing — they show up in `--help` and dispatch like any other command.

Adding one is a change to that folder alone: drop the module in beside `merge.ts` and add its factory to `DEFAULT_COMMANDS`. The `DefaultCommandName` union widens automatically, so `withoutDefaultCommand` accepts the new name with no further wiring.

### `merge` — fold a piped chain into one document

A shell `&&` chain writes several independent JSON documents to one stdout stream. `merge` reads that stream and emits a single payload:

```bash
{ use-stock symbol --json && use-stock price --json; } | use-stock merge --json
```
```json
{ "success": true, "result": [ { "symbol": "TXF-S", … }, { "tilt": "long", … } ] }
```

> **The braces are required.** `|` binds tighter than `&&`, so `a && b | merge` pipes only `b` into the sink and lets `a` escape to the terminal. Nothing on the CLI side can recover stdout that never entered the pipe.

What it does to each document:

| Input shape | Result | Why |
|---|---|---|
| `{ success, result }` | unwrapped to `result` | the standard envelope |
| `{ success: true }` alone | dropped | the empty trailer a self-printing command leaves behind |
| `{ success: false, error }` | kept | failures must stay visible |
| anything else | kept as-is | a payload the command printed itself |
| prose between documents | ignored | progress lines on stdout don't break the parse |

Documents are found by delimiter balance, not line breaks, so pretty-printed `--json` output parses as readily as JSONL.

`--flat` shallow-merges the payloads into one object, later document winning on a key collision. Lossy — only use it when the payloads have disjoint keys.

### Opting out

```ts
createCliRunner({ …, withoutDefaultCommand: true });       // register none
createCliRunner({ …, withoutDefaultCommand: ["merge"] });  // register all but these
```

A command your own registry defines under a default's name always wins, so shadowing needs no opt-out.

### Using the parts directly

```ts
import { splitJsonDocs, mergeJsonDocs, createMergeCommand } from "modality-cli-kit";

splitJsonDocs('{"a":1}\n{"b":2}');            // [{ a: 1 }, { b: 2 }]
mergeJsonDocs(text, { flat: true });          // one shallow-merged object
createMergeCommand({ cliName: "my-cli" });    // the CLICommand, to register manually
```

## Repository

- **Git**: https://github.com/modality-ai/modality/tree/main/modality-cli-kit 
- **NPM**: https://www.npmjs.com/package/modality-cli-kit
