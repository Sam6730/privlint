/**
 * Shared types for the analysis pipeline.
 *
 * The central seam is {@link analyze}, which turns a repo (plus interview
 * answers and an injected LLM client) into a {@link Report}. Everything here is
 * designed to stay stable as later tickets wire in real checks.
 */

/**
 * How severe a finding is, ordered from most to least dangerous. Findings are
 * ranked by this (see {@link rankFindings}), never by category — category is a
 * per-finding label, not a sort key.
 */
export type Severity = "critical" | "high" | "medium" | "low";

/** Severity ordering: higher number == more severe == ranked earlier. */
export const SEVERITY_RANK: Record<Severity, number> = {
  critical: 3,
  high: 2,
  medium: 1,
  low: 0,
};

/**
 * How a finding was determined — the trust signal shown to the user so they
 * know how much to lean on it.
 *
 * - `checked-in-code`  — a deterministic check found it in the source.
 * - `reasoned-about`   — the LLM reasoned about it over the summary.
 * - `you-told-us`      — it follows from an interview answer the user gave.
 */
export type DeterminationMethod =
  | "checked-in-code"
  | "reasoned-about"
  | "you-told-us";

/** Human-facing labels for each determination method. */
export const DETERMINATION_LABELS: Record<DeterminationMethod, string> = {
  "checked-in-code": "checked in code",
  "reasoned-about": "reasoned about",
  "you-told-us": "you told us",
};

/**
 * A single privacy-hygiene finding, in plain language.
 *
 * Findings never state legal conclusions: deterministic checks may state facts,
 * while judgment/business-fact items must read as conditional risk plus a nudge
 * to verify with counsel.
 */
export interface Finding {
  /** Stable identifier for the check that produced this finding. */
  id: string;
  /** Short, plain-language headline. */
  title: string;
  severity: Severity;
  /** Per-finding label (e.g. "secrets", "logging"). Not a sort key. */
  category: string;
  determination: DeterminationMethod;
  /** Concrete consequence: why this matters, in the founder's terms. */
  consequence: string;
  /** Specific, actionable next step. */
  fix: string;
}

/**
 * A tri-state answer: the interview can't assume `false` for a question the
 * user hasn't answered, so "unknown" is a first-class value.
 */
export type TriState = boolean | "unknown";

/**
 * The three business facts the code can't reveal, asked once per run. Unused
 * until the interview ticket wires them into checks.
 */
export interface InterviewAnswers {
  /** Do you have EU / UK users? (conditions GDPR / UK GDPR findings) */
  hasEuUkUsers: TriState;
  /** Have you signed data-processing agreements with your vendors? */
  hasSignedDpas: TriState;
  /** Do you run ads / sell or share data? (conditions CCPA-only findings) */
  sellsOrSharesData: TriState;
}

/** Interview answers before anything has been asked — everything unknown. */
export const UNANSWERED_INTERVIEW: InterviewAnswers = {
  hasEuUkUsers: "unknown",
  hasSignedDpas: "unknown",
  sellsOrSharesData: "unknown",
};

/** A request sent to the model provider (only the summary, never source code). */
export interface LlmCompletionRequest {
  /** The prompt, built from summary.json + interview answers. */
  prompt: string;
}

/**
 * The LLM client is injected into {@link analyze} as a dependency so judgment
 * checks stay deterministic in tests.
 */
export interface LlmClient {
  /**
   * Whether a real model provider is configured. The Reason stage skips
   * judgment entirely when this is false, so a run with no provider still
   * produces the deterministic findings. It is a capability flag, not a
   * guard against misuse: {@link complete} on an unavailable client still
   * throws, so anything that calls it directly fails loudly.
   */
  readonly available: boolean;
  complete(request: LlmCompletionRequest): Promise<string>;
}

/** The result of a run: the analysed repo and its ranked findings. */
export interface Report {
  /** The repo path that was analysed. */
  repoPath: string;
  /** Findings, already ranked most-severe-first. */
  findings: Finding[];
}
