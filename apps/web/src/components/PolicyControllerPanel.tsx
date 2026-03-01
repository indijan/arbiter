type ProposalRow = {
  id: string;
  created_at: string;
  model: string | null;
  decision: string;
  decision_reason: string | null;
};

type RolloutRow = {
  id: string;
  status: string;
  canary_ratio: number;
  start_ts: string;
  end_ts: string | null;
};

type EventRow = {
  id: number;
  ts: string;
  event_type: string;
  details?: Record<string, unknown> | null;
};

type RolloutPerformanceRow = {
  rollout_id: string;
  config_id: string | null;
  status: string;
  opens: number;
  closed: number;
  pnl_sum_usd: number;
  expectancy_usd: number;
  canary_opens: number;
  last_entry_ts: string | null;
};

type PolicyControllerPanelProps = {
  diagnostics: Record<string, unknown> | null;
  proposals: ProposalRow[];
  rollouts: RolloutRow[];
  events: EventRow[];
  performance: RolloutPerformanceRow[];
  error?: string | null;
};

function formatPct(value: number) {
  return `${(value * 100).toFixed(0)}%`;
}

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function statusTone(kind: "ok" | "warn" | "bad" | "neutral") {
  if (kind === "ok") return "border-emerald-400/30 bg-emerald-400/10 text-emerald-100";
  if (kind === "warn") return "border-amber-400/30 bg-amber-400/10 text-amber-100";
  if (kind === "bad") return "border-red-400/30 bg-red-400/10 text-red-100";
  return "border-brand-300/15 bg-brand-300/5 text-brand-100";
}

export default function PolicyControllerPanel({
  diagnostics,
  proposals,
  rollouts,
  events,
  performance,
  error
}: PolicyControllerPanelProps) {
  const blockedTypes = Array.isArray(diagnostics?.strategy_blocked_types)
    ? (diagnostics?.strategy_blocked_types as string[])
    : [];
  const rolloutStatus = String(diagnostics?.policy_rollout_status ?? "-");
  const isCanary = Boolean(diagnostics?.policy_is_canary ?? false);
  const controllerAction = String(diagnostics?.policy_controller_action ?? "-");
  const autoOpensShort = Number(diagnostics?.auto_opens_6h ?? 0);
  const autoPnlShort = Number(diagnostics?.auto_pnl_6h_usd ?? 0);
  const autoPnlLong = Number(diagnostics?.auto_pnl_30d_usd ?? 0);
  const latestControllerCycle = events.find((row) => row.event_type === "controller_cycle") ?? null;
  const recentPromotionHold = Boolean(latestControllerCycle?.details?.recent_promotion_hold ?? false);
  const latestPerf = performance[0] ?? null;

  const tradingHealth =
    autoOpensShort >= 2 && autoPnlShort > 0
      ? { label: "Stabilan fut", tone: "ok" as const, detail: "Van nyitás és a rövidtávú eredmény pozitív." }
      : autoOpensShort >= 1 && autoPnlShort >= 0
      ? { label: "Óvatosan jó", tone: "warn" as const, detail: "Működik, de a nyitások száma még alacsony." }
      : autoOpensShort >= 1
      ? { label: "Van aktivitás, de figyelni kell", tone: "warn" as const, detail: "Nyit, de a rövidtávú profit még nem meggyőző." }
      : { label: "Kevés aktivitás", tone: "bad" as const, detail: "A rendszer most túl kevés pozíciót nyit." };

  const rolloutHealth =
    recentPromotionHold
      ? { label: "Védett futás", tone: "ok" as const, detail: "A legutóbbi nyerő rollout most elsőbbséget élvez." }
      : isCanary
      ? { label: "Teszt üzem", tone: "warn" as const, detail: "Most új beállítást próbál a rendszer." }
      : rolloutStatus === "active"
      ? { label: "Éles beállítás", tone: "ok" as const, detail: "Az aktuális policy van élesben." }
      : { label: "Átmeneti állapot", tone: "neutral" as const, detail: "Nincs egyértelmű stabil rollout állapot." };

  const pnlHealth =
    autoPnlShort > 0 && autoPnlLong > 0
      ? { label: "Profit rendben", tone: "ok" as const }
      : autoPnlShort >= 0
      ? { label: "Profit semleges", tone: "warn" as const }
      : { label: "Profit romlott", tone: "bad" as const };

  const lastRolloutMessage = latestPerf
    ? latestPerf.opens === 0
      ? "Az utolsó rollout nem nyitott pozíciót."
      : latestPerf.pnl_sum_usd > 0
      ? "Az utolsó rollout eddig nyereséges."
      : latestPerf.pnl_sum_usd < 0
      ? "Az utolsó rollout nyitott, de veszteséges."
      : "Az utolsó rollout nyitott, de még semleges."
    : "Még nincs rollout teljesítmény adat.";

  return (
    <section className="card">
      <h2 className="text-xl font-semibold">Policy Controller</h2>
      <p className="mt-1 text-sm text-brand-100/70">
        Röviden: itt látod, hogy a stratégia most stabilan keres, tesztel, vagy túl kevés nyitást csinál.
      </p>

      {error ? (
        <p className="mt-3 text-sm text-red-200">{error}</p>
      ) : null}

      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        <div className={cx("rounded-xl border p-4", statusTone(tradingHealth.tone))}>
          <p className="text-xs uppercase tracking-[0.2em] opacity-80">Kereskedési állapot</p>
          <p className="mt-2 text-lg font-semibold">{tradingHealth.label}</p>
          <p className="mt-1 text-sm opacity-90">{tradingHealth.detail}</p>
        </div>
        <div className={cx("rounded-xl border p-4", statusTone(rolloutHealth.tone))}>
          <p className="text-xs uppercase tracking-[0.2em] opacity-80">Policy állapot</p>
          <p className="mt-2 text-lg font-semibold">{rolloutHealth.label}</p>
          <p className="mt-1 text-sm opacity-90">{rolloutHealth.detail}</p>
        </div>
        <div className={cx("rounded-xl border p-4", statusTone(pnlHealth.tone))}>
          <p className="text-xs uppercase tracking-[0.2em] opacity-80">Profit állapot</p>
          <p className="mt-2 text-lg font-semibold">{pnlHealth.label}</p>
          <p className="mt-1 text-sm opacity-90">{lastRolloutMessage}</p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-brand-300/15 p-3 text-sm">
          <p className="text-brand-100/60">Nyitások (rövid ablak)</p>
          <p className="mt-1 text-xl font-semibold">{autoOpensShort}</p>
        </div>
        <div className="rounded-xl border border-brand-300/15 p-3 text-sm">
          <p className="text-brand-100/60">Profit (rövid ablak)</p>
          <p className={cx("mt-1 text-xl font-semibold", autoPnlShort > 0 ? "text-emerald-200" : autoPnlShort < 0 ? "text-red-200" : "")}>
            {autoPnlShort.toFixed(4)} USD
          </p>
        </div>
        <div className="rounded-xl border border-brand-300/15 p-3 text-sm">
          <p className="text-brand-100/60">Profit (30 nap)</p>
          <p className={cx("mt-1 text-xl font-semibold", autoPnlLong > 0 ? "text-emerald-200" : autoPnlLong < 0 ? "text-red-200" : "")}>
            {autoPnlLong.toFixed(4)} USD
          </p>
        </div>
        <div className="rounded-xl border border-brand-300/15 p-3 text-sm">
          <p className="text-brand-100/60">Mit csinál most?</p>
          <p className="mt-1 font-medium">
            {controllerAction === "promotion_hold"
              ? "A nyerő beállítást futtatja"
              : controllerAction === "canary_collecting"
              ? "Új beállítást figyel"
              : controllerAction === "started_canary"
              ? "Új tesztet indított"
              : controllerAction === "evaluated_canary"
              ? "Tesztet értékelt"
              : controllerAction}
          </p>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-brand-300/15 bg-brand-300/5 p-4 text-sm">
        <p className="font-medium">Egyszerű összefoglaló</p>
        <p className="mt-2 text-brand-100/80">
          {recentPromotionHold
            ? "Most a legutóbb bevált beállítás kap időt. Ez jó, mert nem ugrál túl gyorsan a rendszer."
            : "Most nincs védett futási idő, ezért a rendszer aktívabban kereshet új beállítást."}
        </p>
        <p className="mt-1 text-brand-100/80">
          {blockedTypes.length > 0
            ? `Jelenleg visszafogott stratégiák: ${blockedTypes.join(", ")}.`
            : "Jelenleg nincs letiltott stratégia-típus."}
        </p>
        <p className="mt-1 text-brand-100/80">
          {isCanary
            ? "A mostani futás teszt jellegű (canary)."
            : "A mostani futás az éles, aktív beállítást használja."}
        </p>
      </div>

      <div className="mt-5 grid gap-6 lg:grid-cols-4">
        <div>
          <h3 className="text-sm font-semibold text-brand-100/80">Utóbbi rolloutok eredménye</h3>
          <div className="mt-2 space-y-2 text-xs">
            {performance.map((row) => (
              <div
                key={row.rollout_id}
                className={cx(
                  "rounded-lg border p-2",
                  row.opens === 0 ? statusTone("bad") : row.pnl_sum_usd > 0 ? statusTone("ok") : row.pnl_sum_usd < 0 ? statusTone("warn") : statusTone("neutral")
                )}
              >
                <p className="font-medium">
                  {row.opens === 0
                    ? "Nem nyitott"
                    : row.pnl_sum_usd > 0
                    ? "Nyerő rollout"
                    : row.pnl_sum_usd < 0
                    ? "Vesztes rollout"
                    : "Semleges rollout"}
                </p>
                <p className="mt-1 opacity-90">Nyitás: {row.opens} | Zárás: {row.closed}</p>
                <p className="opacity-90">
                  Profit: {row.pnl_sum_usd.toFixed(4)} | Átlag: {row.expectancy_usd.toFixed(4)}
                </p>
                <p className="opacity-90">Canary nyitás: {row.canary_opens}</p>
                <p className="opacity-80">
                  {row.last_entry_ts ? new Date(row.last_entry_ts).toLocaleString("hu-HU") : "nincs nyitás"}
                </p>
              </div>
            ))}
            {performance.length === 0 ? (
              <p className="text-brand-100/60">Nincs rollout performance adat.</p>
            ) : null}
          </div>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-brand-100/80">Aktív rolloutok</h3>
          <div className="mt-2 space-y-2 text-xs">
            {rollouts.map((row) => (
              <div
                key={row.id}
                className={cx(
                  "rounded-lg border p-2",
                  row.status === "active" ? statusTone("ok") : row.status === "canary" ? statusTone("warn") : statusTone("neutral")
                )}
              >
                <p className="font-medium">{row.status === "active" ? "Éles" : row.status === "canary" ? "Teszt" : row.status}</p>
                <p className="opacity-90">Canary arány: {formatPct(Number(row.canary_ratio ?? 0))}</p>
                <p className="opacity-80">{new Date(row.start_ts).toLocaleString("hu-HU")}</p>
              </div>
            ))}
            {rollouts.length === 0 ? (
              <p className="text-brand-100/60">Nincs rollout adat.</p>
            ) : null}
          </div>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-brand-100/80">Utóbbi javaslatok</h3>
          <div className="mt-2 space-y-2 text-xs">
            {proposals.map((row) => (
              <div key={row.id} className="rounded-lg border border-brand-300/15 p-2">
                <p className="font-medium">{row.decision === "approved" ? "Elfogadva" : row.decision}</p>
                <p className="text-brand-100/70">Forrás: {row.model ?? "-"}</p>
                <p className="text-brand-100/70">Indok: {row.decision_reason ?? "-"}</p>
                <p className="text-brand-100/70">{new Date(row.created_at).toLocaleString("hu-HU")}</p>
              </div>
            ))}
            {proposals.length === 0 ? (
              <p className="text-brand-100/60">Nincs proposal adat.</p>
            ) : null}
          </div>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-brand-100/80">Utóbbi események</h3>
          <div className="mt-2 space-y-2 text-xs">
            {events.map((row) => (
              <div key={row.id} className="rounded-lg border border-brand-300/15 p-2">
                <p className="font-medium">
                  {row.event_type === "rollout_promoted"
                    ? "Rollout aktiválva"
                    : row.event_type === "rollout_started"
                    ? "Új rollout indult"
                    : row.event_type === "rollout_failed"
                    ? "Rollout leállt"
                    : row.event_type === "controller_cycle"
                    ? "Controller ellenőrzés"
                    : row.event_type === "canary_ratio_escalated"
                    ? "Canary forgalom emelve"
                    : row.event_type}
                </p>
                <p className="text-brand-100/70">{new Date(row.ts).toLocaleString("hu-HU")}</p>
              </div>
            ))}
            {events.length === 0 ? (
              <p className="text-brand-100/60">Nincs event adat.</p>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
