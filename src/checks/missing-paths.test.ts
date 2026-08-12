import { describe, expect, it } from "vitest";
import type { PiiSignal, Route, SchemaModel } from "../summary.js";
import {
  checkMissingDeletionPath,
  checkMissingExportPath,
  checkMissingPrivacyPage,
  collectsPersonalData,
} from "./missing-paths.js";
import { emptySummary } from "./summary-fixture.js";

const piiSignal: PiiSignal = {
  kind: "analytics-event",
  field: "email",
  file: "app/api/track/route.ts",
  line: 7,
  snippet: "",
};

const route = (path: string, over: Partial<Route> = {}): Route => ({
  path,
  source: "next-app",
  file: `app${path}/route.ts`,
  ...over,
});

const model = (fields: string[]): SchemaModel => ({
  name: "User",
  fields,
  source: "prisma",
  file: "prisma/schema.prisma",
});

/** A summary that collects personal data (via a PII signal) with the given routes. */
const collecting = (routes: Route[] = [], over = {}) =>
  emptySummary({ piiSignals: [piiSignal], routes, ...over });

describe("collectsPersonalData", () => {
  it("is true when the parser saw any PII flow", () => {
    expect(collectsPersonalData(emptySummary({ piiSignals: [piiSignal] }))).toBe(true);
  });

  it("is true when a stored model names a personal-data field", () => {
    expect(collectsPersonalData(emptySummary({ schema: [model(["id", "email"])] }))).toBe(true);
  });

  it("is false with no PII flow and no personal model field", () => {
    expect(collectsPersonalData(emptySummary({ schema: [model(["id", "createdAt"])] }))).toBe(
      false,
    );
  });
});

describe("checkMissingPrivacyPage", () => {
  it("fires when personal data is collected and no /privacy page is reachable", () => {
    const findings = checkMissingPrivacyPage(collecting());
    expect(findings).toHaveLength(1);
    const finding = findings[0]!;
    expect(finding.id).toBe("missing-privacy-page");
    expect(finding.determination).toBe("checked-in-code");
    expect(finding.severity).toBe("high");
    expect(finding.consequence).not.toBe("");
    expect(finding.fix).not.toBe("");
  });

  it("stays silent when a reachable /privacy page exists", () => {
    const summary = collecting([], {
      policyPages: { privacy: { present: true, file: "app/privacy/page.tsx" }, terms: { present: false } },
    });
    expect(checkMissingPrivacyPage(summary)).toEqual([]);
  });

  it("stays silent when no personal data is collected, even without a /privacy page", () => {
    expect(checkMissingPrivacyPage(emptySummary())).toEqual([]);
  });
});

describe("checkMissingDeletionPath", () => {
  it("fires with a presence-only caveat when no deletion path exists", () => {
    const findings = checkMissingDeletionPath(collecting());
    expect(findings).toHaveLength(1);
    const finding = findings[0]!;
    expect(finding.id).toBe("missing-deletion-path");
    expect(finding.determination).toBe("checked-in-code");
    expect(finding.severity).toBe("medium");
    // The presence-only caveat: we can't verify completeness.
    expect(finding.fix.toLowerCase()).toContain("presence");
    expect(finding.fix.toLowerCase()).toMatch(/can'?t (confirm|verify)/);
  });

  it("stays silent when an account-deletion route is present", () => {
    expect(checkMissingDeletionPath(collecting([route("/account/delete")]))).toEqual([]);
  });

  it("stays silent for a DELETE handler on an account route", () => {
    const r = route("/api/account", { method: "DELETE", file: "app/api/account/route.ts" });
    expect(checkMissingDeletionPath(collecting([r]))).toEqual([]);
  });

  it("still fires when only unrelated 'delete' routes exist (e.g. delete a comment)", () => {
    expect(checkMissingDeletionPath(collecting([route("/api/comments/delete")]))).toHaveLength(1);
  });

  it("stays silent when no personal data is collected", () => {
    expect(checkMissingDeletionPath(emptySummary())).toEqual([]);
  });
});

describe("checkMissingExportPath", () => {
  it("fires with a presence-only caveat when no export/access path exists", () => {
    const findings = checkMissingExportPath(collecting());
    expect(findings).toHaveLength(1);
    const finding = findings[0]!;
    expect(finding.id).toBe("missing-export-path");
    expect(finding.determination).toBe("checked-in-code");
    expect(finding.severity).toBe("medium");
    expect(finding.fix.toLowerCase()).toContain("presence");
    expect(finding.fix.toLowerCase()).toMatch(/can'?t (confirm|verify)/);
  });

  it("stays silent when a data-export route is present", () => {
    expect(checkMissingExportPath(collecting([route("/account/export")]))).toEqual([]);
  });

  it("stays silent for a /data-export route", () => {
    expect(checkMissingExportPath(collecting([route("/data-export")]))).toEqual([]);
  });

  it("still fires when only unrelated 'access' routes exist (e.g. early-access)", () => {
    expect(checkMissingExportPath(collecting([route("/early-access")]))).toHaveLength(1);
  });

  it("stays silent when no personal data is collected", () => {
    expect(checkMissingExportPath(emptySummary())).toEqual([]);
  });
});
