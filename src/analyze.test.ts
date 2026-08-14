import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyze } from "./analyze.js";
import { UNANSWERED_INTERVIEW } from "./types.js";
import type { LlmClient } from "./types.js";

const minimalRepo = fileURLToPath(
  new URL("../test/fixtures/minimal", import.meta.url),
);

// A fake LLM client: analyze must not call it while no judgment checks are wired.
const failingLlmClient: LlmClient = {
  async complete() {
    throw new Error("LLM client should not be called yet");
  },
};

describe("analyze", () => {
  it("reports no findings when no checks are wired", async () => {
    const report = await analyze(
      minimalRepo,
      UNANSWERED_INTERVIEW,
      failingLlmClient,
    );

    expect(report.findings).toEqual([]);
    expect(report.repoPath).toBe(minimalRepo);
  });

  it("does not call the LLM client at this stage", async () => {
    // failingLlmClient throws if touched; a clean resolve proves it wasn't called.
    await expect(
      analyze(minimalRepo, UNANSWERED_INTERVIEW, failingLlmClient),
    ).resolves.toBeDefined();
  });

  it("rejects when the repo path does not exist", async () => {
    await expect(
      analyze(
        minimalRepo + "-does-not-exist",
        UNANSWERED_INTERVIEW,
        failingLlmClient,
      ),
    ).rejects.toThrow();
  });
});
