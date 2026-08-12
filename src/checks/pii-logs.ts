/**
 * The PII/card-in-logs check: turn the {@link Summary}'s `log` PII signals into
 * ranked {@link Finding}s. Like {@link checkCommittedSecrets}, this is a pure
 * `check(summary) → Finding[]` with no I/O — the parser already found the flow,
 * so these are facts and are labelled `checked-in-code`.
 *
 * Logs are the quiet leak: a value written to `console.*`/a logger gets shipped
 * to a log vendor, retained for months, and read by staff — so personal data in
 * a log line spreads far beyond where the user expects it. Card data makes it a
 * PCI problem on top, which is why it leads on severity (see
 * {@link SENSITIVITY_META}).
 */
import type { Finding } from "../types.js";
import type { PiiSignal, Summary } from "../summary.js";
import { classifyPiiField, SENSITIVITY_META } from "./pii-fields.js";

/**
 * The shared "why a log line leaks" clause: what a written value is exposed to.
 * Every logs finding carries it; card data appends a PCI clause on top.
 */
const LOG_EXPOSURE =
  "Logs get shipped to third-party log services, retained for months, and read by staff, so this spreads the value well beyond where the user expects it to live.";

const PCI_CLAUSE =
  " Storing card data in logs also breaks your PCI obligations.";

/** Map every `log` PII signal in the summary to a `checked-in-code` finding. */
export function checkPiiInLogs(summary: Summary): Finding[] {
  return summary.piiSignals
    .filter((signal): signal is PiiSignal => signal.kind === "log")
    .map((signal) => {
      const sensitivity = classifyPiiField(signal.field);
      const { severity, noun } = SENSITIVITY_META[sensitivity];
      const consequence =
        `${noun} (\`${signal.field}\`) is written to your logs. ${LOG_EXPOSURE}` +
        (sensitivity === "card" ? PCI_CLAUSE : "");
      return {
        id: "pii-in-logs",
        title: `${noun} (${signal.field}) written to logs in ${signal.file}:${signal.line}`,
        severity,
        category: "logging",
        determination: "checked-in-code",
        consequence,
        fix: `Remove \`${signal.field}\` from the log call — log a non-identifying reference (an id, not the value) instead — and scrub it from any logs already retained.`,
      };
    });
}
