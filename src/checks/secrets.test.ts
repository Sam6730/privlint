import { describe, expect, it } from "vitest";
import type { DetectedSecret, Summary } from "../summary.js";
import { checkCommittedSecrets } from "./secrets.js";

/** An empty summary with only the secrets field populated, for check tests. */
function summaryWith(secrets: DetectedSecret[]): Summary {
  return {
    repoPath: ".",
    routes: [],
    schema: [],
    sdks: [],
    policyPages: { privacy: { present: false }, terms: { present: false } },
    piiSignals: [],
    secrets,
  };
}

describe("checkCommittedSecrets", () => {
  it("returns no findings when nothing was committed", () => {
    expect(checkCommittedSecrets(summaryWith([]))).toEqual([]);
  });

  it("flags a committed provider key as a critical, checked-in-code finding", () => {
    const findings = checkCommittedSecrets(
      summaryWith([
        { kind: "aws-access-key-id", file: "src/config.ts", line: 4, preview: "AKIA…" },
      ]),
    );

    expect(findings).toHaveLength(1);
    const finding = findings[0]!;
    expect(finding.severity).toBe("critical");
    expect(finding.category).toBe("secrets");
    expect(finding.determination).toBe("checked-in-code");
    // The finding locates the leak and carries a concrete consequence + fix.
    expect(finding.title).toContain("src/config.ts:4");
    expect(finding.title).toContain("AKIA…");
    expect(finding.consequence).not.toBe("");
    expect(finding.fix).not.toBe("");
  });

  it("treats a generic secret as high severity and phrases it conditionally", () => {
    const findings = checkCommittedSecrets(
      summaryWith([
        { kind: "generic-api-key", file: "src/env.ts", line: 1, preview: "d8f3…" },
      ]),
    );

    expect(findings[0]?.severity).toBe("high");
    // Generic detection is less certain, so the consequence is hedged.
    expect(findings[0]?.consequence.toLowerCase()).toContain("if");
  });

  it("emits one finding per committed secret", () => {
    const findings = checkCommittedSecrets(
      summaryWith([
        { kind: "stripe-secret-key", file: "a.ts", line: 1, preview: "sk_live_…" },
        { kind: "github-token", file: "b.ts", line: 2, preview: "ghp_…" },
      ]),
    );

    expect(findings).toHaveLength(2);
    expect(findings.every((f) => f.determination === "checked-in-code")).toBe(true);
  });
});
