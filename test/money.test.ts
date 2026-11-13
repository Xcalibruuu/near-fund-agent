import { describe, expect, it } from "vitest";
import { addDecimal, lossBps, subDecimal, toBaseUnits } from "../src/money.js";

describe("money", () => {
  it("converts human amounts to base units", () => {
    expect(toBaseUnits("1", 6)).toBe("1000000");
    expect(toBaseUnits("1.25", 6)).toBe("1250000");
    expect(toBaseUnits("40", 24)).toBe(`${40n * 10n ** 24n}`);
    expect(toBaseUnits("0.42", 18)).toBe(`${42n * 10n ** 16n}`);
  });

  it("adds and subtracts without binary float drift", () => {
    expect(addDecimal("820", "1.5")).toBe("821.5");
    expect(subDecimal("820", "91.16809117")).toBe("728.83190883");
    expect(() => subDecimal("1", "1.0000001")).toThrow(/underflow/);
  });

  it("measures quote loss in basis points", () => {
    expect(lossBps(100, 99)).toBeCloseTo(100, 6);
    expect(lossBps(140.4, 138.9465)).toBeCloseTo(103.5, 0);
  });
});
