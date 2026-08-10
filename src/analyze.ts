import { runChecks } from "./checks/index.js";
import { parseRepo } from "./parse.js";
import { rankFindings } from "./rank.js";
import type { InterviewAnswers, LlmClient, Report } from "./types.js";

/**
 * Analyse a repository for data-privacy blind spots.
 *
 * This is the central testable seam. It parses the repo into an inspectable
 * `summary.json` (source code never leaves the machine), runs the deterministic
 * checks over that summary, and returns their findings ranked most-severe-first.
 * Later tickets add the judgment checks that send the summary (never source
 * code) to `llmClient`, conditioned by `interviewAnswers`.
 *
 * @param repoPath          Path to the repository to analyse.
 * @param interviewAnswers  Business facts the code can't reveal (unused until
 *                          the interview ticket).
 * @param llmClient         Injected model client for judgment checks (unused
 *                          until judgment checks are wired).
 */
export async function analyze(
  repoPath: string,
  interviewAnswers: InterviewAnswers,
  llmClient: LlmClient,
): Promise<Report> {
  const summary = await parseRepo(repoPath);

  // Deterministic checks run over the summary. Future tickets add judgment
  // checks that reason over the same summary via `llmClient`, conditioned by
  // `interviewAnswers`.
  const findings = runChecks(summary);

  return {
    repoPath,
    findings: rankFindings(findings),
  };
}
