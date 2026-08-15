import { makePalette } from "./color.js";
import { DETERMINATION_LABELS, DISCLAIMER, SEVERITY_RANK } from "./types.js";
import type { Palette } from "./color.js";
import type { Finding, Report, Severity } from "./types.js";

/**
 * Bare severity tokens, colored on their own; the padding that aligns the marks
 * to a common width is added separately (outside any escape codes) so alignment
 * survives coloring — ANSI codes are zero-width, so the visible columns don't
 * shift when color is on.
 */
const SEVERITY_TOKEN: Record<Severity, string> = {
  critical: "[CRITICAL]",
  high: "[HIGH]",
  medium: "[MEDIUM]",
  low: "[LOW]",
};

/** Width every severity mark is padded to, so titles line up in a column. */
const MARK_WIDTH = "[CRITICAL]".length;

/**
 * Severities most-severe-first, for the count-line breakdown. Derived from the
 * canonical {@link SEVERITY_RANK} rather than re-encoding the order, so a new or
 * reordered severity flows through from its single source of truth.
 */
const SEVERITIES_BY_RANK = (Object.keys(SEVERITY_RANK) as Severity[]).sort(
  (a, b) => SEVERITY_RANK[b] - SEVERITY_RANK[a],
);

/** Options for {@link renderReport}. */
export interface RenderOptions {
  /**
   * Emit ANSI color/formatting. Defaults to `false` so every existing caller
   * and every non-terminal consumer gets byte-identical plain output; only an
   * explicit opt-in (an interactive terminal, per {@link shouldColorize}) adds
   * color.
   */
  color?: boolean;
}

/**
 * The palette helper each severity draws its mark and breakdown count from —
 * a `Record` to match the repo's other severity-keyed lookups (`SEVERITY_RANK`,
 * `SEVERITY_TOKEN`), rather than a switch.
 */
const SEVERITY_STYLE: Record<Severity, (palette: Palette) => (text: string) => string> = {
  critical: (palette) => palette.boldRed,
  high: (palette) => palette.red,
  medium: (palette) => palette.yellow,
  low: (palette) => palette.dim,
};

/** The style applied to each severity's mark and its breakdown count. */
function severityStyle(severity: Severity, palette: Palette): (text: string) => string {
  return SEVERITY_STYLE[severity](palette);
}

/**
 * Render a {@link Report} as a human-readable terminal report. Findings are
 * shown in the order given (already ranked most-severe-first by `analyze`).
 *
 * A pure function of its inputs. With the default `color: false` the output is
 * plain text; with `color: true` severity marks are tinted, titles bold,
 * metadata and chrome dimmed, and the count line gains a per-severity breakdown.
 */
export function renderReport(report: Report, options: RenderOptions = {}): string {
  const color = options.color ?? false;
  const palette = makePalette(color);
  const lines: string[] = [];

  lines.push(palette.dim(`Privacy hygiene report for ${report.repoPath}`));
  lines.push("");

  if (report.findings.length === 0) {
    lines.push(palette.green("No findings. Nothing flagged in this run."));
  } else {
    const count = report.findings.length;
    let countLine = `${count} finding${count === 1 ? "" : "s"}, most serious first:`;
    // The breakdown is extra text, not just an escape wrap, so it appears only
    // in the color path — keeping the plain default byte-identical to today.
    if (color) countLine += `  ${severityBreakdown(report.findings, palette)}`;
    lines.push(countLine);
    lines.push("");
    for (const finding of report.findings) {
      lines.push(...renderFinding(finding, palette));
      lines.push("");
    }
  }

  lines.push(palette.dim("—".repeat(4)));
  lines.push(palette.dim(DISCLAIMER));

  return lines.join("\n");
}

/** A tinted one-line distribution, e.g. "1 critical · 3 high · 4 medium". */
function severityBreakdown(findings: Finding[], palette: Palette): string {
  const counts = new Map<Severity, number>();
  for (const finding of findings) {
    counts.set(finding.severity, (counts.get(finding.severity) ?? 0) + 1);
  }
  const parts: string[] = [];
  for (const severity of SEVERITIES_BY_RANK) {
    const n = counts.get(severity) ?? 0;
    if (n === 0) continue;
    parts.push(severityStyle(severity, palette)(`${n} ${severity}`));
  }
  return parts.join(palette.dim(" · "));
}

function renderFinding(finding: Finding, palette: Palette): string[] {
  const label = DETERMINATION_LABELS[finding.determination];
  const token = SEVERITY_TOKEN[finding.severity];
  const mark = severityStyle(finding.severity, palette)(token);
  const pad = " ".repeat(MARK_WIDTH - token.length);
  return [
    `${mark}${pad} ${palette.bold(finding.title)}  (${palette.dim(`${finding.category} · ${label}`)})`,
    `  ${palette.bold("Why it matters:")} ${finding.consequence}`,
    `  ${palette.bold("Fix:")} ${finding.fix}`,
  ];
}
