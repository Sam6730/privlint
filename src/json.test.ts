import { describe, expect, it } from "vitest";
import { JSON_SCHEMA_VERSION, renderReportJson, toJsonReport } from "./json.js";
import { DISCLAIMER, SEVERITY_RANK } from "./types.js";
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

describe("toJsonReport", () => {
  it("carries the schema version, repo path, and disclaimer", () => {
    const json = toJsonReport(report([]));

    expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
    expect(json.repoPath).toBe("/some/repo");
    expect(json.disclaimer).toBe(DISCLAIMER);
  });

  it("emits an empty findings array for a clean run", () => {
    const json = toJsonReport(report([]));

    expect(json.findings).toEqual([]);
  });

  it("carries every finding field plus the numeric severity rank", () => {
    const { findings } = toJsonReport(report([sampleFinding]));

    expect(findings[0]).toMatchObject({
      id: sampleFinding.id,
      title: sampleFinding.title,
      severity: sampleFinding.severity,
      category: sampleFinding.category,
      determination: sampleFinding.determination,
      consequence: sampleFinding.consequence,
      fix: sampleFinding.fix,
    });
    expect(findings[0]?.severityRank).toBe(SEVERITY_RANK[sampleFinding.severity]);
  });

  it("carries the human-facing determination label alongside the raw value", () => {
    const { findings } = toJsonReport(report([sampleFinding]));

    expect(findings[0]?.determination).toBe("checked-in-code");
    expect(findings[0]?.determinationLabel).toBe("checked in code");
  });
});

describe("renderReportJson", () => {
  it("produces valid JSON that round-trips to the structured report", () => {
    const output = renderReportJson(report([sampleFinding]));

    expect(() => JSON.parse(output)).not.toThrow();
    expect(JSON.parse(output)).toEqual(toJsonReport(report([sampleFinding])));
  });

  it("represents the disclaimer in the JSON output", () => {
    const output = renderReportJson(report([]));

    expect(JSON.parse(output).disclaimer).toBe(DISCLAIMER);
  });
});
