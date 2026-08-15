import { describe, expect, it } from "vitest";
import { makePalette, shouldColorize } from "./color.js";

describe("shouldColorize", () => {
  // A truth table over the predicate: one case per branch, plus the
  // conflict-precedence cases. No CLI is spawned — the predicate is pure.
  it("follows the terminal when no signal overrides it", () => {
    expect(shouldColorize({ isTTY: true, env: {}, noColorFlag: false })).toBe(true);
    expect(shouldColorize({ isTTY: false, env: {}, noColorFlag: false })).toBe(false);
  });

  it("suppresses color when --no-color is set, even on a TTY", () => {
    expect(shouldColorize({ isTTY: true, env: {}, noColorFlag: true })).toBe(false);
  });

  it("honors NO_COLOR over a TTY", () => {
    expect(shouldColorize({ isTTY: true, env: { NO_COLOR: "1" }, noColorFlag: false })).toBe(false);
  });

  it("ignores an empty NO_COLOR", () => {
    expect(shouldColorize({ isTTY: true, env: { NO_COLOR: "" }, noColorFlag: false })).toBe(true);
  });

  it("lets NO_COLOR override FORCE_COLOR", () => {
    expect(
      shouldColorize({ isTTY: false, env: { NO_COLOR: "1", FORCE_COLOR: "1" }, noColorFlag: false }),
    ).toBe(false);
  });

  it("enables color off a terminal when FORCE_COLOR is set", () => {
    expect(shouldColorize({ isTTY: false, env: { FORCE_COLOR: "1" }, noColorFlag: false })).toBe(true);
  });

  it("treats FORCE_COLOR=0 and FORCE_COLOR=false as off", () => {
    expect(shouldColorize({ isTTY: true, env: { FORCE_COLOR: "0" }, noColorFlag: false })).toBe(false);
    expect(shouldColorize({ isTTY: true, env: { FORCE_COLOR: "false" }, noColorFlag: false })).toBe(false);
  });
});

describe("makePalette", () => {
  it("is the identity function when disabled", () => {
    const palette = makePalette(false);
    expect(palette.boldRed("x")).toBe("x");
    expect(palette.dim("x")).toBe("x");
    expect(palette.green("x")).toBe("x");
  });

  it("wraps text in escape codes when enabled", () => {
    const palette = makePalette(true);
    // eslint-disable-next-line no-control-regex
    expect(palette.green("ok")).toMatch(/\x1b\[/);
    expect(palette.green("ok")).toContain("ok");
  });
});
