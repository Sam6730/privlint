import { assertDirectory } from "./paths.js";
import { rankFindings } from "./rank.js";
import type {
  Finding,
  InterviewAnswers,
  LlmClient,
  Report,
} from "./types.js";

/**
 * Analyse a repository for data-privacy blind spots.
 *
 * This is the central testable seam. Later tickets parse the repo into a
 * `summary.json`, run deterministic checks, and send the summary (never source
 * code) to `llmClient` for judgment checks. Today no checks are wired, so a run
 * against any repo reports no findings.
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
  await assertDirectory(repoPath, "analyse");

  // No checks are wired yet. Future tickets populate this from a parsed summary
  // (deterministic checks) and from `llmClient` over that summary (judgment
  // checks), conditioned by `interviewAnswers`.
  const findings: Finding[] = [];

  return {
    repoPath,
    findings: rankFindings(findings),
  };
}
