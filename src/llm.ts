import type { LlmClient } from "./types.js";

/**
 * A placeholder LLM client used until a real provider is wired in. Judgment
 * checks don't exist yet, so nothing should call it; if something does, it
 * fails loudly rather than silently pretending to reason.
 */
export const notConfiguredLlmClient: LlmClient = {
  async complete(): Promise<string> {
    throw new Error(
      "No model provider is configured. Judgment checks are not available yet.",
    );
  },
};
