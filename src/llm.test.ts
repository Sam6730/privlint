import { describe, expect, it } from "vitest";
import {
  createOpenAiClient,
  notConfiguredLlmClient,
  resolveLlmClient,
} from "./llm.js";

/**
 * A recording fake for `fetch`: no real network is touched. It captures the
 * call and returns a canned OpenAI-style chat-completions body.
 */
function fakeFetch(content: string): {
  fetch: typeof fetch;
  calls: { url: string; init: RequestInit | undefined }[];
} {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetchImpl = (async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(
      JSON.stringify({ choices: [{ message: { content } }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
  return { fetch: fetchImpl, calls };
}

describe("createOpenAiClient", () => {
  it("posts the prompt to the configured endpoint and returns the reply", async () => {
    const { fetch, calls } = fakeFetch("the model reply");
    const client = createOpenAiClient(
      { baseUrl: "https://api.example.com/v1", model: "gpt-test", apiKey: "sk-123" },
      fetch,
    );

    expect(client.available).toBe(true);

    const reply = await client.complete({ prompt: "hello summary" });
    expect(reply).toBe("the model reply");

    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    // Base URL + the standard chat-completions path, without doubling the slash.
    expect(call.url).toBe("https://api.example.com/v1/chat/completions");

    const headers = new Headers(call.init?.headers);
    expect(headers.get("authorization")).toBe("Bearer sk-123");
    expect(headers.get("content-type")).toBe("application/json");

    const body = JSON.parse(String(call.init?.body));
    expect(body.model).toBe("gpt-test");
    // The prompt travels as a single user message.
    expect(body.messages).toEqual([{ role: "user", content: "hello summary" }]);
  });

  it("omits the Authorization header when no key is set (local models)", async () => {
    const { fetch, calls } = fakeFetch("ok");
    const client = createOpenAiClient(
      { baseUrl: "http://localhost:11434/v1", model: "llama3" },
      fetch,
    );

    await client.complete({ prompt: "hi" });

    const headers = new Headers(calls[0]!.init?.headers);
    expect(headers.has("authorization")).toBe(false);
  });

  it("throws a clear error when the endpoint returns a non-OK status", async () => {
    const fetchImpl = (async () =>
      new Response("nope", { status: 401 })) as typeof fetch;
    const client = createOpenAiClient(
      { baseUrl: "https://api.example.com/v1", model: "m", apiKey: "bad" },
      fetchImpl,
    );

    await expect(client.complete({ prompt: "x" })).rejects.toThrow(/401/);
  });
});

describe("resolveLlmClient", () => {
  it("builds a real client when base URL and model are configured", () => {
    const client = resolveLlmClient({
      PRIVLINT_LLM_BASE_URL: "https://api.example.com/v1",
      PRIVLINT_LLM_MODEL: "gpt-test",
      PRIVLINT_LLM_API_KEY: "sk-123",
    });

    expect(client.available).toBe(true);
  });

  it("falls back to the not-configured client when config is incomplete", () => {
    // Base URL without a model isn't enough to talk to a provider.
    const client = resolveLlmClient({
      PRIVLINT_LLM_BASE_URL: "https://api.example.com/v1",
    });

    expect(client).toBe(notConfiguredLlmClient);
    expect(client.available).toBe(false);
  });

  it("is not configured when the environment is empty", () => {
    expect(resolveLlmClient({})).toBe(notConfiguredLlmClient);
  });
});
