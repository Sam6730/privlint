import { describe, expect, it } from "vitest";
import { emptySummary } from "./checks/summary-fixture.js";
import { buildDriftPrompt, reason, undisclosedProcessors } from "./reason.js";
import { UNANSWERED_INTERVIEW } from "./types.js";
import type { DetectedSdk } from "./summary.js";
import type { LlmCompletionRequest, LlmClient } from "./types.js";

/**
 * A fake LLM client: it records the request it was handed and returns a canned
 * response, so a test can assert both what the Reason stage sends and how a
 * model reply maps to findings — with no network calls. It also records whether
 * it was called at all, which is how the deterministic drift gate is proven.
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

/** A detected Stripe SDK, with fields the drift check reads. */
const stripeSdk: DetectedSdk = {
  package: "stripe",
  dataCategory: "payment",
  destination: "Stripe",
  whyItMatters: "card data leaves for a payment processor",
  imported: true,
  called: true,
  file: "app/api/charge/route.ts",
};

const segmentSdk: DetectedSdk = {
  package: "@segment/analytics-node",
  dataCategory: "analytics",
  destination: "Segment",
  whyItMatters: "user events are piped to an analytics fan-out",
  imported: true,
  called: true,
  file: "app/api/charge/route.ts",
};

/** A summary with a wired vendor and no /privacy page — pure drift. */
const summaryWithVendor = emptySummary({
  routes: [
    { path: "/api/charge", method: "POST", source: "next-app", file: "app/api/charge/route.ts" },
  ],
  sdks: [stripeSdk],
});

/** A summary whose /privacy page names the one vendor the code uses. */
const summaryVendorDisclosed = emptySummary({
  sdks: [stripeSdk],
  policyPages: {
    privacy: {
      present: true,
      file: "app/privacy/page.tsx",
      text: "We process payments through Stripe. We do not sell your data.",
    },
    terms: { present: false },
  },
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

describe("undisclosedProcessors", () => {
  it("flags a wired vendor whose name is absent from the policy text", () => {
    const candidates = undisclosedProcessors(summaryWithVendor);
    expect(candidates.map((c) => c.destination)).toEqual(["Stripe"]);
  });

  it("stays silent when the policy names the vendor (case-insensitive)", () => {
    const disclosed = emptySummary({
      sdks: [stripeSdk],
      policyPages: {
        privacy: { present: true, file: "p", text: "We use STRIPE for payments." },
        terms: { present: false },
      },
    });
    expect(undisclosedProcessors(disclosed)).toEqual([]);
  });

  it("treats an absent /privacy page as naming no processors", () => {
    // No policy text at all → every wired vendor is undisclosed.
    const candidates = undisclosedProcessors(
      emptySummary({ sdks: [stripeSdk, segmentSdk] }),
    );
    expect(candidates.map((c) => c.destination)).toEqual(["Stripe", "Segment"]);
  });

  it("dedupes by destination so one vendor is one candidate", () => {
    const stripeBrowser: DetectedSdk = { ...stripeSdk, package: "@stripe/stripe-js" };
    const candidates = undisclosedProcessors(
      emptySummary({ sdks: [stripeSdk, stripeBrowser] }),
    );
    expect(candidates.map((c) => c.destination)).toEqual(["Stripe"]);
  });

  it("returns nothing when no vendors were detected", () => {
    expect(undisclosedProcessors(emptySummary())).toEqual([]);
  });

  it("ignores an imported-but-never-called vendor — no data actually leaves", () => {
    // A dependency that ships but is never invoked isn't sending data anywhere,
    // so flagging it as an undisclosed processor would be a false positive.
    const importedNotCalled: DetectedSdk = { ...stripeSdk, called: false };
    expect(undisclosedProcessors(emptySummary({ sdks: [importedNotCalled] }))).toEqual([]);
  });
});

describe("buildDriftPrompt", () => {
  it("sends the candidate vendors, the policy text, and the answers — never raw source", () => {
    const candidates = undisclosedProcessors(summaryWithVendor);
    const prompt = buildDriftPrompt(candidates, summaryWithVendor, {
      hasEuUkUsers: true,
      hasSignedDpas: false,
      sellsOrSharesData: "unknown",
    });

    // The candidate vendor is named so the model reasons about the right thing.
    expect(prompt).toContain("Stripe");
    // The full inspectable summary is the sole factual input, serialized in full.
    expect(prompt).toContain(JSON.stringify(summaryWithVendor, null, 2));
    // The interview answers condition severity/phrasing and must be present.
    expect(prompt).toContain("hasSignedDpas");
    // It asks for a machine-parseable reply so responses map to findings.
    expect(prompt.toLowerCase()).toContain("json");
    // It must steer away from legal verdicts and toward a counsel nudge.
    expect(prompt.toLowerCase()).toContain("counsel");
  });
});

describe("reason", () => {
  it("maps a canned drift reply to reasoned-about findings when a vendor is undisclosed", async () => {
    const { client, requests } = fakeLlmClient(cannedResponse);

    const findings = await reason(summaryWithVendor, UNANSWERED_INTERVIEW, client);

    // The model was consulted with the drift prompt for this vendor.
    expect(requests).toHaveLength(1);
    expect(requests[0]?.prompt).toBe(
      buildDriftPrompt(
        undisclosedProcessors(summaryWithVendor),
        summaryWithVendor,
        UNANSWERED_INTERVIEW,
      ),
    );

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

  it("stays silent WITHOUT calling the model when every vendor is disclosed", async () => {
    // The deterministic gate: the policy names Stripe, so there is nothing to
    // reason about and the model is never consulted — a clean repo can't be made
    // to cry wolf by a chatty model.
    const { client, requests } = fakeLlmClient(cannedResponse);

    const findings = await reason(summaryVendorDisclosed, UNANSWERED_INTERVIEW, client);

    expect(findings).toEqual([]);
    expect(requests).toHaveLength(0);
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
