import { describe, expect, it } from "vitest";
import { parseId } from "./params";

describe("parseId", () => {
  it.each([
    ["1", 1],
    ["42", 42],
    ["2147483647", 2147483647],
  ])("accepts %s", (raw, expected) => {
    expect(parseId(raw)).toBe(expected);
  });

  it.each(["", "0", "-1", "01", "1.0", "1.5", "1e3", " 1", "1 ", "0x10", "abc", "2147483648", "99999999999"])(
    "rejects %j",
    (raw) => {
      expect(parseId(raw)).toBeNull();
    }
  );
});
