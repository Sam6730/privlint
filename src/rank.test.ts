import { describe, expect, it } from "vitest";
import { rankFindings } from "./rank.js";
import type { Finding } from "./types.js";

function finding(id: string, severity: Finding["severity"]): Finding {
  return {
    id,
    title: id,
    severity,
    category: "test",
    determination: "checked-in-code",
    consequence: "something bad",
    fix: "do the thing",
  };
}

describe("rankFindings", () => {
  it("orders findings by severity, most severe first", () => {
    const input = [
      finding("a", "low"),
      finding("b", "critical"),
      finding("c", "medium"),
      finding("d", "high"),
    ];

    const ranked = rankFindings(input).map((f) => f.id);

    expect(ranked).toEqual(["b", "d", "c", "a"]);
  });

  it("does not sort by category, only by severity", () => {
    // Two findings of equal severity but different categories keep input order.
    const input = [
      { ...finding("z-secret", "high"), category: "secrets" },
      { ...finding("a-logs", "high"), category: "logging" },
    ];

    const ranked = rankFindings(input).map((f) => f.id);

    expect(ranked).toEqual(["z-secret", "a-logs"]);
  });

  it("returns a new array and does not mutate the input", () => {
    const input = [finding("a", "low"), finding("b", "critical")];
    const originalOrder = input.map((f) => f.id);

    rankFindings(input);

    expect(input.map((f) => f.id)).toEqual(originalOrder);
  });
});
