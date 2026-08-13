/**
 * The check registry.
 *
 * A {@link Check} maps the parsed summary plus the interview answers to findings.
 * {@link analyze} runs every registered check and ranks the combined result;
 * adding a future check is a one-line registration here, not a change to
 * `analyze`. Judgment (LLM-over-summary) checks are wired separately via the
 * Reason stage.
 *
 * Two families register here, differing only in their trust signal:
 *
 * - {@link DETERMINISTIC_CHECKS} — code-level facts (`checked-in-code`). These
 *   read only the summary and ignore the answers, so the clean-repo silence gate
 *   holds regardless of what was answered.
 * - {@link INTERVIEW_CHECKS} — applicability that follows from what the founder
 *   told us (`you-told-us`), silent unless an answer is a definite yes/no.
 */
import type { Finding, InterviewAnswers } from "../types.js";
import type { Summary } from "../summary.js";
import { checkCommittedSecrets } from "./secrets.js";
import { checkPiiInLogs } from "./pii-logs.js";
import { checkPiiInUrlsOrAnalytics } from "./pii-sinks.js";
import {
  checkMissingDeletionPath,
  checkMissingExportPath,
  checkMissingPrivacyPage,
} from "./missing-paths.js";
import {
  checkSellShareDisclosure,
  checkVendorDpas,
} from "./interview-facts.js";

/**
 * A check: a pure mapping from the parsed summary and interview answers to
 * findings. Code-fact checks simply ignore the answers argument.
 */
export type Check = (summary: Summary, answers: InterviewAnswers) => Finding[];

/** Code-fact checks (`checked-in-code`); read only the summary. */
export const DETERMINISTIC_CHECKS: readonly Check[] = [
  checkCommittedSecrets,
  checkPiiInLogs,
  checkPiiInUrlsOrAnalytics,
  checkMissingPrivacyPage,
  checkMissingDeletionPath,
  checkMissingExportPath,
];

/** Interview-conditioned checks (`you-told-us`); silent unless an answer is set. */
export const INTERVIEW_CHECKS: readonly Check[] = [
  checkSellShareDisclosure,
  checkVendorDpas,
];

/** Run every registered check over the summary and answers, collecting findings. */
export function runChecks(
  summary: Summary,
  answers: InterviewAnswers,
): Finding[] {
  return [...DETERMINISTIC_CHECKS, ...INTERVIEW_CHECKS].flatMap((check) =>
    check(summary, answers),
  );
}
