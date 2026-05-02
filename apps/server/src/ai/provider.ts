export type Task = "embed" | "score_judge" | "summarize" | "digest";
export type ProviderName = "anthropic" | "openai" | "openrouter" | "ollama";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
}

export interface ChatResponse {
  text: string;
  inputTokens?: number;
  outputTokens?: number;
}

export interface EmbedRequest {
  model: string;
  input: string | string[];
}

export interface EmbedResponse {
  vectors: number[][];
}

export interface Provider {
  name: ProviderName;
  chat(req: ChatRequest): Promise<ChatResponse>;
  embed(req: EmbedRequest): Promise<EmbedResponse>;
}
