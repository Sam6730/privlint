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

  it("skips the model when the repo has no vendor drift to reason about", async () => {
    // The minimal repo wires no third-party SDKs, so the drift diff finds no
    // undisclosed processor — the judgment stage never consults the model, even
    // though one is available.
    const { client, requests } = fakeLlmClient("{ irrelevant }");

    const report = await analyze(minimalRepo, UNANSWERED_INTERVIEW, client);

    expect(report.findings).toEqual([]);
    expect(requests).toHaveLength(0);
  });

  it("passes the interview answers through to the checks", async () => {
    // The sell/share applicability is a business fact the code can't reveal, so
    // it fires only because the answer reached the checks via the analyze seam.
    const report = await analyze(
      minimalRepo,
      { ...UNANSWERED_INTERVIEW, sellsOrSharesData: true },
      notConfiguredLlmClient,
    );

    expect(
      report.findings.some(
        (f) => f.id === "sell-share-ccpa" && f.determination === "you-told-us",
      ),
    ).toBe(true);
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
