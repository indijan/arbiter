import "server-only";

import { createAdminSupabase } from "@/lib/supabase/server-admin";

type FeedConfig = {
  source: string;
  url: string;
};

type ParsedItem = {
  source: string;
  url: string;
  title: string;
  publishedAt: string;
  summary: string;
  content: string;
};

type Classification = {
  summary: string;
  affected_assets: string[];
  event_type: string;
  sentiment: "positive" | "negative" | "mixed" | "neutral";
  action_bias: "risk_on" | "risk_off" | "btc_bullish" | "btc_bearish" | "alt_bullish" | "alt_bearish" | "mixed" | "neutral";
  impact_horizon: "minutes" | "hours" | "days";
  confidence: number;
  novelty_score: number;
  risk_gate: boolean;
  risk_gate_reason: string;
  risk_gate_hours: number;
};

export type IngestCryptoNewsResult = {
  feeds_checked: number;
  fetched_items: number;
  inserted: number;
  classified: number;
  gated: number;
  skipped_existing: number;
  errors: string[];
};

export type RecordNewsReactionsResult = {
  events_considered: number;
  inserted: number;
  skipped: number;
  errors: string[];
};

const DEFAULT_FEEDS: FeedConfig[] = [];
const DEFAULT_ASSETS = ["BTCUSD", "ETHUSD", "XRPUSD"];
const REACTION_HORIZONS_MINUTES = [15, 60, 240, 1440];
const REACTION_EXCHANGE = "coinbase";

function decodeXml(text: string) {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripTags(text: string) {
  return decodeXml(text).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function firstTagValue(block: string, tags: string[]) {
  for (const tag of tags) {
    const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
    if (match?.[1]) return stripTags(match[1]);
    const selfClosing = block.match(new RegExp(`<${tag}[^>]*href=["']([^"']+)["'][^>]*/?>`, "i"));
    if (selfClosing?.[1]) return selfClosing[1].trim();
  }
  return "";
}

function parseFeedItems(xml: string, source: string) {
  const normalized = xml.replace(/\r/g, "");
  const itemBlocks = normalized.match(/<item[\s\S]*?<\/item>/gi) ?? [];
  const entryBlocks = normalized.match(/<entry[\s\S]*?<\/entry>/gi) ?? [];
  const blocks = itemBlocks.length > 0 ? itemBlocks : entryBlocks;

  return blocks
    .map<ParsedItem | null>((block) => {
      const title = firstTagValue(block, ["title"]);
      const url =
        firstTagValue(block, ["link"]) ||
        (block.match(/<guid[^>]*>([\s\S]*?)<\/guid>/i)?.[1] ? stripTags(block.match(/<guid[^>]*>([\s\S]*?)<\/guid>/i)?.[1] ?? "") : "");
      const publishedRaw = firstTagValue(block, ["pubDate", "published", "updated"]);
      const summary = firstTagValue(block, ["description", "summary"]);
      const content = firstTagValue(block, ["content", "content:encoded", "description"]);
      const publishedAt = publishedRaw ? new Date(publishedRaw).toISOString() : new Date().toISOString();
      if (!title || !url) return null;
      return {
        source,
        url,
        title,
        publishedAt,
        summary,
        content
      };
    })
    .filter((item): item is ParsedItem => item !== null);
}

function parseFeedConfig(): FeedConfig[] {
  const raw = process.env.NEWS_FEEDS_JSON;
  if (!raw) return DEFAULT_FEEDS;
  try {
    const parsed = JSON.parse(raw) as FeedConfig[];
    return Array.isArray(parsed)
      ? parsed.filter((row) => row && typeof row.source === "string" && typeof row.url === "string")
      : DEFAULT_FEEDS;
  } catch {
    return DEFAULT_FEEDS;
  }
}

function normalizeAssets(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || "").trim().toUpperCase())
    .filter(Boolean)
    .map((asset) => (asset.endsWith("USD") ? asset : `${asset}USD`));
}

function coerceClassification(input: Partial<Classification>): Classification {
  const confidence = Number(input.confidence ?? 0);
  const novelty = Number(input.novelty_score ?? 0);
  const gateHours = Math.max(0, Math.round(Number(input.risk_gate_hours ?? 0)));
  return {
    summary: String(input.summary ?? "").trim(),
    affected_assets: normalizeAssets(input.affected_assets),
    event_type: String(input.event_type ?? "unknown"),
    sentiment: (["positive", "negative", "mixed", "neutral"].includes(String(input.sentiment)) ? input.sentiment : "neutral") as Classification["sentiment"],
    action_bias: ([
      "risk_on",
      "risk_off",
      "btc_bullish",
      "btc_bearish",
      "alt_bullish",
      "alt_bearish",
      "mixed",
      "neutral"
    ].includes(String(input.action_bias))
      ? input.action_bias
      : "neutral") as Classification["action_bias"],
    impact_horizon: (["minutes", "hours", "days"].includes(String(input.impact_horizon))
      ? input.impact_horizon
      : "hours") as Classification["impact_horizon"],
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0,
    novelty_score: Number.isFinite(novelty) ? Math.max(0, Math.min(1, novelty)) : 0,
    risk_gate: Boolean(input.risk_gate),
    risk_gate_reason: String(input.risk_gate_reason ?? "").trim(),
    risk_gate_hours: gateHours
  };
}

async function classifyNewsItem(item: ParsedItem) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_NEWS_MODEL ?? "gpt-4o-mini";

  if (!apiKey) {
    return { used: false, model, classification: null as Classification | null, raw: "missing_api_key" };
  }

  const prompt = {
    objective:
      "Classify crypto-market-moving news for an observe-only trading overlay. Focus on risk gating and regime annotation, not direct trade advice.",
    article: {
      source: item.source,
      title: item.title,
      url: item.url,
      published_at: item.publishedAt,
      summary: item.summary,
      content: item.content.slice(0, 4000)
    },
    schema: {
      summary: "short string",
      affected_assets: ["BTC", "ETH", "XRP"],
      event_type:
        "macro_regulatory_positive|macro_regulatory_negative|exchange_incident|security_breach|etf_flow_positive|etf_flow_negative|treasury_adoption|halving_cycle|mining_disruption|stablecoin_risk|protocol_upgrade|liquidity_shock|unknown",
      sentiment: "positive|negative|mixed|neutral",
      action_bias: "risk_on|risk_off|btc_bullish|btc_bearish|alt_bullish|alt_bearish|mixed|neutral",
      impact_horizon: "minutes|hours|days",
      confidence: "0..1",
      novelty_score: "0..1",
      risk_gate: "boolean",
      risk_gate_reason: "short string",
      risk_gate_hours: "integer"
    }
  };

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content: "Return only strict JSON. No prose."
        },
        {
          role: "user",
          content: JSON.stringify(prompt)
        }
      ],
      temperature: 0.1,
      max_tokens: 500
    })
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    return {
      used: true,
      model,
      classification: null as Classification | null,
      raw: `http_${response.status}${errorText ? `: ${errorText.slice(0, 500)}` : ""}`
    };
  }

  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content ?? "";
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return { used: true, model, classification: null as Classification | null, raw: content || "invalid_json" };
  }
  try {
    const parsed = JSON.parse(content.slice(start, end + 1)) as Partial<Classification>;
    return {
      used: true,
      model,
      classification: coerceClassification(parsed),
      raw: content
    };
  } catch {
    return { used: true, model, classification: null as Classification | null, raw: content || "invalid_json" };
  }
}

async function updateExistingPendingClassification(
  adminSupabase: NonNullable<ReturnType<typeof createAdminSupabase>>,
  existingId: number,
  item: ParsedItem
) {
  const classificationResult = await classifyNewsItem(item);
  const classification = classificationResult.classification;
  const payload = {
    affected_assets: classification?.affected_assets ?? [],
    event_type: classification?.event_type ?? null,
    sentiment: classification?.sentiment ?? null,
    action_bias: classification?.action_bias ?? null,
    impact_horizon: classification?.impact_horizon ?? null,
    confidence: classification?.confidence ?? null,
    novelty_score: classification?.novelty_score ?? null,
    risk_gate: classification?.risk_gate ?? false,
    risk_gate_reason: classification?.risk_gate_reason ?? null,
    risk_gate_hours: classification?.risk_gate_hours ?? null,
    classification_status: classification ? "classified" : "pending",
    classification_model: classificationResult.used ? classificationResult.model : null,
    classification_json: classification ? classification : { raw: classificationResult.raw },
    classified_at: classification ? new Date().toISOString() : null
  };
  const { error } = await adminSupabase.from("news_events").update(payload).eq("id", existingId);
  if (error) throw new Error(error.message);
  return { classified: Boolean(classification), gated: Boolean(classification?.risk_gate) };
}

export async function ingestCryptoNews(): Promise<IngestCryptoNewsResult> {
  const adminSupabase = createAdminSupabase();
  if (!adminSupabase) throw new Error("Missing service role key.");

  const feeds = parseFeedConfig();
  if (feeds.length === 0) {
    return { feeds_checked: 0, fetched_items: 0, inserted: 0, classified: 0, gated: 0, skipped_existing: 0, errors: [] };
  }

  let fetchedItems = 0;
  let inserted = 0;
  let classified = 0;
  let gated = 0;
  let skippedExisting = 0;
  const errors: string[] = [];

  for (const feed of feeds) {
    try {
      const response = await fetch(feed.url, { headers: { "user-agent": "arbiter-news-bot/1.0" }, cache: "no-store" });
      if (!response.ok) {
        errors.push(`${feed.source}: http_${response.status}`);
        continue;
      }
      const xml = await response.text();
      const items = parseFeedItems(xml, feed.source).slice(0, 10);
      fetchedItems += items.length;

      for (const item of items) {
        const { data: existing, error: existingError } = await adminSupabase
          .from("news_events")
          .select("id, classification_status")
          .eq("url", item.url)
          .maybeSingle();
        if (existingError) throw new Error(existingError.message);
        if (existing) {
          if (existing.classification_status === "pending") {
            const retried = await updateExistingPendingClassification(adminSupabase, existing.id, item);
            if (retried.classified) classified += 1;
            if (retried.gated) gated += 1;
          }
          skippedExisting += 1;
          continue;
        }

        const classificationResult = await classifyNewsItem(item);
        const classification = classificationResult.classification;
        if (classification) {
          classified += 1;
          if (classification.risk_gate) gated += 1;
        }

        const { error: insertError } = await adminSupabase.from("news_events").insert({
          source: item.source,
          url: item.url,
          title: item.title,
          published_at: item.publishedAt,
          raw_summary: item.summary,
          raw_content: item.content,
          affected_assets: classification?.affected_assets ?? [],
          event_type: classification?.event_type ?? null,
          sentiment: classification?.sentiment ?? null,
          action_bias: classification?.action_bias ?? null,
          impact_horizon: classification?.impact_horizon ?? null,
          confidence: classification?.confidence ?? null,
          novelty_score: classification?.novelty_score ?? null,
          risk_gate: classification?.risk_gate ?? false,
          risk_gate_reason: classification?.risk_gate_reason ?? null,
          risk_gate_hours: classification?.risk_gate_hours ?? null,
          classification_status: classification ? "classified" : "pending",
          classification_model: classificationResult.used ? classificationResult.model : null,
          classification_json: classification ? classification : { raw: classificationResult.raw },
          classified_at: classification ? new Date().toISOString() : null
        });
        if (insertError) throw new Error(insertError.message);
        inserted += 1;
      }
    } catch (error) {
      errors.push(`${feed.source}: ${error instanceof Error ? error.message : "unknown_error"}`);
    }
  }

  return {
    feeds_checked: feeds.length,
    fetched_items: fetchedItems,
    inserted,
    classified,
    gated,
    skipped_existing: skippedExisting,
    errors
  };
}

type PricePoint = {
  ts: string;
  mid: number;
};

async function fetchNearestMid(
  adminSupabase: NonNullable<ReturnType<typeof createAdminSupabase>>,
  symbol: string,
  targetIso: string
): Promise<PricePoint | null> {
  const { data, error } = await adminSupabase
    .from("market_snapshots")
    .select("ts, spot_bid, spot_ask")
    .eq("exchange", REACTION_EXCHANGE)
    .eq("symbol", symbol)
    .gte("ts", targetIso)
    .order("ts", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  const bid = Number(data?.spot_bid ?? 0);
  const ask = Number(data?.spot_ask ?? 0);
  if (!data?.ts || !(bid > 0) || !(ask > bid)) return null;
  return { ts: data.ts, mid: (bid + ask) / 2 };
}

export async function recordNewsReactions(): Promise<RecordNewsReactionsResult> {
  const adminSupabase = createAdminSupabase();
  if (!adminSupabase) throw new Error("Missing service role key.");

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: events, error } = await adminSupabase
    .from("news_events")
    .select("id, published_at, affected_assets, classification_status")
    .gte("published_at", since)
    .in("classification_status", ["classified", "pending"])
    .order("published_at", { ascending: false })
    .limit(30);
  if (error) throw new Error(error.message);

  let inserted = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const event of events ?? []) {
    const assets = normalizeAssets(event.affected_assets);
    const reactionAssets = assets.length > 0 ? Array.from(new Set(["BTCUSD", ...assets])) : DEFAULT_ASSETS;

    for (const asset of reactionAssets) {
      for (const horizonMinutes of REACTION_HORIZONS_MINUTES) {
        try {
          const { data: existing, error: existingError } = await adminSupabase
            .from("news_reaction_snapshots")
            .select("id")
            .eq("news_event_id", event.id)
            .eq("asset", asset)
            .eq("horizon_minutes", horizonMinutes)
            .eq("exchange", REACTION_EXCHANGE)
            .maybeSingle();
          if (existingError) throw new Error(existingError.message);
          if (existing) {
            skipped += 1;
            continue;
          }

          const start = await fetchNearestMid(adminSupabase, asset, event.published_at);
          const end = await fetchNearestMid(
            adminSupabase,
            asset,
            new Date(Date.parse(event.published_at) + horizonMinutes * 60 * 1000).toISOString()
          );
          const btcStart = asset === "BTCUSD" ? start : await fetchNearestMid(adminSupabase, "BTCUSD", event.published_at);
          const btcEnd =
            asset === "BTCUSD"
              ? end
              : await fetchNearestMid(
                  adminSupabase,
                  "BTCUSD",
                  new Date(Date.parse(event.published_at) + horizonMinutes * 60 * 1000).toISOString()
                );

          if (!start || !end) {
            skipped += 1;
            continue;
          }

          const assetChangeBps = ((end.mid - start.mid) / start.mid) * 10000;
          const btcChangeBps =
            btcStart && btcEnd ? ((btcEnd.mid - btcStart.mid) / btcStart.mid) * 10000 : null;

          const { error: insertError } = await adminSupabase.from("news_reaction_snapshots").insert({
            news_event_id: event.id,
            asset,
            horizon_minutes: horizonMinutes,
            exchange: REACTION_EXCHANGE,
            start_ts: start.ts,
            end_ts: end.ts,
            start_mid: start.mid,
            end_mid: end.mid,
            price_change_bps: Number(assetChangeBps.toFixed(4)),
            relative_to_btc_bps: btcChangeBps === null ? null : Number((assetChangeBps - btcChangeBps).toFixed(4))
          });
          if (insertError) throw new Error(insertError.message);
          inserted += 1;
        } catch (reactionError) {
          errors.push(
            `event_${event.id}_${asset}_${horizonMinutes}: ${
              reactionError instanceof Error ? reactionError.message : "unknown_error"
            }`
          );
        }
      }
    }
  }

  return {
    events_considered: (events ?? []).length,
    inserted,
    skipped,
    errors
  };
}
