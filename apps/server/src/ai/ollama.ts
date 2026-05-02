import type { Provider, ChatRequest, ChatResponse, EmbedRequest, EmbedResponse } from "./provider.ts";

export function makeOllama(baseURL = "http://localhost:11434"): Provider {
  async function post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${baseURL}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`ollama ${path} ${res.status}: ${await res.text()}`);
    }
    return (await res.json()) as T;
  }

  return {
    name: "ollama",

    async chat(req: ChatRequest): Promise<ChatResponse> {
      type R = { message: { content: string }; eval_count?: number; prompt_eval_count?: number };
      const r = await post<R>("/api/chat", {
        model: req.model,
        messages: req.messages,
        stream: false,
        options: { temperature: req.temperature, num_predict: req.maxTokens },
      });
      return {
        text: r.message.content,
        inputTokens: r.prompt_eval_count,
        outputTokens: r.eval_count,
      };
    },

    async embed(req: EmbedRequest): Promise<EmbedResponse> {
      type R = { embeddings: number[][] };
      const inputs = Array.isArray(req.input) ? req.input : [req.input];
      const r = await post<R>("/api/embed", { model: req.model, input: inputs });
      return { vectors: r.embeddings };
    },
  };
}
