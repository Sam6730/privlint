/**
 * The Reason stage: judgment findings the deterministic checks can't produce,
 * reasoned by an injected {@link LlmClient} over the parsed {@link Summary}.
 *
 * The contract that makes this trustworthy — and testable — is narrow:
 *
 * - The model is sent **only `summary.json` plus the interview answers**, never
 *   raw source. {@link buildJudgmentPrompt} is the single place the payload is
 *   assembled, and it reads nothing but those two inputs.
 * - The reply is expected as JSON (`{ "findings": [...] }`); {@link reason}
 *   maps each item to a {@link Finding}, forcing `determination` to
 *   `reasoned-about` so the model can't dress a guess up as a code-level fact.
 * - Judgment is best-effort and never the credibility floor: a garbled reply
 *   yields no judgment findings rather than crashing the run, so the
 *   deterministic findings always survive.
 *
 * This is currently a pass-through seam — a canned model response maps straight
 * to findings — proving the plumbing end-to-end before the real judgment checks
 * (undisclosed processors, undisclosed LLM data flows) build their prompts on
 * top of it.
 */
import { SEVERITY_RANK } from "./types.js";
import type {
  Finding,
  InterviewAnswers,
  LlmClient,
  Severity,
} from "./types.js";
import type { Summary } from "./summary.js";

/**
 * Assemble the judgment prompt from the only two things the model is allowed to
 * see: the inspectable summary and the interview answers. Raw source never
 * appears here because it is never an input.
 */
export function buildJudgmentPrompt(
  summary: Summary,
  answers: InterviewAnswers,
): string {
  return [
    "You are a privacy-hygiene reviewer. You are given a structured summary of a",
    "codebase (extracted facts — never the raw source) and the developer's answers",
    "to a short interview. Identify privacy findings that require judgment rather",
    "than a mechanical code check.",
    "",
    "Phrase every finding as conditional risk plus a nudge to verify, never as a",
    "legal conclusion.",
    "",
    "Respond with JSON only, in this exact shape:",
    '{ "findings": [ { "id", "title", "severity", "category", "consequence", "fix" } ] }',
    'where "severity" is one of: critical, high, medium, low.',
    "Return an empty findings array if nothing is warranted.",
    "",
    "summary.json:",
    JSON.stringify(summary, null, 2),
    "",
    "interview answers:",
    JSON.stringify(answers, null, 2),
  ].join("\n");
}

/**
 * Run the Reason stage: skip entirely when no provider is configured, otherwise
 * send the prompt and map the reply to `reasoned-about` findings.
 */
export async function reason(
  summary: Summary,
  answers: InterviewAnswers,
  client: LlmClient,
): Promise<Finding[]> {
  if (!client.available) return [];

  const raw = await client.complete({
    prompt: buildJudgmentPrompt(summary, answers),
  });

  return parseJudgmentFindings(raw);
}

/** The severities we accept from a model reply, for validation. */
const VALID_SEVERITIES = new Set<string>(Object.keys(SEVERITY_RANK));

/**
 * Map a raw model reply to findings. Tolerant by design: a reply that doesn't
 * parse, or an item missing a required field or carrying a bad severity, is
 * dropped rather than allowed to abort the run.
 */
function parseJudgmentFindings(raw: string): Finding[] {
  const parsed = parseJson(stripCodeFence(raw));
  if (!isRecord(parsed) || !Array.isArray(parsed.findings)) return [];

  return parsed.findings.filter(isRecord).flatMap((item) => {
    const finding = toFinding(item);
    return finding ? [finding] : [];
  });
}

/** Validate one reply item into a Finding, or null if it's not usable. */
function toFinding(item: Record<string, unknown>): Finding | null {
  const { id, title, category, consequence, fix, severity } = item;
  if (
    typeof id !== "string" ||
    typeof title !== "string" ||
    typeof category !== "string" ||
    typeof consequence !== "string" ||
    typeof fix !== "string" ||
    typeof severity !== "string" ||
    !VALID_SEVERITIES.has(severity)
  ) {
    return null;
  }

  return {
    id,
    title,
    severity: severity as Severity,
    category,
    // The trust signal is set here, not by the model: a reasoned finding must
    // never masquerade as a code-level fact.
    determination: "reasoned-about",
    consequence,
    fix,
  };
}

/** Strip a leading/trailing ```json … ``` fence models often wrap JSON in. */
function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
