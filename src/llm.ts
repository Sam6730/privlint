/**
 * The injected model client for the Reason stage.
 *
 * Bring-your-own-key against any OpenAI-compatible endpoint (base URL + model +
 * optional key), so the same code path points at a hosted API or a fully local
 * model (Ollama/LM Studio) with no bespoke integration. Nothing is persisted:
 * the client only forwards a prompt and returns the reply.
 */
import type { LlmClient, LlmCompletionRequest } from "./types.js";

/**
 * A placeholder client used when no provider is configured. It reports
 * `available: false` so the Reason stage skips it cleanly; if something calls
 * it anyway, it fails loudly rather than silently pretending to reason.
 */
export const notConfiguredLlmClient: LlmClient = {
  available: false,
  async complete(): Promise<string> {
    throw new Error(
      "No model provider is configured. Set a base URL and model (flags or " +
        "PRIVLINT_LLM_* env) to enable the judgment checks.",
    );
  },
};

/** Connection details for an OpenAI-compatible endpoint. */
export interface OpenAiClientConfig {
  /** The API base URL, e.g. "https://api.openai.com/v1" or a local endpoint. */
  baseUrl: string;
  /** The model id to request, e.g. "gpt-4o-mini" or "llama3". */
  model: string;
  /** Bearer token. Optional: local models generally need none. */
  apiKey?: string;
}

/**
 * Build a client that talks to an OpenAI-compatible `/chat/completions`
 * endpoint. `fetchImpl` is injectable so tests exercise the request/response
 * mapping with no network; production passes the global `fetch`.
 */
export function createOpenAiClient(
  config: OpenAiClientConfig,
  fetchImpl: typeof fetch = fetch,
): LlmClient {
  const endpoint = `${config.baseUrl.replace(/\/$/, "")}/chat/completions`;

  return {
    available: true,
    async complete(request: LlmCompletionRequest): Promise<string> {
      const headers: Record<string, string> = {
        "content-type": "application/json",
      };
      if (config.apiKey) headers.authorization = `Bearer ${config.apiKey}`;

      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: config.model,
          // Deterministic reasoning: temperature 0 so a given summary reasons
          // the same way run to run.
          temperature: 0,
          messages: [{ role: "user", content: request.prompt }],
        }),
      });

      if (!response.ok) {
        throw new Error(
          `Model provider returned ${response.status} ${response.statusText}`.trim(),
        );
      }

      const data = (await response.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const content = data.choices?.[0]?.message?.content;
      if (typeof content !== "string") {
        throw new Error("Model provider returned no message content.");
      }
      return content;
    },
  };
}

/** The environment variables that configure the model provider. */
export interface LlmEnv {
  PRIVLINT_LLM_BASE_URL?: string;
  PRIVLINT_LLM_MODEL?: string;
  PRIVLINT_LLM_API_KEY?: string;
}

/**
 * Resolve a client from configuration: a real OpenAI-compatible client when a
 * base URL and model are both set, otherwise {@link notConfiguredLlmClient} so
 * a run without a provider still produces the deterministic findings.
 */
export function resolveLlmClient(
  env: LlmEnv,
  fetchImpl: typeof fetch = fetch,
): LlmClient {
  const baseUrl = env.PRIVLINT_LLM_BASE_URL?.trim();
  const model = env.PRIVLINT_LLM_MODEL?.trim();
  if (!baseUrl || !model) return notConfiguredLlmClient;

  return createOpenAiClient(
    { baseUrl, model, apiKey: env.PRIVLINT_LLM_API_KEY?.trim() || undefined },
    fetchImpl,
  );
}
