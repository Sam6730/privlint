/**
 * The PII-in-URLs/analytics check: turn the {@link Summary}'s `url` and
 * `analytics-event` PII signals into ranked {@link Finding}s. A pure
 * `check(summary) → Finding[]` like the other deterministic checks, labelled
 * `checked-in-code` because the parser saw the flow in the source.
 *
 * Both sinks push personal data outward, but for different reasons, so each gets
 * its own copy:
 *
 * - A URL leaks *incidentally* — the value lands in server access logs, browser
 *   history, and the `Referer` header sent to third parties.
 * - An analytics property leaks *by design* — it's shipped to the analytics
 *   vendor and everyone with dashboard access, often outside any DPA.
 *
 * Severity still comes from how sensitive the field is (see
 * {@link SENSITIVITY_META}); the sink only changes the phrasing.
 */
import type { Finding } from "../types.js";
import type { PiiSignal, PiiSignalKind, Summary } from "../summary.js";
import { classifyPiiField, SENSITIVITY_META } from "./pii-fields.js";

/** Per-sink copy: where the data goes, why that leaks, and how to stop it. */
interface SinkCopy {
  /** Per-finding category label. */
  category: string;
  /** Fills the title: "… put in a URL", "… sent to analytics". */
  placement: string;
  /** The "why this leaks" clause of the consequence. */
  exposure: string;
  /** The remediation, parameterised by the field name. */
  fix: (field: string) => string;
}

const SINK_COPY: Record<Exclude<PiiSignalKind, "log">, SinkCopy> = {
  url: {
    category: "urls",
    placement: "put in a URL",
    exposure:
      "URLs leak — they land in server access logs, browser history, and the Referer header sent to third parties — so this exposes it to systems that never needed it.",
    fix: (field) =>
      `Move \`${field}\` out of the URL and into the request body (or drop it), so it isn't captured in logs, history, or referrer headers.`,
  },
  "analytics-event": {
    category: "analytics",
    placement: "sent to analytics",
    exposure:
      "That ships it to your analytics vendor and everyone with dashboard access, often outside any data-processing agreement — turning product analytics into an uncontrolled copy of personal data.",
    fix: (field) =>
      `Stop sending \`${field}\` to analytics — identify users by an opaque id and keep personal fields out of event properties.`,
  },
};

/** Map every URL / analytics PII signal in the summary to a finding. */
export function checkPiiInUrlsOrAnalytics(summary: Summary): Finding[] {
  return summary.piiSignals
    .filter(
      (signal): signal is PiiSignal & { kind: keyof typeof SINK_COPY } =>
        signal.kind !== "log",
    )
    .map((signal) => {
      const copy = SINK_COPY[signal.kind];
      const { severity, noun } = SENSITIVITY_META[classifyPiiField(signal.field)];
      return {
        id: "pii-in-urls-analytics",
        title: `${noun} (${signal.field}) ${copy.placement} in ${signal.file}:${signal.line}`,
        severity,
        category: copy.category,
        determination: "checked-in-code",
        consequence: `${noun} (\`${signal.field}\`) is ${copy.placement}. ${copy.exposure}`,
        fix: copy.fix(signal.field),
      };
    });
}
