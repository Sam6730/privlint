import { describe, expect, it } from "vitest";
import { DISCLAIMER, renderReport } from "./render.js";
import type { Finding, Report } from "./types.js";

function report(findings: Finding[]): Report {
  return { repoPath: "/some/repo", findings };
}

const sampleFinding: Finding = {
  id: "committed-secret",
  title: "Committed API key found",
  severity: "critical",
  category: "secrets",
  determination: "checked-in-code",
  consequence: "Stripe can freeze your account if this key leaks.",
  fix: "Rotate the key and move it to an environment variable.",
};

describe("renderReport", () => {
  it("always includes the not-legal-advice disclaimer", () => {
    const withFindings = renderReport(report([sampleFinding]));
    const withoutFindings = renderReport(report([]));

    expect(withFindings).toContain(DISCLAIMER);
    expect(withoutFindings).toContain(DISCLAIMER);
  });

  it("reports the no-findings state clearly", () => {
    const output = renderReport(report([]));

    expect(output.toLowerCase()).toContain("no findings");
  });

  it("shows a finding's consequence, fix, and determination label", () => {
    const output = renderReport(report([sampleFinding]));

    expect(output).toContain(sampleFinding.title);
    expect(output).toContain(sampleFinding.consequence);
    expect(output).toContain(sampleFinding.fix);
    // Human-facing determination label, not the raw enum value.
    expect(output).toContain("checked in code");
    expect(output).not.toContain("checked-in-code");
  });
});
