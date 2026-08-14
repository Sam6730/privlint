/**
 * The Reason stage: judgment findings the deterministic checks can't produce,
 * reasoned by an injected {@link LlmClient} over the parsed {@link Summary}.
 *
 * Two judgment checks run in v1, each a deterministic gate feeding a scoped
 * model call:
 *
 * - **code-vs-policy drift** ({@link undisclosedProcessors} /
 *   {@link buildDriftPrompt}): the vendors the code actually calls diffed against
 *   the processors the privacy policy names, surfacing undisclosed data sharing.
 * - **LLM-data disclosure** ({@link calledLlmApis} /
 *   {@link buildLlmDisclosurePrompt}): the LLM APIs the code actually calls,
 *   flagged as user data that may reach a model without disclosure or a lawful
 *   basis — the risk that prompt contents leave the founder's control.
 *
 * The contract that makes this trustworthy — and testable — is narrow, and holds
 * for both checks:
 *
 * - The model is sent **only `summary.json` plus the interview answers**, never
 *   raw source. Each `build*Prompt` is the single place its payload is
 *   assembled, and it reads nothing but those two inputs.
 * - A deterministic gate precedes each model call: a repo with no undisclosed
 *   vendor (drift) or no called LLM API (disclosure) produces no candidates, so
 *   the model is never consulted for that check and can't be made to cry wolf.
 *   This is what keeps the clean fixture silent even with a chatty client.
 * - The reply is expected as JSON (`{ "findings": [...] }`); {@link reason}
 *   maps each item to a {@link Finding}, forcing `determination` to
 *   `reasoned-about` so the model can't dress a guess up as a code-level fact,
 *   and each prompt demands conditional-risk phrasing plus a nudge to counsel so
 *   no finding reads as a legal verdict.
 * - Judgment is best-effort and never the credibility floor: a garbled reply
 *   yields no judgment findings rather than crashing the run, so the
 *   deterministic findings always survive. The two checks are independent: one
 *   check's empty gate or garbled reply never suppresses the other.
 */
import { messageOf, noopWarn, SEVERITY_RANK } from "./types.js";
import type {
  Finding,
  InterviewAnswers,
  LlmClient,
  Severity,
  Warn,
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
 * The policy text as a judgment prompt should present it: the real extracted
 * text, or an explicit note when there is no /privacy page or no readable text.
 * Shared by both prompts so they describe "the policy" identically.
 */
function policyTextForPrompt(summary: Summary): string {
  if (!summary.policyPages.privacy.present) {
    return "(no /privacy page was found in the repo)";
  }
  return (
    privacyText(summary).trim() ||
    "(the /privacy page exists but has no readable text)"
  );
}

/**
 * The reply-format contract both judgment prompts demand: a machine-parseable
 * `{ findings: [...] }` so replies map to findings via
 * {@link parseJudgmentFindings}.
 */
const REPLY_SHAPE_INSTRUCTIONS: readonly string[] = [
  "Respond with JSON only, in this exact shape:",
  '{ "findings": [ { "id", "title", "severity", "category", "consequence", "fix" } ] }',
  'where "severity" is one of: critical, high, medium, low.',
  "Return an empty findings array if nothing is warranted.",
];

/**
 * The shared factual tail of a judgment prompt: the policy text, the full
 * summary, and the interview answers — the only inputs the model ever sees, and
 * the single place that guarantees both prompts feed the model the same context.
 */
function contextFooter(summary: Summary, answers: InterviewAnswers): string[] {
  return [
    "privacy policy text:",
    policyTextForPrompt(summary),
    "",
    "summary.json:",
    JSON.stringify(summary, null, 2),
    "",
    "interview answers:",
    JSON.stringify(answers, null, 2),
  ];
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
    ...REPLY_SHAPE_INSTRUCTIONS,
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
    ...contextFooter(summary, answers),
  ].join("\n");
}

/**
 * The deterministic half of the LLM-disclosure check: the LLM APIs the code
 * actually calls. A called LLM SDK means prompt contents — which routinely carry
 * user data — can leave for a model provider, so each is a candidate for "user
 * data sent to an LLM API without disclosure/basis".
 *
 * Only *called* SDKs count, for the same reason as the drift check: an imported-
 * but-never-invoked LLM dependency isn't sending prompts anywhere, so flagging it
 * would be a false positive. Deduped by destination so one provider reached via
 * two packages is a single candidate.
 *
 * This runs before the model so a repo that calls no LLM API skips the model
 * entirely — the gate that keeps a non-LLM repo silent.
 */
export function calledLlmApis(summary: Summary): DetectedSdk[] {
  const seen = new Set<string>();
  const candidates: DetectedSdk[] = [];
  for (const sdk of summary.sdks) {
    if (sdk.dataCategory !== "llm") continue;
    if (!sdk.called) continue;
    if (seen.has(sdk.destination)) continue;
    seen.add(sdk.destination);
    candidates.push(sdk);
  }
  return candidates;
}

/**
 * Assemble the LLM-disclosure prompt from the only two things the model is
 * allowed to see: the inspectable summary and the interview answers. Raw source
 * never appears here because it is never an input. The `candidates` are the
 * deterministically-detected called LLM APIs — highlighted so the model reasons
 * about disclosure and lawful basis for the right providers.
 */
export function buildLlmDisclosurePrompt(
  candidates: DetectedSdk[],
  summary: Summary,
  answers: InterviewAnswers,
): string {
  return [
    "You are a privacy-hygiene reviewer checking whether user data may reach an",
    "LLM API without disclosure or a lawful basis. The parser found these LLM",
    "providers wired into and called by the code. Prompts sent to them routinely",
    "carry personal data, which then leaves the developer's control.",
    "",
    "For each provider that plausibly receives user data without being disclosed,",
    "or without an evident lawful basis, emit one finding. Reason over two axes:",
    "- disclosure: is the provider named in the privacy policy text below?",
    "- lawful basis: is there an evident basis (consent, a DPA, contract) for",
    "  sending user data to it? You usually cannot confirm this from the summary —",
    "  say so and phrase the gap as conditional risk.",
    "Phrase every finding as conditional risk plus a nudge to verify with counsel —",
    "never a legal conclusion, and never assert the developer is violating any law.",
    "Let the interview answers condition applicability, severity, and wording:",
    "- EU/UK users sharpen the GDPR lawful-basis edge; their absence blunts it",
    "  (CCPA duties may still apply).",
    "- No signed DPAs makes the gap sharper; signed DPAs soften it.",
    "- Selling or sharing data sharpens the CCPA edge, since sending prompt",
    "  contents to an LLM provider can itself be a 'share'.",
    "Do not invent providers beyond the candidates listed. If a candidate is",
    "plausibly disclosed by a generic phrase in the policy, you may omit it.",
    "",
    ...REPLY_SHAPE_INSTRUCTIONS,
    "",
    "called LLM-API providers (detected in code):",
    JSON.stringify(
      candidates.map((c) => ({
        provider: c.destination,
        dataCategory: c.dataCategory,
        whyItMatters: c.whyItMatters,
        package: c.package,
      })),
      null,
      2,
    ),
    "",
    ...contextFooter(summary, answers),
  ].join("\n");
}

/**
 * Run the Reason stage: skip entirely when no provider is configured, otherwise
 * run each judgment check behind its own deterministic gate and concatenate the
 * `reasoned-about` findings. The checks are independent — one's empty gate or
 * garbled reply never suppresses the other.
 */
export async function reason(
  summary: Summary,
  answers: InterviewAnswers,
  client: LlmClient,
  onWarn: Warn = noopWarn,
): Promise<Finding[]> {
  if (!client.available) return [];

  return [
    ...(await runGatedCheck(
      "code-vs-policy drift",
      undisclosedProcessors(summary),
      (candidates) => buildDriftPrompt(candidates, summary, answers),
      client,
      onWarn,
    )),
    ...(await runGatedCheck(
      "LLM-data disclosure",
      calledLlmApis(summary),
      (candidates) => buildLlmDisclosurePrompt(candidates, summary, answers),
      client,
      onWarn,
    )),
  ];
}

/**
 * The shared shape of a judgment check: a deterministic candidate set gates a
 * single scoped model call. No candidates means the model is never consulted, so
 * a check with nothing to reason about stays silent and cheap.
 *
 * A provider that errors mid-call (dead endpoint, a 401 from a missing/invalid
 * key, a timeout) degrades to no findings for *this* check rather than aborting
 * the run: judgment is best-effort and never the credibility floor, so the
 * deterministic findings alongside it always survive. The failure is surfaced
 * via {@link Warn} so the user knows the check was skipped and why. Each check
 * catches independently, so one provider failure never suppresses the other.
 */
async function runGatedCheck(
  name: string,
  candidates: DetectedSdk[],
  buildPrompt: (candidates: DetectedSdk[]) => string,
  client: LlmClient,
  onWarn: Warn,
): Promise<Finding[]> {
  if (candidates.length === 0) return [];
  try {
    const raw = await client.complete({ prompt: buildPrompt(candidates) });
    return parseJudgmentFindings(raw);
  } catch (error) {
    onWarn(
      `Skipped the ${name} judgment check — the model provider errored: ` +
        `${messageOf(error)}. Your deterministic findings are unaffected.`,
    );
    return [];
  }
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
