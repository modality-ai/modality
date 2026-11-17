import { test, expect } from "bun:test";
import { join } from "path";

const EXPECTED_HASH = 15958936344753800022n;
const filePath = join(import.meta.dir, "../index.ts");
const SECURITY_TEST_FILE = Bun.file(filePath);

test("security validation test file hash matches", async () => {
  const content = await SECURITY_TEST_FILE.text();
  const currentHash = Bun.hash(content);
  expect(currentHash).toBe(EXPECTED_HASH);
});
