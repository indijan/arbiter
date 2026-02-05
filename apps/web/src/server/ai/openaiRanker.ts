import "server-only";

import { buildFeatureBundle } from "@/server/ai/opportunityScoring";

const OPENAI_MODEL = "gpt-4.1-mini";
const TIMEOUT_MS = 8000;

type LlmScoreResult = {
  score: number | null;
  raw: string;
};

function withTimeout<T>(promise: Promise<T>, ms: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  return {
    signal: controller.signal,
    done: promise.finally(() => clearTimeout(timeout))
  };
}

function extractScore(text: string) {
  const match = text.match(/-?\d+(\.\d+)?/);
  if (!match) {
    return null;
  }
  const value = Number(match[0]);
  return Number.isFinite(value) ? value : null;
}

export async function scoreWithOpenAI(input: {
  type: string;
  net_edge_bps: number | null;
  confidence: number | null;
  details: Record<string, unknown> | null;
}): Promise<LlmScoreResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { score: null, raw: "missing_api_key" };
  }

  const features = buildFeatureBundle(input);
  const prompt = {
    objective: "Rank opportunity for max profit with low drawdown risk.",
    instructions:
      "Return a single numeric score where higher is better. Use features only. Do not explain.",
    features: features.meta
  };

  const payload = {
    model: OPENAI_MODEL,
    messages: [
      {
        role: "system",
        content: "You are a quantitative trading ranking assistant."
      },
      {
        role: "user",
        content: JSON.stringify(prompt)
      }
    ],
    temperature: 0.2,
    max_tokens: 20
  };

  const { signal, done } = withTimeout(
    fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    }),
    TIMEOUT_MS
  );

  const response = await done;
  if (!response.ok) {
    return { score: null, raw: `http_${response.status}` };
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content ?? "";
  const score = extractScore(content);

  return { score, raw: content || "empty" };
}
