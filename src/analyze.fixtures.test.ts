import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyze } from "./analyze.js";
import { UNANSWERED_INTERVIEW } from "./types.js";
import type { LlmClient, Report } from "./types.js";

/**
 * Integration coverage: run the real `analyze` seam in-process against the three
 * committed fixture repos (leaky / clean / middling). This is the same path CI
 * exercises, and the clean-repo assertion is the hard gate — a regression that
 * introduces a false positive must fail here.
 */

const fixture = (name: string) =>
  fileURLToPath(new URL(`../test/fixtures/${name}`, import.meta.url));

// No judgment checks are wired yet, so analyze must never touch the LLM client.
const failingLlmClient: LlmClient = {
  async complete() {
    throw new Error("LLM client should not be called yet");
  },
};

const run = (name: string): Promise<Report> =>
  analyze(fixture(name), UNANSWERED_INTERVIEW, failingLlmClient);

describe("analyze — fixture repos", () => {
  it("flags the leaky repo's committed secrets, most severe first", async () => {
    const report = await run("leaky");

    expect(report.findings.length).toBeGreaterThanOrEqual(2);
    // Ranked by severity: the critical provider key leads.
    expect(report.findings[0]?.severity).toBe("critical");
    expect(report.findings.some((f) => f.title.includes("AWS access key ID"))).toBe(true);
    // Every finding is a committed-secret fact.
    expect(
      report.findings.every(
        (f) => f.category === "secrets" && f.determination === "checked-in-code",
      ),
    ).toBe(true);
  });

  it("keeps the clean repo silent — the hard CI gate against false positives", async () => {
    const report = await run("clean");
    expect(report.findings).toEqual([]);
  });

  it("flags the middling repo's single hard-coded secret", async () => {
    const report = await run("middling");

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]).toMatchObject({
      category: "secrets",
      determination: "checked-in-code",
      severity: "high",
    });
  });
});
