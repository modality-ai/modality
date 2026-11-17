import { describe, test, expect } from "bun:test";
import { detectAPIKeyLeaks } from "../index";

describe("AWS API Keys detection", () => {
  test("should detect AWS Access Keys", () => {
    // Testing pattern: /AKIA[0-9A-Z]{16}/g
    const content = 'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE';
    const result = detectAPIKeyLeaks(content);
    
    expect(result).toHaveLength(1);
    expect(result[0].match).toBe("AKIAIOSFODNN7EXAMPLE");
  });

  test("should detect AWS Secret Keys", () => {
    // Testing pattern: /(?<![A-Za-z0-9/+=])(?=[A-Za-z0-9/+=]{40,}(?=\s|$|["']))(?=[A-Za-z0-9/+=]*[a-z])(?=[A-Za-z0-9/+=]*[A-Z])(?=[A-Za-z0-9/+=]*[0-9])[A-Za-z0-9/+=]{40,}(?=\s|$|["'])/g
    // Note: AWS Secret Keys have very strict requirements - mixed case, numbers, exactly 40 chars
    const content = 'SECRET_ACCESS_KEY="Aa1bcdefghijklmnopqrstuvwxyz1234567890+=" ';
    const result = detectAPIKeyLeaks(content);
    
    expect(result.length).toBeGreaterThan(0);
    expect(result.some(r => r.match === "Aa1bcdefghijklmnopqrstuvwxyz1234567890+=")).toBe(true);
  });
});