import Anthropic from "@anthropic-ai/sdk";
import type { Provider, ChatRequest, ChatResponse, EmbedRequest, EmbedResponse } from "./provider.ts";

export function makeAnthropic(apiKey: string, baseURL?: string | null): Provider {
  const client = new Anthropic({ apiKey, baseURL: baseURL ?? undefined });

  return {
    name: "anthropic",

    async chat(req: ChatRequest): Promise<ChatResponse> {
      const system = req.messages.find((m) => m.role === "system")?.content;
      const messages = req.messages
        .filter((m) => m.role !== "system")
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

      const res = await client.messages.create({
        model: req.model,
        max_tokens: req.maxTokens ?? 1024,
        temperature: req.temperature,
        system,
        messages,
      });

      const text = res.content
        .filter((b) => b.type === "text")
        .map((b) => (b as { text: string }).text)
        .join("");

      return {
        text,
        inputTokens: res.usage?.input_tokens,
        outputTokens: res.usage?.output_tokens,
      };
    },

    async embed(_req: EmbedRequest): Promise<EmbedResponse> {
      throw new Error(
        "Anthropic does not provide a public embeddings endpoint. Configure embeddings via OpenAI, OpenRouter, or Ollama."
      );
    },
  };
}
