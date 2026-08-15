import { describe, expect, it } from "vitest";
import { renderReport } from "./render.js";
import { DISCLAIMER } from "./types.js";
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

  // Matches any ANSI escape sequence.
  // eslint-disable-next-line no-control-regex
  const ESCAPE = /\x1b\[[0-9;]*m/;

  it("emits no escape codes with the default (plain) output", () => {
    expect(renderReport(report([sampleFinding]))).not.toMatch(ESCAPE);
    expect(renderReport(report([]))).not.toMatch(ESCAPE);
  });

  it("wraps the severity mark in color when color is on", () => {
    const output = renderReport(report([sampleFinding]), { color: true });

    // The mark token is colored, and its escape sits around "[CRITICAL]".
    // eslint-disable-next-line no-control-regex
    expect(output).toMatch(/\x1b\[[0-9;]*m\[CRITICAL\]\x1b\[[0-9;]*m/);
  });

  it("shows the all-clear line in green when color is on", () => {
    const output = renderReport(report([]), { color: true });

    // Green opens with SGR 32; the no-findings text sits inside it.
    // eslint-disable-next-line no-control-regex
    expect(output).toMatch(/\x1b\[32mNo findings\./);
  });

  it("appends a per-severity breakdown to the count line when color is on", () => {
    const findings = [
      sampleFinding,
      { ...sampleFinding, id: "b", severity: "high" as const },
      { ...sampleFinding, id: "c", severity: "high" as const },
    ];
    // Strip escapes to assert on the visible breakdown text.
    const visible = renderReport(report(findings), { color: true }).replace(
      // eslint-disable-next-line no-control-regex
      /\x1b\[[0-9;]*m/g,
      "",
    );

    expect(visible).toContain("1 critical · 2 high");
    // Severities with no findings are omitted from the breakdown.
    expect(visible).not.toContain("medium");
    expect(visible).not.toContain("low");
  });
});
