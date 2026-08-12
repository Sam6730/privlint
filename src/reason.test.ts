import { describe, expect, it } from "vitest";
import { emptySummary } from "./checks/summary-fixture.js";
import { buildJudgmentPrompt, reason } from "./reason.js";
import { UNANSWERED_INTERVIEW } from "./types.js";
import type { LlmCompletionRequest, LlmClient } from "./types.js";

/**
 * A fake LLM client: it records the request it was handed and returns a canned
 * response, so a test can assert both what the Reason stage sends and how a
 * model reply maps to findings — with no network calls.
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

const summaryWithVendor = emptySummary({
  routes: [{ path: "/api/charge", method: "POST", source: "next-app", file: "app/api/charge/route.ts" }],
  sdks: [
    {
      package: "stripe",
      dataCategory: "payment",
      destination: "Stripe",
      whyItMatters: "card data leaves for a payment processor",
      imported: true,
      called: true,
      file: "app/api/charge/route.ts",
    },
  ],
});

const cannedResponse = JSON.stringify({
  findings: [
    {
      id: "undisclosed-processor",
      title: "Stripe isn't named in your privacy policy",
      severity: "high",
      category: "disclosure",
      consequence: "You send card data to Stripe but your policy never lists it as a processor.",
      fix: "Name Stripe in your privacy policy's list of processors, and confirm a DPA is in place.",
    },
  ],
});

describe("buildJudgmentPrompt", () => {
  it("sends only the summary and interview answers — never raw source", () => {
    const prompt = buildJudgmentPrompt(summaryWithVendor, {
      hasEuUkUsers: true,
      hasSignedDpas: "unknown",
      sellsOrSharesData: false,
    });

    // The summary is the sole factual input, serialized in full.
    expect(prompt).toContain(JSON.stringify(summaryWithVendor, null, 2));
    // The interview answers condition the reasoning and must be present.
    expect(prompt).toContain("hasEuUkUsers");
    expect(prompt).toContain("hasSignedDpas");
    // The stage asks for a machine-parseable reply so responses map to findings.
    expect(prompt.toLowerCase()).toContain("json");
  });
});

describe("reason", () => {
  it("maps a canned model response to reasoned-about findings", async () => {
    const { client, requests } = fakeLlmClient(cannedResponse);

    const findings = await reason(summaryWithVendor, UNANSWERED_INTERVIEW, client);

    // Exactly what the fake was asked proves the summary+answers is the payload.
    expect(requests).toHaveLength(1);
    expect(requests[0]?.prompt).toBe(buildJudgmentPrompt(summaryWithVendor, UNANSWERED_INTERVIEW));

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      id: "undisclosed-processor",
      title: "Stripe isn't named in your privacy policy",
      severity: "high",
      category: "disclosure",
      // The trust signal is fixed by the stage, not taken from the model.
      determination: "reasoned-about",
    });
  });

  it("forces the trust signal to reasoned-about even if the model claims otherwise", async () => {
    const { client } = fakeLlmClient(
      JSON.stringify({
        findings: [
          {
            id: "x",
            title: "t",
            severity: "low",
            category: "disclosure",
            consequence: "c",
            fix: "f",
            // A model that tries to pass itself off as a code-level fact is overridden.
            determination: "checked-in-code",
          },
        ],
      }),
    );

    const findings = await reason(summaryWithVendor, UNANSWERED_INTERVIEW, client);

    expect(findings[0]?.determination).toBe("reasoned-about");
  });

  it("tolerates a fenced JSON reply (```json … ```)", async () => {
    const { client } = fakeLlmClient("```json\n" + cannedResponse + "\n```");

    const findings = await reason(summaryWithVendor, UNANSWERED_INTERVIEW, client);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.id).toBe("undisclosed-processor");
  });

  it("drops malformed items rather than crashing the run", async () => {
    const { client } = fakeLlmClient(
      JSON.stringify({
        findings: [
          { id: "ok", title: "t", severity: "medium", category: "disclosure", consequence: "c", fix: "f" },
          { id: "bad-severity", title: "t", severity: "spicy", category: "disclosure", consequence: "c", fix: "f" },
          { id: "missing-fix", title: "t", severity: "low", category: "disclosure", consequence: "c" },
        ],
      }),
    );

    const findings = await reason(summaryWithVendor, UNANSWERED_INTERVIEW, client);

    expect(findings.map((f) => f.id)).toEqual(["ok"]);
  });

  it("returns [] on an unparseable reply instead of throwing", async () => {
    const { client } = fakeLlmClient("I could not analyse this repository.");

    await expect(reason(summaryWithVendor, UNANSWERED_INTERVIEW, client)).resolves.toEqual([]);
  });

  it("skips the model entirely when no provider is configured", async () => {
    let called = false;
    const unavailable: LlmClient = {
      available: false,
      async complete() {
        called = true;
        throw new Error("should not be called");
      },
    };

    const findings = await reason(summaryWithVendor, UNANSWERED_INTERVIEW, unavailable);

    expect(findings).toEqual([]);
    expect(called).toBe(false);
  });
});
