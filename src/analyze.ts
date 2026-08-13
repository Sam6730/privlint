import { runChecks } from "./checks/index.js";
import { parseRepo } from "./parse.js";
import { rankFindings } from "./rank.js";
import { reason } from "./reason.js";
import type { InterviewAnswers, LlmClient, Report } from "./types.js";

/**
 * Analyse a repository for data-privacy blind spots.
 *
 * This is the central testable seam. It parses the repo into an inspectable
 * `summary.json` (source code never leaves the machine), then combines two
 * families of findings over that summary:
 *
 * - deterministic checks — pure `summary → Finding[]` facts;
 * - the judgment {@link reason} stage — the LLM reasons over the same summary
 *   (never source code), conditioned by `interviewAnswers`.
 *
 * The deterministic family also includes interview-conditioned checks, which
 * layer `you-told-us` applicability (e.g. CCPA-only duties) over the same summary
 * using `interviewAnswers`. The combined findings are ranked most-severe-first.
 * When no model provider is configured, the Reason stage is skipped and the
 * deterministic findings stand on their own.
 *
 * @param repoPath          Path to the repository to analyse.
 * @param interviewAnswers  Business facts the code can't reveal, used to
 *                          condition the judgment reasoning.
 * @param llmClient         Injected model client for the judgment stage. A fake
 *                          client keeps this seam deterministic in tests.
 */
export async function analyze(
  repoPath: string,
  interviewAnswers: InterviewAnswers,
  llmClient: LlmClient,
): Promise<Report> {
  const summary = await parseRepo(repoPath);

  // Both families reason over the same summary — deterministic facts and the
  // LLM's judgment — and are ranked together. Only the summary (plus the
  // interview answers) ever reaches the model; raw source never leaves.
  const findings = [
    ...runChecks(summary, interviewAnswers),
    ...(await reason(summary, interviewAnswers, llmClient)),
  ];

  return {
    repoPath,
    findings: rankFindings(findings),
  };
}
