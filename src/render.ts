import { DETERMINATION_LABELS, DISCLAIMER } from "./types.js";
import type { Finding, Report, Severity } from "./types.js";

/** Symbols used to make severity scannable in a terminal. */
const SEVERITY_MARK: Record<Severity, string> = {
  critical: "[CRITICAL]",
  high: "[HIGH]    ",
  medium: "[MEDIUM]  ",
  low: "[LOW]     ",
};

/**
 * Render a {@link Report} as a human-readable terminal report. Findings are
 * shown in the order given (already ranked most-severe-first by `analyze`).
 */
export function renderReport(report: Report): string {
  const lines: string[] = [];

  lines.push(`Privacy hygiene report for ${report.repoPath}`);
  lines.push("");

  if (report.findings.length === 0) {
    lines.push("No findings. Nothing flagged in this run.");
  } else {
    const count = report.findings.length;
    lines.push(`${count} finding${count === 1 ? "" : "s"}, most serious first:`);
    lines.push("");
    for (const finding of report.findings) {
      lines.push(...renderFinding(finding));
      lines.push("");
    }
  }

  lines.push("—".repeat(4));
  lines.push(DISCLAIMER);

  return lines.join("\n");
}

function renderFinding(finding: Finding): string[] {
  const label = DETERMINATION_LABELS[finding.determination];
  return [
    `${SEVERITY_MARK[finding.severity]} ${finding.title}  (${finding.category} · ${label})`,
    `  Why it matters: ${finding.consequence}`,
    `  Fix: ${finding.fix}`,
  ];
}
