# News Shadow

Observe-only news layer for the BTC-shadow strategy.

## Goal

Add a structured news factor without letting raw LLM sentiment open trades directly.

The first version is intentionally conservative:

1. ingest crypto-relevant headlines from configured feeds
2. classify them with OpenAI into event/risk categories
3. log post-news market reactions for BTC/ETH/XRP
4. expose summaries in `system_ticks`

No live trade blocking is enabled by default in this phase.

## Feed config

Set `NEWS_FEEDS_JSON` as a JSON array, for example:

```json
[
  { "source": "coindesk", "url": "https://www.coindesk.com/arc/outboundfeeds/rss/" },
  { "source": "coinbase_news", "url": "https://www.coinbase.com/blog/rss.xml" },
  { "source": "kraken_blog", "url": "https://blog.kraken.com/feed" }
]
```

If `NEWS_FEEDS_JSON` is missing, the job no-ops.

## OpenAI classification

Model env:

- `OPENAI_NEWS_MODEL`

The classifier extracts:

- `affected_assets`
- `event_type`
- `sentiment`
- `action_bias`
- `impact_horizon`
- `confidence`
- `novelty_score`
- `risk_gate`
- `risk_gate_reason`
- `risk_gate_hours`

## Stored tables

- `news_events`
- `news_reaction_snapshots`

## Reaction logging

Current horizons:

- `15m`
- `60m`
- `240m`
- `1440m`

Current exchange for reaction measurement:

- `coinbase`

Assets logged:

- always `BTCUSD`
- plus classified assets when available
- fallback observe set: `BTCUSD`, `ETHUSD`, `XRPUSD`

## Future integration

Once enough reaction history exists, this layer can drive a `news_risk_gate` for the shadow lane.

Examples:

- `exchange_incident` => block all new opens for `N` hours
- `security_breach` => block all new opens for `N` hours
- `macro_regulatory_negative` + BTC already selling off => tighten `ETH long`
- `macro_regulatory_positive` => tighten or disable `XRP short`
