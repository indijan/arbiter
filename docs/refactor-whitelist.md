# Arbiter v2 Refactor Whitelist (Phase 1)

Cél: watcher-first, egyetlen cron pipeline, minimális runtime felület.

## Keep (kötelező)

### Core app shell
- apps/web/src/app/layout.tsx
- apps/web/src/app/globals.css
- apps/web/src/app/page.tsx
- apps/web/src/app/dashboard/page.tsx
- apps/web/src/components/TopNav.tsx

### Auth (amíg Supabase auth marad)
- apps/web/src/app/(auth)/login/page.tsx
- apps/web/src/app/auth/sign-in/route.ts
- apps/web/src/app/auth/sign-up/route.ts
- apps/web/src/app/auth/sign-out/route.ts
- apps/web/src/app/auth/callback/route.ts
- apps/web/src/lib/supabase/server.ts
- apps/web/src/lib/supabase/server-admin.ts
- apps/web/src/lib/supabase/client.ts
- apps/web/src/lib/supabase/env.ts
- apps/web/src/middleware.ts

### Single cron pipeline
- apps/web/vercel.json
- apps/web/src/app/api/cron/tick/route.ts
- apps/web/src/server/cron/auth.ts
- apps/web/src/server/engine/types.ts
- apps/web/src/server/engine/pipeline/model.ts
- apps/web/src/server/engine/pipeline/ingest.ts
- apps/web/src/server/engine/pipeline/validate.ts
- apps/web/src/server/engine/pipeline/strategies.ts
- apps/web/src/server/engine/pipeline/evaluate.ts
- apps/web/src/server/engine/pipeline/watchlist.ts
- apps/web/src/server/engine/pipeline/store.ts

### Strategy + ingest jobs actually used by pipeline
- apps/web/src/server/jobs/ingestBinance.ts
- apps/web/src/server/jobs/ingestKraken.ts
- apps/web/src/server/jobs/detectCarry.ts
- apps/web/src/server/jobs/detectCrossExchangeSpot.ts
- apps/web/src/server/jobs/detectTriangular.ts
- apps/web/src/lib/strategy/spotPerpCarry.ts
- apps/web/src/server/hotdb/sqlite.ts

### Reporting
- apps/web/src/app/api/report/export/route.ts

### Future execution placeholder
- apps/web/src/server/engine/execution/executeOpportunity.ts

### Build/runtime config
- apps/web/package.json
- apps/web/tsconfig.json
- apps/web/next.config.mjs
- apps/web/next-env.d.ts
- apps/web/postcss.config.cjs
- apps/web/tailwind.config.ts
- package.json
- pnpm-lock.yaml
- pnpm-workspace.yaml

## Drop Candidates (Phase 2, ellenőrzés után)

### Legacy UI pages
- apps/web/src/app/ops/page.tsx
- apps/web/src/app/profit/page.tsx
- apps/web/src/app/server/page.tsx
- apps/web/src/app/settings/page.tsx
- apps/web/src/app/simple/page.tsx
- apps/web/src/app/error.tsx

### Legacy API surface (nem kell watcher-first MVP-hez)
- apps/web/src/app/api/ai/**
- apps/web/src/app/api/candidate-policies/**
- apps/web/src/app/api/cron/backcheck/**
- apps/web/src/app/api/cron/close/**
- apps/web/src/app/api/cron/detect/**
- apps/web/src/app/api/cron/execute/**
- apps/web/src/app/api/cron/ingest/**
- apps/web/src/app/api/cron/lane-policy/**
- apps/web/src/app/api/cron/news/**
- apps/web/src/app/api/detect/**
- apps/web/src/app/api/execute/**
- apps/web/src/app/api/ingest/**
- apps/web/src/app/api/internal/**
- apps/web/src/app/api/lane-policy/**
- apps/web/src/app/api/server/**
- apps/web/src/app/api/settings/**

### Legacy components
- apps/web/src/components/ApplyLanePolicyButton.tsx
- apps/web/src/components/CandidatePolicyActionButton.tsx
- apps/web/src/components/CandidatePolicyStatusButton.tsx
- apps/web/src/components/CloseAllButton.tsx
- apps/web/src/components/ClosePositionButton.tsx
- apps/web/src/components/DetectButton.tsx
- apps/web/src/components/DetectSummaryPanel.tsx
- apps/web/src/components/DevTickButton.tsx
- apps/web/src/components/ExecuteButton.tsx
- apps/web/src/components/IngestButton.tsx
- apps/web/src/components/LoginForm.tsx
- apps/web/src/components/LogoutButton.tsx
- apps/web/src/components/PaperSettingsPanel.tsx
- apps/web/src/components/PolicyControllerPanel.tsx
- apps/web/src/components/ProfitCharts.tsx
- apps/web/src/components/SessionRedirect.tsx
- apps/web/src/components/SettingsPanel.tsx

### Legacy engine/policy/lanes/orchestration
- apps/web/src/server/engine/orchestrator/**
- apps/web/src/server/engine/strategies/**
- apps/web/src/server/engine/evaluator/**
- apps/web/src/server/lanes/**
- apps/web/src/server/policy/**
- apps/web/src/server/serverCockpit/**
- apps/web/src/server/ops/**
- apps/web/src/server/ai/**

### Legacy jobs not used by v2 pipeline
- apps/web/src/server/jobs/autoClosePaper.ts
- apps/web/src/server/jobs/autoExecutePaper.ts
- apps/web/src/server/jobs/computeDailyPnl.ts
- apps/web/src/server/jobs/detectRelativeStrength.ts
- apps/web/src/server/jobs/detectSpreadReversion.ts
- apps/web/src/server/jobs/ingestBinanceSpot.ts
- apps/web/src/server/jobs/ingestCoinbase.ts
- apps/web/src/server/jobs/newsShadow.ts
- apps/web/src/server/jobs/reviewLanePolicies.ts
- apps/web/src/server/jobs/runBackcheck.ts

### Scripts/fixtures/docs candidate prune
- apps/web/scripts/**
- apps/web/fixtures/**
- docs/* (kivéve: docs/refactor-whitelist.md)
- LOCAL_FIRST_REFACTOR.md
- DEPLOY_SERVER.md

## DB cleanup target (phase 3)

### Keep tables
- market_snapshots
- opportunities
- system_ticks
- opportunity_decisions (ha advanced/reasons nézet marad)

### Drop candidates (ha nincs többé használva)
- positions
- executions
- daily_strategy_pnl
- paper_accounts
- paper_account_settings
- strategy_settings
- exchange_settings
- strategy_policy_configs
- strategy_policy_proposals
- strategy_policy_rollouts
- strategy_policy_events
- lane_policy_reviews
- candidate_lane_policies
- backcheck_runs
- news_events
- news_reaction_snapshots
- ai_usage_daily

Megjegyzés: a DROP csak usage-ellenőrzés és backup után.
