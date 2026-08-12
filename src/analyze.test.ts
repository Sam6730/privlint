import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyze } from "./analyze.js";
import { notConfiguredLlmClient } from "./llm.js";
import { UNANSWERED_INTERVIEW } from "./types.js";
import type { LlmCompletionRequest, LlmClient } from "./types.js";

const minimalRepo = fileURLToPath(
  new URL("../test/fixtures/minimal", import.meta.url),
);

/**
 * A fake, available client: it records what it was sent and returns a canned
 * judgment reply, so a test can prove the Reason seam end-to-end — what summary
 * reaches the model, and how its reply becomes a finding — with no network.
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

const cannedJudgment = JSON.stringify({
  findings: [
    {
      id: "undisclosed-processor",
      title: "A vendor may be undisclosed",
      severity: "high",
      category: "disclosure",
      consequence: "Data may leave for a processor your policy doesn't name.",
      fix: "List the processor in your privacy policy and confirm a DPA.",
    },
  ],
});

describe("analyze", () => {
  it("skips the model and reports no findings when no provider is configured", async () => {
    const report = await analyze(
      minimalRepo,
      UNANSWERED_INTERVIEW,
      notConfiguredLlmClient,
    );

    expect(report.findings).toEqual([]);
    expect(report.repoPath).toBe(minimalRepo);
  });

  it("maps a canned model reply into the report and sends only the summary", async () => {
    const { client, requests } = fakeLlmClient(cannedJudgment);

    const report = await analyze(minimalRepo, UNANSWERED_INTERVIEW, client);

    // The pass-through seam: the model's reply becomes a reasoned-about finding.
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]).toMatchObject({
      id: "undisclosed-processor",
      determination: "reasoned-about",
      severity: "high",
    });

    // What reached the model is the parsed summary (a JSON object with the
    // repo's path), not the repo's raw source files.
    expect(requests).toHaveLength(1);
    const prompt = requests[0]!.prompt;
    expect(prompt).toContain('"repoPath"');
    expect(prompt).toContain("summary.json:");
  });

  it("rejects when the repo path does not exist", async () => {
    await expect(
      analyze(
        minimalRepo + "-does-not-exist",
        UNANSWERED_INTERVIEW,
        notConfiguredLlmClient,
      ),
    ).rejects.toThrow();
  });
});
