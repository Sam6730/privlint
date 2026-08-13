/**
 * The Reason stage: judgment findings the deterministic checks can't produce,
 * reasoned by an injected {@link LlmClient} over the parsed {@link Summary}.
 *
 * The concrete judgment check in v1 is **code-vs-policy drift**: the vendors the
 * code actually calls (from the curated registry in the summary) diffed against
 * the processors the privacy policy names, surfacing undisclosed data sharing.
 *
 * The contract that makes this trustworthy — and testable — is narrow:
 *
 * - The model is sent **only `summary.json` plus the interview answers**, never
 *   raw source. {@link buildDriftPrompt} is the single place the payload is
 *   assembled, and it reads nothing but those two inputs.
 * - The diff itself is deterministic ({@link undisclosedProcessors}) and gates
 *   the model call: a repo whose policy already names every vendor produces no
 *   candidates, so the model is never consulted and can't be made to cry wolf.
 *   This is what keeps the clean fixture silent even with a chatty client.
 * - The reply is expected as JSON (`{ "findings": [...] }`); {@link reason}
 *   maps each item to a {@link Finding}, forcing `determination` to
 *   `reasoned-about` so the model can't dress a guess up as a code-level fact,
 *   and the prompt demands conditional-risk phrasing plus a nudge to counsel so
 *   no finding reads as a legal verdict.
 * - Judgment is best-effort and never the credibility floor: a garbled reply
 *   yields no judgment findings rather than crashing the run, so the
 *   deterministic findings always survive.
 */
import { SEVERITY_RANK } from "./types.js";
import type {
  Finding,
  InterviewAnswers,
  LlmClient,
  Severity,
} from "./types.js";
import type { DetectedSdk, Summary } from "./summary.js";

/** The extracted /privacy page text, or "" when there is none. The single place
 *  the policy text is reached, so the gate and the prompt can't drift apart on
 *  what "the policy" is. */
function privacyText(summary: Summary): string {
  return summary.policyPages.privacy.text ?? "";
}

/**
 * The deterministic half of the drift check: the vendors the code actually calls
 * whose brand name never appears in the privacy-policy text. An absent /privacy
 * page names no one, so every called vendor is a candidate; a policy that names a
 * vendor (case-insensitively) clears it. Deduped by destination so one vendor
 * detected via two packages (e.g. server- and browser-side Stripe) is a single
 * candidate.
 *
 * Only *called* SDKs count: an imported-but-never-invoked dependency isn't
 * sending data anywhere, so flagging it as an undisclosed processor would be a
 * false positive — the one failure mode this tool's audience can't catch.
 *
 * Matching is a plain substring test, which deliberately errs toward a false
 * negative (a policy phrase that happens to contain a vendor name clears it)
 * over a false positive (crying wolf on a disclosed vendor): missing a drift is
 * far cheaper here than inventing one.
 *
 * This is the code-detected-vendors-vs-policy-text diff. It runs before the
 * model so the reasoning is scoped to genuine drift, and so a repo with no drift
 * skips the model entirely.
 */
export function undisclosedProcessors(summary: Summary): DetectedSdk[] {
  const policyText = privacyText(summary).toLowerCase();

  const seen = new Set<string>();
  const candidates: DetectedSdk[] = [];
  for (const sdk of summary.sdks) {
    if (!sdk.called) continue;
    if (policyText.includes(sdk.destination.toLowerCase())) continue;
    if (seen.has(sdk.destination)) continue;
    seen.add(sdk.destination);
    candidates.push(sdk);
  }
  return candidates;
}

/**
 * Assemble the drift prompt from the only two things the model is allowed to
 * see: the inspectable summary and the interview answers. Raw source never
 * appears here because it is never an input. The `candidates` are the
 * deterministically-detected undisclosed vendors — highlighted so the model
 * reasons about the right thing rather than re-deriving the diff.
 */
export function buildDriftPrompt(
  candidates: DetectedSdk[],
  summary: Summary,
  answers: InterviewAnswers,
): string {
  const policyText = !summary.policyPages.privacy.present
    ? "(no /privacy page was found in the repo)"
    : privacyText(summary).trim() ||
      "(the /privacy page exists but has no readable text)";

  return [
    "You are a privacy-hygiene reviewer performing a code-vs-policy drift check.",
    "The parser found these third-party vendors wired into the code, and their",
    "brand names do NOT appear in the privacy policy text below. Each is a",
    "candidate 'undisclosed processor' — personal data leaving for a vendor the",
    "policy never names.",
    "",
    "For each candidate that genuinely looks undisclosed, emit one finding.",
    "Phrase it as conditional risk plus a nudge to verify with counsel — never a",
    "legal conclusion, and never assert the developer is violating any law. Let",
    "the interview answers condition severity and wording:",
    "- No signed DPAs makes the gap sharper; signed DPAs soften it.",
    "- No EU/UK users blunts the GDPR edge (CCPA duties may still apply).",
    "Do not invent vendors beyond the candidates listed. If a candidate is",
    "plausibly covered by a generic phrase in the policy, you may omit it.",
    "",
    "Respond with JSON only, in this exact shape:",
    '{ "findings": [ { "id", "title", "severity", "category", "consequence", "fix" } ] }',
    'where "severity" is one of: critical, high, medium, low.',
    "Return an empty findings array if nothing is warranted.",
    "",
    "undisclosed-processor candidates (detected in code, absent from policy):",
    JSON.stringify(
      candidates.map((c) => ({
        vendor: c.destination,
        dataCategory: c.dataCategory,
        whyItMatters: c.whyItMatters,
        package: c.package,
      })),
      null,
      2,
    ),
    "",
    "privacy policy text:",
    policyText,
    "",
    "summary.json:",
    JSON.stringify(summary, null, 2),
    "",
    "interview answers:",
    JSON.stringify(answers, null, 2),
  ].join("\n");
}

/**
 * Run the Reason stage: skip entirely when no provider is configured or when the
 * deterministic diff finds no undisclosed vendors, otherwise send the drift
 * prompt and map the reply to `reasoned-about` findings.
 */
export async function reason(
  summary: Summary,
  answers: InterviewAnswers,
  client: LlmClient,
): Promise<Finding[]> {
  if (!client.available) return [];

  const candidates = undisclosedProcessors(summary);
  if (candidates.length === 0) return [];

  const raw = await client.complete({
    prompt: buildDriftPrompt(candidates, summary, answers),
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
