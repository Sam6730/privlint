import { describe, expect, it } from "vitest";
import type { PiiSignal } from "../summary.js";
import { checkPiiInUrlsOrAnalytics } from "./pii-sinks.js";
import { emptySummary } from "./summary-fixture.js";

/** An empty summary with only the PII signals populated, for check tests. */
const summaryWith = (piiSignals: PiiSignal[]) => emptySummary({ piiSignals });

const signal = (
  kind: PiiSignal["kind"],
  field: string,
  over: Partial<PiiSignal> = {},
): PiiSignal => ({
  kind,
  field,
  file: "app/api/track/route.ts",
  line: 7,
  snippet: "",
  ...over,
});

describe("checkPiiInUrlsOrAnalytics", () => {
  it("returns no findings when nothing flows to a URL or analytics", () => {
    expect(checkPiiInUrlsOrAnalytics(summaryWith([]))).toEqual([]);
  });

  it("flags personal data in a URL as a checked-in-code finding that names the sink", () => {
    const findings = checkPiiInUrlsOrAnalytics(summaryWith([signal("url", "email")]));

    expect(findings).toHaveLength(1);
    const finding = findings[0]!;
    expect(finding.severity).toBe("medium");
    expect(finding.determination).toBe("checked-in-code");
    expect(finding.title).toContain("app/api/track/route.ts:7");
    expect(finding.title.toLowerCase()).toContain("url");
    // The URL consequence names where a URL leaks to.
    expect(finding.consequence.toLowerCase()).toContain("referer");
    expect(finding.fix).not.toBe("");
  });

  it("flags personal data sent to analytics, naming the analytics sink", () => {
    const findings = checkPiiInUrlsOrAnalytics(
      summaryWith([signal("analytics-event", "email")]),
    );
    expect(findings[0]?.title.toLowerCase()).toContain("analytics");
    expect(findings[0]?.consequence.toLowerCase()).toContain("analytics");
  });

  it("treats card data in a sink as high severity", () => {
    const findings = checkPiiInUrlsOrAnalytics(summaryWith([signal("url", "cardNumber")]));
    expect(findings[0]?.severity).toBe("high");
  });

  it("only reacts to URL and analytics signals, not log signals", () => {
    const findings = checkPiiInUrlsOrAnalytics(summaryWith([signal("log", "email")]));
    expect(findings).toEqual([]);
  });

  it("emits one finding per sink flow", () => {
    const findings = checkPiiInUrlsOrAnalytics(
      summaryWith([signal("url", "email"), signal("analytics-event", "phone")]),
    );
    expect(findings).toHaveLength(2);
    expect(findings.every((f) => f.determination === "checked-in-code")).toBe(true);
  });
});
