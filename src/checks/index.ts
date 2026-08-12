/**
 * The deterministic check registry.
 *
 * A {@link Check} is a pure `summary → Finding[]` function. {@link analyze} runs
 * every registered check over the parsed summary and ranks the combined result;
 * adding a future deterministic check is a one-line registration here, not a
 * change to `analyze`. Judgment (LLM-over-summary) checks are wired separately
 * once that stage lands.
 */
import type { Finding } from "../types.js";
import type { Summary } from "../summary.js";
import { checkCommittedSecrets } from "./secrets.js";
import { checkPiiInLogs } from "./pii-logs.js";
import { checkPiiInUrlsOrAnalytics } from "./pii-sinks.js";
import {
  checkMissingDeletionPath,
  checkMissingExportPath,
  checkMissingPrivacyPage,
} from "./missing-paths.js";

/** A deterministic check: a pure mapping from the parsed summary to findings. */
export type Check = (summary: Summary) => Finding[];

/** Every deterministic check, run in order (results are ranked by `analyze`). */
export const DETERMINISTIC_CHECKS: readonly Check[] = [
  checkCommittedSecrets,
  checkPiiInLogs,
  checkPiiInUrlsOrAnalytics,
  checkMissingPrivacyPage,
  checkMissingDeletionPath,
  checkMissingExportPath,
];

/** Run all deterministic checks over a summary and collect their findings. */
export function runChecks(summary: Summary): Finding[] {
  return DETERMINISTIC_CHECKS.flatMap((check) => check(summary));
}
