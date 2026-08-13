import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyze } from "./analyze.js";
import { UNANSWERED_INTERVIEW } from "./types.js";
import type { LlmClient, LlmCompletionRequest, Report } from "./types.js";

/**
 * Integration coverage: run the real `analyze` seam in-process against the three
 * committed fixture repos (leaky / clean / middling). This is the same path CI
 * exercises, and the clean-repo assertion is the hard gate — a regression that
 * introduces a false positive must fail here.
 */

const fixture = (name: string) =>
  fileURLToPath(new URL(`../test/fixtures/${name}`, import.meta.url));

// These fixtures isolate the deterministic checks — the clean-repo silence gate
// is about false positives in code-level facts, not judgment. Running with an
// unavailable client skips the Reason stage; the throw guards against analyze
// ever calling a client it was told is not configured.
const failingLlmClient: LlmClient = {
  available: false,
  async complete() {
    throw new Error("unavailable LLM client should not be called");
  },
};

const run = (name: string): Promise<Report> =>
  analyze(fixture(name), UNANSWERED_INTERVIEW, failingLlmClient);

describe("analyze — fixture repos", () => {
  it("flags the leaky repo's secret and both leaks, most severe first", async () => {
    const report = await run("leaky");

    // Ranked by severity: the critical provider key leads.
    expect(report.findings[0]?.severity).toBe("critical");
    expect(report.findings.some((f) => f.title.includes("AWS access key ID"))).toBe(true);

    const ids = report.findings.map((f) => f.id);
    // The committed-secrets check and both leak checks all fire on this repo.
    expect(ids).toContain("committed-secrets");
    expect(ids).toContain("pii-in-logs");
    expect(ids).toContain("pii-in-urls-analytics");
    // The repo collects personal data but ships no /privacy, deletion, or export
    // path, so all three missing-path checks fire too.
    expect(ids).toContain("missing-privacy-page");
    expect(ids).toContain("missing-deletion-path");
    expect(ids).toContain("missing-export-path");
    // The presence-only checks say so, rather than implying a stub route suffices.
    expect(
      report.findings.find((f) => f.id === "missing-deletion-path")?.fix.toLowerCase(),
    ).toContain("presence");
    // Card data in the logs outranks the ordinary personal-data leaks.
    expect(
      report.findings.some(
        (f) => f.id === "pii-in-logs" && f.severity === "high" && /card/i.test(f.title),
      ),
    ).toBe(true);
    // Every finding here is a code-level fact carrying a consequence and a fix.
    expect(
      report.findings.every(
        (f) => f.determination === "checked-in-code" && f.consequence !== "" && f.fix !== "",
      ),
    ).toBe(true);
  });

  it("keeps the clean repo silent — the hard CI gate against false positives", async () => {
    const report = await run("clean");
    expect(report.findings).toEqual([]);
  });

  it("flags the middling repo's expected subset — secret + analytics leak, no log leak", async () => {
    const report = await run("middling");

    expect(report.findings).toHaveLength(2);
    // Ranked: the high-severity committed secret leads the medium analytics leak.
    expect(report.findings[0]).toMatchObject({
      id: "committed-secrets",
      determination: "checked-in-code",
      severity: "high",
    });
    expect(report.findings[1]).toMatchObject({
      id: "pii-in-urls-analytics",
      category: "analytics",
      severity: "medium",
    });
    // The subset is genuine: the logs check stays silent on this repo.
    expect(report.findings.some((f) => f.id === "pii-in-logs")).toBe(false);
    // This repo collects personal data but is careful: it ships a /privacy page
    // plus reachable deletion and export paths, so no missing-path check fires.
    const ids = report.findings.map((f) => f.id);
    expect(ids).not.toContain("missing-privacy-page");
    expect(ids).not.toContain("missing-deletion-path");
    expect(ids).not.toContain("missing-export-path");
  });
});

/**
 * The code-vs-policy drift check (the LLM judgment differentiator), exercised
 * end-to-end through `analyze` with a deterministic fake client. The fake always
 * offers a drift finding; whether it reaches the report is decided by the
 * deterministic diff, not by the model — so this proves both that the leaky repo
 * flags its undisclosed vendors and that the clean repo stays silent without the
 * model ever being consulted.
 */
function fakeLlmClient(response: string): {
  client: LlmClient;
  requests: LlmCompletionRequest[];
} {
  const requests: LlmCompletionRequest[] = [];
  const client: LlmClient = {
    available: true,
    async complete(request) {
      requests.push(request);
      return response;
    },
  };
  return { client, requests };
}

// A canned drift finding, phrased as conditional risk with a counsel nudge — the
// shape the drift prompt asks the model for.
const driftReply = JSON.stringify({
  findings: [
    {
      id: "undisclosed-processor",
      title: "A vendor your code uses may be undisclosed in your privacy policy",
      severity: "high",
      category: "disclosure",
      consequence:
        "Your code sends personal data to a third party your privacy policy doesn't name, which may be an undisclosed processor.",
      fix: "List the processor in your privacy policy and confirm a DPA is in place; check with counsel whether disclosure is required.",
    },
  ],
});

describe("analyze — code-vs-policy drift (judgment)", () => {
  it("flags the leaky repo's undisclosed processors and sends only the summary", async () => {
    const { client, requests } = fakeLlmClient(driftReply);

    const report = await analyze(fixture("leaky"), UNANSWERED_INTERVIEW, client);

    // The drift finding surfaces, labelled as reasoned-about (not a code fact).
    const drift = report.findings.find((f) => f.id === "undisclosed-processor");
    expect(drift?.determination).toBe("reasoned-about");

    // The model was consulted once, with the two wired-but-undisclosed vendors,
    // over the summary — never the raw source.
    expect(requests).toHaveLength(1);
    const prompt = requests[0]!.prompt;
    expect(prompt).toContain("Stripe");
    expect(prompt).toContain("Segment");
    expect(prompt).toContain("summary.json:");
  });

  it("keeps the clean repo silent — its policy names Stripe, so the model is never consulted", async () => {
    const { client, requests } = fakeLlmClient(driftReply);

    const report = await analyze(fixture("clean"), UNANSWERED_INTERVIEW, client);

    // The deterministic diff finds no drift, so a chatty model can't add one.
    expect(report.findings).toEqual([]);
    expect(requests).toHaveLength(0);
  });
});
