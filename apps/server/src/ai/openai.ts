import type { Provider, ChatRequest, ChatResponse, EmbedRequest, EmbedResponse, ProviderName } from "./provider.ts";

export function makeOpenAICompatible(opts: {
  name: ProviderName;
  apiKey: string;
  baseURL: string;
}): Provider {
  const { name, apiKey, baseURL } = opts;

  async function post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${baseURL}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${name} ${path} ${res.status}: ${text.slice(0, 500)}`);
    }
    return (await res.json()) as T;
  }

  return {
    name,

    async chat(req: ChatRequest): Promise<ChatResponse> {
      type R = {
        choices: { message: { content: string } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const r = await post<R>("/chat/completions", {
        model: req.model,
        messages: req.messages,
        max_tokens: req.maxTokens,
        temperature: req.temperature,
      });
      return {
        text: r.choices[0]?.message.content ?? "",
        inputTokens: r.usage?.prompt_tokens,
        outputTokens: r.usage?.completion_tokens,
      };
    },

    async embed(req: EmbedRequest): Promise<EmbedResponse> {
      type R = { data: { embedding: number[] }[] };
      const inputs = Array.isArray(req.input) ? req.input : [req.input];
      const r = await post<R>("/embeddings", { model: req.model, input: inputs });
      return { vectors: r.data.map((d) => d.embedding) };
    },
  };
}

export const makeOpenAI = (apiKey: string) =>
  makeOpenAICompatible({ name: "openai", apiKey, baseURL: "https://api.openai.com/v1" });

export const makeOpenRouter = (apiKey: string) =>
  makeOpenAICompatible({ name: "openrouter", apiKey, baseURL: "https://openrouter.ai/api/v1" });
