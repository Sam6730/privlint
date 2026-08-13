/**
 * The Interview stage: collect the three business facts the code can't reveal,
 * once per run, into a stable {@link InterviewAnswers}.
 *
 * The stage is deliberately layered so the CLI edge stays thin and everything
 * decision-making is pure and testable:
 *
 * - {@link parseTriState} — the one place free-text ("yes"/"n"/"unknown") maps to
 *   a {@link TriState}. An unrecognised word is `undefined`, never a silent guess.
 * - {@link interviewFromFlags} / {@link interviewFromFile} — the two
 *   non-interactive sources (for tests and CI), each yielding a partial answer set.
 * - {@link collectInterview} — merges the sources by precedence (flags > file >
 *   unknown) and, only when handed an `ask` callback, prompts for whatever remains
 *   unanswered. The prompting transport (readline, a test double) lives in the
 *   caller, so this function never touches stdin itself.
 *
 * Answers are never auto-verdicted here: this stage only records what the founder
 * said. The conditioning it enables lives in the checks and the Reason stage.
 */
import { UNANSWERED_INTERVIEW } from "./types.js";
import type { InterviewAnswers, TriState } from "./types.js";

/** One interview question: how it's keyed, its CLI flag, and its prompt text. */
export interface InterviewQuestion {
  /** The {@link InterviewAnswers} field this question fills. */
  key: keyof InterviewAnswers;
  /** The non-interactive flag that supplies it (also its file key is {@link key}). */
  flag: string;
  /** The plain-language question shown when prompting interactively. */
  prompt: string;
}

/** The three questions, asked in this order. */
export const INTERVIEW_QUESTIONS: readonly InterviewQuestion[] = [
  {
    key: "hasEuUkUsers",
    flag: "--eu-uk-users",
    prompt: "Do you have users in the EU or UK?",
  },
  {
    key: "hasSignedDpas",
    flag: "--signed-dpas",
    prompt: "Have you signed data-processing agreements (DPAs) with your vendors?",
  },
  {
    key: "sellsOrSharesData",
    flag: "--sells-shares-data",
    prompt: "Do you run ads, or sell or share personal data?",
  },
];

const YES = new Set(["y", "yes", "true", "t", "1"]);
const NO = new Set(["n", "no", "false", "f", "0"]);
// An explicit "I don't know" is a first-class answer, not a failure to answer.
const UNKNOWN = new Set(["unknown", "u", "skip", "?", ""]);

/**
 * Map one free-text answer to a {@link TriState}. Returns `undefined` for a word
 * we don't recognise so callers can decide whether to reject it (a flag) or fall
 * back to "unknown" (an interactive answer) — we never guess a yes/no.
 */
export function parseTriState(value: string): TriState | undefined {
  const v = value.trim().toLowerCase();
  if (YES.has(v)) return true;
  if (NO.has(v)) return false;
  if (UNKNOWN.has(v)) return "unknown";
  return undefined;
}

/** Read a `--flag value` pair from argv; undefined when the flag is absent. */
export function flagValue(
  args: readonly string[],
  flag: string,
): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}

/** The four flags that carry a value token (the three questions + the file). */
export const INTERVIEW_VALUE_FLAGS: readonly string[] = [
  ...INTERVIEW_QUESTIONS.map((question) => question.flag),
  "--interview-file",
];

/**
 * Collect whichever answers were supplied as `--eu-uk-users yes` style flags. A
 * flag present with an unparseable value throws — a CI config typo should fail
 * loudly, not silently degrade to "unknown".
 */
export function interviewFromFlags(
  args: readonly string[],
): Partial<InterviewAnswers> {
  const out: Partial<InterviewAnswers> = {};
  for (const question of INTERVIEW_QUESTIONS) {
    const raw = flagValue(args, question.flag);
    if (raw === undefined) continue;
    const parsed = parseTriState(raw);
    if (parsed === undefined) {
      throw new Error(
        `Invalid value for ${question.flag}: "${raw}" (use yes, no, or unknown).`,
      );
    }
    out[question.key] = parsed;
  }
  return out;
}

/**
 * Collect whichever answers a JSON interview file supplied. Values may be a
 * boolean, "unknown", or a yes/no word; unknown keys are ignored (forward-
 * compatible), and a non-object file throws.
 */
export function interviewFromFile(contents: string): Partial<InterviewAnswers> {
  const parsed: unknown = JSON.parse(contents);
  if (!isRecord(parsed)) {
    throw new Error("Interview file must be a JSON object of answers.");
  }
  const out: Partial<InterviewAnswers> = {};
  for (const question of INTERVIEW_QUESTIONS) {
    if (!(question.key in parsed)) continue;
    out[question.key] = coerceTriState(parsed[question.key], question);
  }
  return out;
}

/** Coerce a JSON value (boolean, "unknown", or yes/no string) to a TriState. */
function coerceTriState(value: unknown, question: InterviewQuestion): TriState {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const parsed = parseTriState(value);
    if (parsed !== undefined) return parsed;
  }
  throw new Error(
    `Invalid value for "${question.key}" in interview file: ${JSON.stringify(
      value,
    )} (use true, false, or "unknown").`,
  );
}

/** The sources {@link collectInterview} draws answers from. */
export interface InterviewSources {
  /** CLI args, scanned for the question flags (which win over the file). */
  args: readonly string[];
  /** Raw contents of a `--interview-file`, when one was given. */
  fileContents?: string;
  /**
   * Prompt for a single question and return the raw reply. Provided only for an
   * interactive run; when omitted, unanswered questions stay "unknown" — which is
   * exactly what a non-interactive CI run wants.
   */
  ask?: (question: InterviewQuestion) => Promise<string>;
}

/**
 * Resolve the run's {@link InterviewAnswers} from all sources. Precedence is
 * flags > file > the unknown default. Any question still unanswered after the
 * non-interactive sources is prompted for via `ask`, if one was supplied; an
 * unrecognised interactive reply falls back to "unknown" rather than looping.
 */
export async function collectInterview(
  sources: InterviewSources,
): Promise<InterviewAnswers> {
  const fromFile =
    sources.fileContents !== undefined
      ? interviewFromFile(sources.fileContents)
      : {};
  const fromFlags = interviewFromFlags(sources.args);

  const answers: InterviewAnswers = {
    ...UNANSWERED_INTERVIEW,
    ...fromFile,
    ...fromFlags,
  };

  if (!sources.ask) return answers;

  // Only prompt for what the non-interactive sources didn't already settle; an
  // explicit `--eu-uk-users unknown` counts as settled and is not re-asked.
  const supplied = new Set<string>([
    ...Object.keys(fromFile),
    ...Object.keys(fromFlags),
  ]);
  for (const question of INTERVIEW_QUESTIONS) {
    if (supplied.has(question.key)) continue;
    const reply = await sources.ask(question);
    answers[question.key] = parseTriState(reply) ?? "unknown";
  }
  return answers;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
