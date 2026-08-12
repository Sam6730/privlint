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

// These fixtures isolate the deterministic checks — the clean-repo silence gate
// is about false positives in code-level facts, not judgment. Running with an
// unavailable client skips the Reason stage; the throw guards against analyze
// ever calling a client it was told is not configured.
const failingLlmClient: LlmClient = {
  available: false,
  async complete() {
    throw new Error("unavailable LLM client should not be called");
  },
};

const run = (name: string): Promise<Report> =>
  analyze(fixture(name), UNANSWERED_INTERVIEW, failingLlmClient);

describe("analyze — fixture repos", () => {
  it("flags the leaky repo's secret and both leaks, most severe first", async () => {
    const report = await run("leaky");

    // Ranked by severity: the critical provider key leads.
    expect(report.findings[0]?.severity).toBe("critical");
    expect(report.findings.some((f) => f.title.includes("AWS access key ID"))).toBe(true);

    const ids = report.findings.map((f) => f.id);
    // The committed-secrets check and both leak checks all fire on this repo.
    expect(ids).toContain("committed-secrets");
    expect(ids).toContain("pii-in-logs");
    expect(ids).toContain("pii-in-urls-analytics");
    // The repo collects personal data but ships no /privacy, deletion, or export
    // path, so all three missing-path checks fire too.
    expect(ids).toContain("missing-privacy-page");
    expect(ids).toContain("missing-deletion-path");
    expect(ids).toContain("missing-export-path");
    // The presence-only checks say so, rather than implying a stub route suffices.
    expect(
      report.findings.find((f) => f.id === "missing-deletion-path")?.fix.toLowerCase(),
    ).toContain("presence");
    // Card data in the logs outranks the ordinary personal-data leaks.
    expect(
      report.findings.some(
        (f) => f.id === "pii-in-logs" && f.severity === "high" && /card/i.test(f.title),
      ),
    ).toBe(true);
    // Every finding here is a code-level fact carrying a consequence and a fix.
    expect(
      report.findings.every(
        (f) => f.determination === "checked-in-code" && f.consequence !== "" && f.fix !== "",
      ),
    ).toBe(true);
  });

  it("keeps the clean repo silent — the hard CI gate against false positives", async () => {
    const report = await run("clean");
    expect(report.findings).toEqual([]);
  });

  it("flags the middling repo's expected subset — secret + analytics leak, no log leak", async () => {
    const report = await run("middling");

    expect(report.findings).toHaveLength(2);
    // Ranked: the high-severity committed secret leads the medium analytics leak.
    expect(report.findings[0]).toMatchObject({
      id: "committed-secrets",
      determination: "checked-in-code",
      severity: "high",
    });
    expect(report.findings[1]).toMatchObject({
      id: "pii-in-urls-analytics",
      category: "analytics",
      severity: "medium",
    });
    // The subset is genuine: the logs check stays silent on this repo.
    expect(report.findings.some((f) => f.id === "pii-in-logs")).toBe(false);
    // This repo collects personal data but is careful: it ships a /privacy page
    // plus reachable deletion and export paths, so no missing-path check fires.
    const ids = report.findings.map((f) => f.id);
    expect(ids).not.toContain("missing-privacy-page");
    expect(ids).not.toContain("missing-deletion-path");
    expect(ids).not.toContain("missing-export-path");
  });
});
