import { join, relative } from "path";
import ignore from "ignore";

export interface LeakData {
  line: number;
  match: string;
  pattern: string;
  filePath: string;
  key: string;
}

// Common API key patterns to detect
const API_KEY_PATTERNS = [
  // Google/Gemini API keys
  /AIza[0-9A-Za-z-_]{35}/g,
  // OpenAI API keys
  /sk-[a-zA-Z0-9]{48}/g,
  // Generic API key patterns
  /api[_-]?key["\s]*[:=]["\s]*[a-zA-Z0-9-_]{20,}/gi,
  /secret[_-]?key["\s]*[:=]["\s]*[a-zA-Z0-9-_]{20,}/gi,
  // Bearer tokens
  /bearer[\s]+[a-zA-Z0-9-_]{20,}/gi,
  // JWT tokens (basic detection)
  /eyJ[a-zA-Z0-9-_]+\.[a-zA-Z0-9-_]+\.[a-zA-Z0-9-_]+/g,
  // AWS Access Keys
  /AKIA[0-9A-Z]{16}/g,
  // AWS Secret Keys (very specific to avoid false positives - must contain mixed case and digits)
  // The run is delimited by the lookbehind + trailing negative lookahead, so the full base64-style
  // run is matched at its true bounds — any non-key char (quote, comma, period, bracket, whitespace,
  // EOL) is a valid boundary, since AWS secrets are base64 and may be followed by any delimiter.
  // The run is capped at 128 chars: longer runs are data blobs (stroke tables, encoded payloads),
  // not keys — and the trailing boundary lookahead makes the engine reject over-long runs entirely.
  // The case/digit lookaheads are gated behind the structural 40+ run check, so positions without a
  // 40+ char run are rejected cheaply — an unbounded (?=.*[x]) lookahead costs a full rescan
  // of the line at every scan position.
  /(?<![A-Za-z0-9/+=])(?=[A-Za-z0-9/+=]{40,128})(?=[A-Za-z0-9/+=]*[a-z])(?=[A-Za-z0-9/+=]*[A-Z])(?=[A-Za-z0-9/+=]*[0-9])[A-Za-z0-9/+=]{40,128}(?![A-Za-z0-9/+=])/g,
  // Slack tokens
  /xox[baprs]-[0-9a-zA-Z-]{10,48}/g,
  // Discord tokens
  /[MN][A-Za-z\d]{23}\.[\w-]{6}\.[\w-]{27}/g,
  // GitHub Personal Access Tokens
  /ghp_[0-9a-zA-Z]{36}/g,
  // GitLab Personal Access Tokens
  /glpat-[0-9a-zA-Z-_]{20}/g,
];

// Known safe patterns that might match but are not real API keys
// These patterns help distinguish between real API keys and documentation examples
const WHITE_LIST_PATTERNS = [
  // Documentation examples and placeholders
  // NOTE: no `g` flag on these — they are only used with RegExp.test(), and a
  // stateful lastIndex would cause intermittent false negatives across lines.
  /your[_-]?api[_-]?key/i, // Example: "your-api-key", "your_api_key"
  /your[_-]?actual[_-]?api[_-]?key/i, // Example: "your-actual-api-key"
  /example[_-]?key/i, // Example: "example-key", "example_key"
  /test[_-]?api[_-]?key/i, // Example: "test-api-key", "test_api_key"
  /demo[_-]?key/i, // Example: "demo-key", "demo_key"

  // Template examples that show placeholders
  /your_.*_key/i, // Example: "your_actual_key", "your_secret_key"
  /your_.*_api_key/i, // Example: "your_gemini_api_key"

  // Comment separators and formatting
  /^=+$/, // Example: "=============="
  /^-+$/, // Example: "--------------"
  /^\*+$/, // Example: "**************"
  /^#+$/, // Example: "##############"

  // Safe empty string API key defaults in configuration
  /apiKey:\s*""\s*,?/i, // Example: 'apiKey: "",' or 'apiKey: ""'

  // The ordered base62 alphabet constant (e.g. charset tables for ID generators)
  /0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz/,
];

// Files/directories to exclude from scanning
// CRITICAL SECURITY NOTE: Documentation files (.md, .txt, etc.) should NEVER be excluded!
// Documentation can accidentally contain real API keys that developers copy-paste during writing.
// ONLY exclude build artifacts, dependencies, and this test file itself.
//
// DO NOT ADD: docs/, *.md, README.md, *.txt files to exclusions
// These files MUST be scanned for security compliance.
const EXCLUDE_PATTERNS = [
  "node_modules",
  "dist",
  "build",
  ".git",
  "coverage",
  "bun.lockb",
  // REMINDER: Do not add documentation files here! They must be scanned for security.
];

// File extensions to scan for security issues
// Add new file types here to expand security coverage
const SCANNED_FILE_EXTENSIONS = [
  ".ts", // TypeScript files
  ".tsx",
  ".js", // JavaScript files
  ".jsx",
  ".mjs",
  ".cjs",
  ".md", // Markdown documentation
  ".mdx", // MDX documentation with React components
  ".txt", // Text files
  ".yml", // YAML configuration files
  ".yaml", // YAML configuration files (alternative extension)
  ".json", // JSON configuration files
];

function isSafePattern(text: string, inCodeBlock: boolean): boolean {
  if (inCodeBlock) {
    return true; // Inside a code block
  }

  // Check for comment separators (lines with only repeating characters)
  const trimmedLine = text.trim();
  if (/^[=\-*#]+$/.test(trimmedLine) && trimmedLine.length > 10) {
    return true; // This is a comment separator
  }

  // Check against regular safe patterns
  return WHITE_LIST_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Compute the 1-based line ranges covered by fenced code blocks (```...```)
 * in one pass over the content, so per-line checks don't rescan the file.
 */
function getCodeBlockLineRanges(content: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const lineAt = (index: number) =>
    content.substring(0, index).split("\n").length;

  for (const match of content.matchAll(/```[\s\S]*?```/g)) {
    if (match.index !== undefined) {
      ranges.push([
        lineAt(match.index),
        lineAt(match.index + match[0].length),
      ]);
    }
  }
  return ranges;
}

/**
 * Load custom whitelist from file
 * @param {string} whitelistPath - Path to the whitelist file
 * @returns {Promise<Set<string>>} Set of whitelisted items
 */
const loadCustomWhitelist = async (
  whitelistPath: string
): Promise<Set<string>> => {
  try {
    const { readFile } = await import("fs/promises");
    const content = await readFile(whitelistPath, "utf8");
    const lines = content.split("\n").filter((line) => line.trim() !== "");
    return new Set(lines);
  } catch (error) {
    // Fail fast: a whitelist file that can't be read must not silently
    // disable whitelisting — doing so would report unfiltered leaks as new.
    throw new Error(`Could not read whitelist file ${whitelistPath}: ${error}`);
  }
};

/**
 * Save custom whitelist to file
 * @param {string} whitelistPath - Path to save the whitelist file
 * @param {Set<string>} whitelist - Set of items to save
 */
const saveCustomWhitelist = async (
  whitelistPath: string,
  whitelist: Set<string>
): Promise<void> => {
  const { writeFile } = await import("fs/promises");
  const sortedList = Array.from(whitelist).sort();
  await writeFile(whitelistPath, sortedList.join("\n") + "\n", "utf8");
};

/**
 * Check if an item is in the custom whitelist
 * @param {string} item - Item to check
 * @param {Set<string>} whitelist - Whitelist set
 * @returns {boolean} True if item is whitelisted
 */
const isCustomWhitelisted = (item: string, whitelist: Set<string>): boolean => {
  return whitelist.has(item);
};

/**
 * Add detected leaks to whitelist Set
 * @param {Set<string>} whitelist - Existing whitelist Set
 * @param {Array<{key?: string, match: string}>} leaks - Array of detected leaks
 * @returns {number} Number of new items added
 */
const addLeaksToWhitelist = (
  whitelist: Set<string>,
  leaks: LeakData[]
): number => {
  const initialSize = whitelist.size;
  leaks.forEach((leak) => {
    // Use key if available (file-based), otherwise use match (content-based)
    const entryToAdd = leak.key || leak.match;
    whitelist.add(entryToAdd);
  });
  return whitelist.size - initialSize;
};

/**
 * Recursively scan `dir` for source files, honoring `.gitignore` semantics
 * (negation, anchoring, globs, directory rules) via the `ignore` package.
 * Works in any environment including Docker images without git installed.
 */
async function getAllSourceFiles(
  dir: string,
  ignoreFilePath?: string
): Promise<string[]> {
  const { readdir, readFile } = await import("fs/promises");

  const ig = ignore();
  if (ignoreFilePath) {
    try {
      ig.add(await readFile(ignoreFilePath, "utf8"));
    } catch {
      // Ignore file missing or unreadable — proceed with no gitignore rules
    }
  }

  const files: string[] = [];

  async function scanDirectory(currentDir: string) {
    const entries = await readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);
      const relativePath = relative(dir, fullPath);

      if (!relativePath) continue;

      if (ig.ignores(relativePath)) continue;

      if (EXCLUDE_PATTERNS.some((pattern) => relativePath.includes(pattern))) {
        continue;
      }

      if (entry.isDirectory()) {
        await scanDirectory(fullPath);
      } else if (
        entry.isFile() &&
        SCANNED_FILE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))
      ) {
        files.push(fullPath);
      }
    }
  }

  await scanDirectory(dir);
  return files;
}

export const getSafePattern = () => {
  return {
    API_KEY_PATTERNS,
    WHITE_LIST_PATTERNS,
    EXCLUDE_PATTERNS,
    SCANNED_FILE_EXTENSIONS,
  };
};

export function detectAPIKeyLeaks(
  content: string
): Array<{ line: number; match: string; pattern: string }> {
  const lines = content.split("\n");
  const leaks: Array<{ line: number; match: string; pattern: string }> = [];
  // Code-block line ranges are computed once per file — recomputing them per
  // line would rescan the whole content each time (O(lines × fileSize)).
  const codeBlockRanges = getCodeBlockLineRanges(content);
  const lineIsSafe = (line: string, lineNumber: number) =>
    isSafePattern(
      line,
      codeBlockRanges.some(([s, e]) => lineNumber >= s && lineNumber <= e)
    );

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // The safe-pattern check depends only on the line and its position, so it
    // is evaluated once per line rather than once per match.

    // Ranges already reported on this line. Earlier patterns in API_KEY_PATTERNS
    // are more specific, so an overlapping match from a later (generic) pattern
    // is the same secret reported twice — e.g. a JWT payload segment or the body
    // of an sk- key also satisfying the generic AWS secret-key run pattern.
    const takenRanges: Array<[number, number]> = [];

    for (const pattern of API_KEY_PATTERNS) {
      // exec loop on the shared regex (reset lastIndex first) rather than
      // matchAll — matchAll clones the regex on every call, which dominates
      // runtime on large scans.
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(line)) !== null) {
        // Skip if it's a safe pattern (environment variable reference, comment, etc.)
        if (lineIsSafe(line, i + 1)) continue;

        // Skip URL path fragments: '/' joins path segments into 40+ char runs
        // (e.g. doc links like com/science/article/pii/S1877050924018283), while
        // a real key is a single base64 token and essentially never contains
        // three slashes.
        if (match[0].split("/").length - 1 >= 3) continue;

        const start = match.index ?? 0;
        const end = start + match[0].length;
        if (takenRanges.some(([s, e]) => start < e && end > s)) continue;

        takenRanges.push([start, end]);
        leaks.push({
          line: i + 1,
          match: match[0],
          pattern: pattern.toString(),
        });
      }
    }
  }

  return leaks;
}

export async function detectAPIKeyLeaksWithFiles(
  directory: string,
  ignoreFilePath?: string,
  customWhitelistPath?: string,
  updateWhitelist?: boolean
): Promise<LeakData[]> {
  const { readFile } = await import("fs/promises");

  // Get all source files using existing function, passing ignore file path
  const ignoreFile = ignoreFilePath ?? `${directory}/.gitignore`;
  const files = await getAllSourceFiles(directory, ignoreFile);

  // Load custom whitelist if path provided
  // customWhitelist contains entries like: "src/config.ts:sk-1234567890..." or "docs/api.md:AIzaExample123"
  const customWhitelist = customWhitelistPath
    ? await loadCustomWhitelist(customWhitelistPath)
    : new Set<string>();

  const allLeaks: LeakData[] = [];

  for (const filePath of files) {
    try {
      // Read content from file
      const content = await readFile(filePath, "utf8");

      // Get basic leaks without whitelist filtering (we'll do file-based filtering)
      const basicLeaks = detectAPIKeyLeaks(content);

      // Transform basic leaks to include file info and check against file-based whitelist
      const leaksWithFile = basicLeaks
        .map((leak) => {
          // Key on the path relative to the scanned directory so whitelist
          // files are portable across checkouts and machines.
          const key = `${relative(directory, filePath)}:${leak.match}`;
          return {
            ...leak,
            filePath,
            key,
          };
        })
        .filter((leak) => !isCustomWhitelisted(leak.key, customWhitelist));

      allLeaks.push(...leaksWithFile);
    } catch (error) {
      // Fail fast: an unreadable file must never be silently skipped from a
      // security scan — a skipped file would look like a clean file.
      throw new Error(`Could not read file ${filePath}: ${error}`);
    }
  }

  // Update whitelist if requested and path provided
  if (updateWhitelist && customWhitelistPath && allLeaks.length > 0) {
    const newItemsAdded = addLeaksToWhitelist(customWhitelist, allLeaks);
    await saveCustomWhitelist(customWhitelistPath, customWhitelist);
    console.log(
      `Added ${newItemsAdded} new API key leaks to whitelist: ${customWhitelistPath}`
    );
  }

  return allLeaks;
}
