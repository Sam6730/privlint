import { DETERMINATION_LABELS, DISCLAIMER, SEVERITY_RANK } from "./types.js";
import type { Finding, Report } from "./types.js";

/**
 * Version of the JSON payload shape below. Bumped only on a breaking change to
 * the structure, so a CI consumer can pin against it and fail loudly if the
 * contract shifts under them.
 */
export const JSON_SCHEMA_VERSION = 1;

/**
 * A finding in the machine-readable payload. It carries every {@link Finding}
 * field verbatim (via `extends`, so a new `Finding` field flows through
 * automatically), plus two derived fields a CI consumer would otherwise have to
 * recompute:
 *
 * - `severityRank` — the numeric {@link SEVERITY_RANK} for `severity`, so a
 *   consumer can threshold ("fail the build on rank >= 2") without hard-coding
 *   the ordering of the string enum.
 * - `determinationLabel` — the human-facing {@link DETERMINATION_LABELS} text
 *   for `determination`, so a consumer can surface it without duplicating the
 *   label map.
 */
export interface JsonFinding extends Finding {
  /** Numeric rank of `severity`; higher == more severe. */
  severityRank: number;
  /** Human-facing label for `determination` (e.g. "checked in code"). */
  determinationLabel: string;
}

/**
 * The full machine-readable report, emitted by `privlint --json`. This is the
 * stable contract for wiring runs into CI:
 *
 * - `schemaVersion` — {@link JSON_SCHEMA_VERSION}; pin against it.
 * - `repoPath` — the analysed repo path.
 * - `disclaimer` — the not-legal-advice disclaimer, always present (the same
 *   text shown in the human-readable report), so the caveat survives into any
 *   downstream system that only ever sees the JSON.
 * - `findings` — ranked most-severe-first, same order as the human report.
 */
export interface JsonReport {
  schemaVersion: number;
  repoPath: string;
  disclaimer: string;
  findings: JsonFinding[];
}

/** Project a {@link Report} into its machine-readable {@link JsonReport} form. */
export function toJsonReport(report: Report): JsonReport {
  return {
    schemaVersion: JSON_SCHEMA_VERSION,
    repoPath: report.repoPath,
    disclaimer: DISCLAIMER,
    findings: report.findings.map(toJsonFinding),
  };
}

function toJsonFinding(finding: Finding): JsonFinding {
  // Spread the whole finding so new Finding fields propagate without an edit
  // here; the two derived fields are what JSON consumers can't recompute.
  return {
    ...finding,
    severityRank: SEVERITY_RANK[finding.severity],
    determinationLabel: DETERMINATION_LABELS[finding.determination],
  };
}

/**
 * Render a {@link Report} as a pretty-printed JSON string — the payload emitted
 * by `privlint --json`. Two-space indent keeps it diff-friendly when checked
 * into a CI artifact.
 */
export function renderReportJson(report: Report): string {
  return JSON.stringify(toJsonReport(report), null, 2);
}
