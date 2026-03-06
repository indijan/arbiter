import "server-only";

import { normalizePolicyConfig, type StrategyPolicyConfig } from "@/server/policy/config";

type PolicySummary = {
  opensShort: number;
  closedShort: number;
  pnlShort: number;
  expectancyShort: number;
  opensLong: number;
  closedLong: number;
  pnlLong: number;
  expectancyLong: number;
};

function extractJsonObject(raw: string) {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function proposePolicyWithAI(input: {
  current: StrategyPolicyConfig;
  summary: PolicySummary;
  typeExpectancy: Record<string, number>;
}): Promise<{ proposal: StrategyPolicyConfig | null; raw: string; model: string; used: boolean }> {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_POLICY_MODEL ?? "gpt-5-mini";

  if (!apiKey) {
    return { proposal: null, raw: "missing_api_key", model, used: false };
  }

  const prompt = {
    objective:
      "Tune trading policy to maximize positive expected PnL while preserving risk controls. Prefer small, conservative adjustments.",
    constraints: {
      change_style: "small_changes_only",
      do_not_remove_guardrails: true,
      prioritize_positive_expectancy: true,
      increase_opens_if_short_window_starved: true
    },
    input
  };

  const payload = {
    model,
    messages: [
      {
        role: "system",
        content:
          "Return only strict JSON object with key `config` containing policy fields to set. No prose."
      },
      {
        role: "user",
        content: JSON.stringify(prompt)
      }
    ],
    temperature: 0.1,
    max_tokens: 500
  };

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    return { proposal: null, raw: `http_${response.status}`, model, used: true };
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content ?? "";
  const parsed = extractJsonObject(content);
  if (!parsed || typeof parsed !== "object") {
    return { proposal: null, raw: content || "invalid_json", model, used: true };
  }

  const cfg = (parsed.config ?? parsed) as Partial<StrategyPolicyConfig>;
  const proposal = normalizePolicyConfig(cfg);

  return { proposal, raw: content || "ok", model, used: true };
}
