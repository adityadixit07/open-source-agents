/**
 * Minimal, dependency-free LLM provider abstraction used by the optional
 * planner and failure-diagnosis modules. Deterministic test execution
 * (src/runner, src/assertions, src/security) never imports this module -
 * those paths work with zero API keys and zero network calls to a model.
 */
export interface LLMProvider {
  complete(prompt: string): Promise<string>;
}

export class AnthropicProvider implements LLMProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model: string = "claude-sonnet-5-5",
  ) {}

  async complete(prompt: string): Promise<string> {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 2000,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) {
      throw new Error(`Anthropic API error ${res.status}: ${await res.text()}`);
    }

    const data = (await res.json()) as { content?: Array<{ text?: string }> };
    const text = data.content?.[0]?.text;
    if (typeof text !== "string") {
      throw new Error("Unexpected response shape from the Anthropic API");
    }
    return text;
  }
}

export function isPlannerConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export function getDefaultProvider(): LLMProvider {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. AI planning/diagnosis is optional - deterministic test execution does not need it.",
    );
  }
  return new AnthropicProvider(apiKey, process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5");
}

/** Strips a ```json ... ``` fence if the model wrapped its JSON output in one. */
export function extractJsonBlock(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fenceMatch ? fenceMatch[1].trim() : trimmed;
}
