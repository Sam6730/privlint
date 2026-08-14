import { SEVERITY_RANK } from "./types.js";
import type { Finding } from "./types.js";

/**
 * Rank findings by severity/consequence, most severe first. Category is never a
 * sort key. Ties keep their original input order (stable), and the input array
 * is not mutated.
 */
export function rankFindings(findings: readonly Finding[]): Finding[] {
  return findings
    .map((finding, index) => ({ finding, index }))
    .sort((a, b) => {
      const bySeverity =
        SEVERITY_RANK[b.finding.severity] - SEVERITY_RANK[a.finding.severity];
      return bySeverity !== 0 ? bySeverity : a.index - b.index;
    })
    .map((entry) => entry.finding);
}
