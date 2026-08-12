import { describe, expect, it } from "vitest";
import type { PiiSignal } from "../summary.js";
import { checkPiiInLogs } from "./pii-logs.js";
import { emptySummary } from "./summary-fixture.js";

/** An empty summary with only the PII signals populated, for check tests. */
const summaryWith = (piiSignals: PiiSignal[]) => emptySummary({ piiSignals });

const logSignal = (field: string, over: Partial<PiiSignal> = {}): PiiSignal => ({
  kind: "log",
  field,
  file: "app/api/charge/route.ts",
  line: 19,
  snippet: `console.log("x", ${field})`,
  ...over,
});

describe("checkPiiInLogs", () => {
  it("returns no findings when nothing is logged", () => {
    expect(checkPiiInLogs(summaryWith([]))).toEqual([]);
  });

  it("flags card data in logs as a high-severity, checked-in-code finding", () => {
    const findings = checkPiiInLogs(summaryWith([logSignal("cardNumber")]));

    expect(findings).toHaveLength(1);
    const finding = findings[0]!;
    expect(finding.severity).toBe("high");
    expect(finding.determination).toBe("checked-in-code");
    // The finding locates the leak and names the field.
    expect(finding.title).toContain("app/api/charge/route.ts:19");
    expect(finding.title.toLowerCase()).toContain("cardnumber".slice(0, 4));
    // Card data carries the PCI angle in the consequence.
    expect(finding.consequence.toLowerCase()).toContain("pci");
    expect(finding.fix).not.toBe("");
  });

  it("flags ordinary personal data in logs as medium severity", () => {
    const findings = checkPiiInLogs(summaryWith([logSignal("email")]));
    expect(findings[0]?.severity).toBe("medium");
    expect(findings[0]?.consequence.toLowerCase()).not.toContain("pci");
  });

  it("only reacts to log signals, not URL or analytics signals", () => {
    const findings = checkPiiInLogs(
      summaryWith([
        { kind: "url", field: "email", file: "a.ts", line: 1, snippet: "" },
        { kind: "analytics-event", field: "email", file: "a.ts", line: 2, snippet: "" },
      ]),
    );
    expect(findings).toEqual([]);
  });

  it("emits one finding per logged field", () => {
    const findings = checkPiiInLogs(
      summaryWith([logSignal("email"), logSignal("cardNumber")]),
    );
    expect(findings).toHaveLength(2);
    expect(findings.every((f) => f.determination === "checked-in-code")).toBe(true);
  });
});
