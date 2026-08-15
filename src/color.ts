/**
 * Terminal coloring for the human-readable report. Two responsibilities and no
 * others: a set of ANSI style helpers, and the single predicate that decides
 * whether coloring is on.
 *
 * No new runtime dependency: the helpers are hand-rolled ANSI escapes, and the
 * report renderer stays the thin caller that owns *where* each style is applied.
 */

/**
 * A set of style helpers, each `(string) => string`. When coloring is disabled
 * every helper is the identity function, so a caller can wrap unconditionally
 * and the disabled output stays byte-identical to plain text.
 */
export interface Palette {
  /** CRITICAL severity: bold red — the single most urgent mark. */
  boldRed: (text: string) => string;
  /** HIGH severity: red. */
  red: (text: string) => string;
  /** MEDIUM severity: yellow. */
  yellow: (text: string) => string;
  /** The all-clear "No findings" line. */
  green: (text: string) => string;
  /** LOW severity, metadata, disclaimer, and structural chrome. */
  dim: (text: string) => string;
  /** Finding titles and the "Why it matters:" / "Fix:" prefixes. */
  bold: (text: string) => string;
}

const identity = (text: string) => text;

/** The disabled palette: every helper leaves its input untouched. */
const PLAIN: Palette = {
  boldRed: identity,
  red: identity,
  yellow: identity,
  green: identity,
  dim: identity,
  bold: identity,
};

/** Wrap `text` in an SGR open/close pair, e.g. `wrap("31", "39")` for red. */
function wrap(open: string, close: string): (text: string) => string {
  return (text) => `\x1b[${open}m${text}\x1b[${close}m`;
}

/** The enabled palette: the fixed 8-color ANSI set, no 256-/true-color. */
const COLORED: Palette = {
  boldRed: wrap("1;31", "22;39"),
  red: wrap("31", "39"),
  yellow: wrap("33", "39"),
  green: wrap("32", "39"),
  dim: wrap("2", "22"),
  bold: wrap("1", "22"),
};

/** Select the palette; disabled returns the identity-function {@link PLAIN}. */
export function makePalette(enabled: boolean): Palette {
  return enabled ? COLORED : PLAIN;
}

/** Inputs to {@link shouldColorize}: everything the decision depends on. */
export interface ColorizeInputs {
  /** Whether the report's destination (stdout) is an interactive terminal. */
  isTTY: boolean;
  /** The process environment, for the `NO_COLOR`/`FORCE_COLOR` conventions. */
  env: NodeJS.ProcessEnv;
  /** Whether the user passed `--no-color`. */
  noColorFlag: boolean;
}

/**
 * The single pure predicate that decides whether the report is colorized, so
 * every enablement rule and its precedence is testable without spawning the CLI.
 *
 * Precedence, highest first:
 * 1. `--no-color` — an explicit opt-out always wins.
 * 2. `NO_COLOR` (present and non-empty) — the machine-wide preference, and it
 *    overrides `FORCE_COLOR` per the convention.
 * 3. `FORCE_COLOR` — opts color back in even off a terminal; `0`/`false` is off.
 * 4. Otherwise, follow the terminal: color only when stdout is a TTY.
 */
export function shouldColorize({ isTTY, env, noColorFlag }: ColorizeInputs): boolean {
  if (noColorFlag) return false;
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") return false;
  const force = env.FORCE_COLOR;
  if (force !== undefined) return force !== "0" && force !== "false";
  return isTTY;
}
