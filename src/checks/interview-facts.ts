/**
 * Interview-conditioned checks: findings that follow from what the founder *told
 * us*, combined with what the parser saw — not from the code alone. They carry
 * the `you-told-us` determination so the report is honest about where each one
 * comes from, and the SDK exposes them as ordinary `(summary, answers) → Finding[]`
 * checks so `analyze` runs and ranks them beside the code-fact checks.
 *
 * Two honesty constraints shape them:
 *
 * - **Silent on "unknown".** Every check fires only on a *definite* yes/no. The
 *   unknown default (what a skipped or non-interactive interview leaves) fires
 *   nothing, so a CI run with no answers never invents a finding — the same
 *   false-positive discipline the deterministic checks hold to.
 * - **Never a verdict.** The copy states applicability conditionally ("this can
 *   make you…", "may lack a lawful basis") and nudges toward counsel, because
 *   whether a duty actually attaches is a legal judgment this tool doesn't make.
 */
import type { Finding, InterviewAnswers, Severity } from "../types.js";
import type { Summary } from "../summary.js";

/**
 * CCPA/CPRA applicability, conditioned on the founder telling us they sell or
 * share data. This is the "CCPA-only item" the interview gates: it's silent
 * unless the answer is a definite yes, because the duty keys off a business fact
 * the code can't reveal.
 */
export function checkSellShareDisclosure(
  _summary: Summary,
  answers: InterviewAnswers,
): Finding[] {
  if (answers.sellsOrSharesData !== true) return [];
  return [
    {
      id: "sell-share-ccpa",
      title:
        "You told us you sell or share data — review your CCPA/CPRA sell/share obligations",
      severity: "high",
      category: "ccpa",
      determination: "you-told-us",
      consequence:
        'You told us you run ads or sell/share personal data. Under California\'s CCPA/CPRA that can make you a business that "sells" or "shares" personal information, which triggers extra duties — a "Do Not Sell or Share My Personal Information" opt-out link and honoring Global Privacy Control (GPC) browser signals. This tool can\'t see whether either is in place.',
      fix: 'Confirm with counsel whether your ad or data practices count as "selling" or "sharing" under CCPA/CPRA. If they do, add a reachable "Do Not Sell or Share My Personal Information" opt-out and honor Global Privacy Control signals.',
    },
  ];
}

/**
 * Vendor DPA gap, conditioned on the founder telling us no DPAs are signed while
 * the parser detected data flowing to third-party vendors. Severity softens when
 * they also told us there are no EU/UK users, since the sharpest DPA duty
 * (GDPR Art. 28) is EU-facing — this is the "soften phrasing" the interview
 * enables, not a change to whether the finding fires.
 */
export function checkVendorDpas(
  summary: Summary,
  answers: InterviewAnswers,
): Finding[] {
  if (answers.hasSignedDpas !== false) return [];
  if (summary.sdks.length === 0) return [];

  const vendors = [...new Set(summary.sdks.map((sdk) => sdk.destination))];
  const vendorList = vendors.join(", ");
  // No EU/UK users blunts the GDPR Art. 28 edge; the duty may still bite under
  // CCPA service-provider terms, so we keep the finding but lower its severity.
  const euUkSoftened = answers.hasEuUkUsers === false;
  const severity: Severity = euUkSoftened ? "medium" : "high";
  const regulatoryBasis = euUkSoftened
    ? "CCPA service-provider terms (and GDPR Art. 28 for anyone in the EU/UK)"
    : "GDPR Art. 28 and CCPA service-provider terms";

  return [
    {
      id: "missing-vendor-dpas",
      title:
        "You told us there are no signed DPAs, but the code sends data to third-party vendors",
      severity,
      category: "dpa",
      determination: "you-told-us",
      consequence: `You told us you haven't signed data-processing agreements (DPAs) with your vendors, and the code sends data to third parties (${vendorList}). A DPA is generally the contract that lets a processor handle personal data on your behalf (${regulatoryBasis}); without one, that data sharing may lack a lawful basis.`,
      fix: "Put a signed DPA in place with each vendor that processes personal data on your behalf before that data flows to them — most major vendors offer a standard DPA. Your counsel can confirm which vendors need one.",
    },
  ];
}
