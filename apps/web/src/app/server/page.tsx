"use client";

import { useEffect, useMemo, useState } from "react";

type ProcState = { running: boolean; pid: number | null };
type RuntimeStatus = {
  web: ProcState;
  runner: ProcState;
  caffeinate: ProcState;
  logs: { webErr: string; runnerOut: string };
};

type StatusPayload = {
  runtime: RuntimeStatus;
  latest_tick: any;
  tails: { web_err: string[]; runner_out: string[] };
};

function pill(ok: boolean) {
  return ok
    ? "border-emerald-300/25 bg-emerald-500/10 text-emerald-100"
    : "border-rose-300/25 bg-rose-500/10 text-rose-100";
}

function fmtTs(value: string | null | undefined) {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleString("hu-HU");
  } catch {
    return String(value);
  }
}

export default function ServerPage() {
  const [token, setToken] = useState("");
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [envsyncCommand, setEnvsyncCommand] = useState<string>("...");
  const [backcheck, setBackcheck] = useState<any | null>(null);
  const [openWindowDays, setOpenWindowDays] = useState<number | null>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem("server_ui_token") ?? "";
    if (saved) setToken(saved);
  }, []);

  const tokenHeader = useMemo(() => ({ "x-server-ui-token": token }), [token]);

  useEffect(() => {
    const host = window.location.hostname;
    const sshHost = host && host !== "localhost" ? `indijan@${host}` : "indijan@192.168.1.182";
    setEnvsyncCommand(`cd /Users/indijanmac/Projects/arbiter && RESTART=1 ./scripts/envsync.sh ${sshHost}`);
  }, []);

  async function copyEnvsync() {
    try {
      await navigator.clipboard.writeText(envsyncCommand);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Nem sikerült a vágólapra másolni (browser permission).");
    }
  }

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/server/status", { headers: tokenHeader, cache: "no-store" });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(payload.error ?? "Hiba a status lekérésben.");
        setStatus(null);
        setBackcheck(null);
      } else {
        setStatus(payload as StatusPayload);
        // Backcheck is optional; don't fail the page if missing.
        fetch("/api/server/backcheck", { headers: tokenHeader, cache: "no-store" })
          .then((r) => r.json())
          .then((x) => setBackcheck(x))
          .catch(() => setBackcheck(null));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
      setStatus(null);
      setBackcheck(null);
    } finally {
      setLoading(false);
    }
  }

  async function doAction(action: "restart" | "update" | "stop" | "start") {
    setActionLoading(action);
    setError(null);
    try {
      const res = await fetch("/api/server/action", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...tokenHeader },
        body: JSON.stringify({ action })
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || payload.ok !== true) {
        setError(payload.error ?? "Művelet sikertelen.");
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setActionLoading(null);
    }
  }

  const attempted = Number((status?.latest_tick?.detect_summary as any)?.auto_execute?.attempted ?? 0);
  const passed = Number((status?.latest_tick?.detect_summary as any)?.auto_execute?.diagnostics?.passed_filters ?? 0);
  const created = Number((status?.latest_tick?.detect_summary as any)?.auto_execute?.created ?? 0);
  const ingestErrors = Number(status?.latest_tick?.ingest_errors ?? 0);

  return (
    <div className="min-h-screen px-6 py-16">
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm uppercase tracking-[0.3em] text-brand-300">Server</p>
            <h1 className="text-3xl font-semibold">Home server UI</h1>
          </div>
          <div className="flex items-center gap-2">
            <button className="btn btn-ghost" onClick={refresh} disabled={loading || !token}>
              {loading ? "Frissítés..." : "Frissít"}
            </button>
          </div>
        </header>

        <section className="card">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-semibold">Hozzáférés</h2>
          </div>
          <div className="mt-3 flex flex-col gap-2 md:flex-row md:items-center">
            <input
              className="w-full rounded-xl border border-brand-300/20 bg-brand-900/50 px-3 py-2 text-sm outline-none"
              placeholder="SERVER_UI_TOKEN"
              value={token}
              onChange={(e) => {
                const v = e.target.value;
                setToken(v);
                window.localStorage.setItem("server_ui_token", v);
              }}
            />
            <div className="flex items-center gap-2">
              <button className="btn btn-ghost" onClick={() => doAction("restart")} disabled={!token || actionLoading !== null}>
                {actionLoading === "restart" ? "Restart..." : "Restart"}
              </button>
              <button className="btn btn-ghost" onClick={() => doAction("update")} disabled={!token || actionLoading !== null}>
                {actionLoading === "update" ? "Update..." : "Update"}
              </button>
              <button className="btn btn-ghost" onClick={() => doAction("stop")} disabled={!token || actionLoading !== null}>
                {actionLoading === "stop" ? "Stop..." : "Stop"}
              </button>
              <button className="btn btn-ghost" onClick={() => doAction("start")} disabled={!token || actionLoading !== null}>
                {actionLoading === "start" ? "Start..." : "Start"}
              </button>
            </div>
          </div>
          {error ? <p className="mt-2 text-sm text-rose-200">{error}</p> : null}
          {!token ? <p className="mt-2 text-xs text-brand-100/60">Token nélkül nem tudok lekérdezni/vezérelni.</p> : null}

          <div className="mt-4 rounded-xl border border-brand-300/15 bg-brand-900/30 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold">Env sync parancs (a saját gépeden futtasd)</p>
              <button className="btn btn-ghost" onClick={copyEnvsync}>
                {copied ? "Kimásolva" : "Másolás"}
              </button>
            </div>
            <pre className="mt-2 overflow-auto rounded-lg border border-brand-300/10 bg-brand-950/60 p-2 text-xs">
              {envsyncCommand}
            </pre>
          </div>
        </section>

        {status ? (
          <>
            <section className="card">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-xl font-semibold">Futás</h2>
                <p className="text-xs text-brand-100/60">Utolsó tick: {fmtTs(status.latest_tick?.ts)}</p>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <div className={`rounded-xl border p-3 ${pill(status.runtime.web.running)}`}>
                  <p className="text-xs text-brand-100/60">Web</p>
                  <p className="mt-1 text-lg font-semibold">{status.runtime.web.running ? "RUNNING" : "STOPPED"}</p>
                  <p className="text-xs text-brand-100/60">pid: {status.runtime.web.pid ?? "-"}</p>
                </div>
                <div className={`rounded-xl border p-3 ${pill(status.runtime.runner.running)}`}>
                  <p className="text-xs text-brand-100/60">Runner</p>
                  <p className="mt-1 text-lg font-semibold">{status.runtime.runner.running ? "RUNNING" : "STOPPED"}</p>
                  <p className="text-xs text-brand-100/60">pid: {status.runtime.runner.pid ?? "-"}</p>
                </div>
                <div className={`rounded-xl border p-3 ${pill(status.runtime.caffeinate.running)}`}>
                  <p className="text-xs text-brand-100/60">Caffeinate</p>
                  <p className="mt-1 text-lg font-semibold">{status.runtime.caffeinate.running ? "RUNNING" : "STOPPED"}</p>
                  <p className="text-xs text-brand-100/60">pid: {status.runtime.caffeinate.pid ?? "-"}</p>
                </div>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-4">
                <div className="rounded-xl border border-brand-300/15 bg-brand-900/40 p-3">
                  <p className="text-xs text-brand-100/60">Ingest hibák</p>
                  <p className="mt-1 text-2xl font-semibold">{ingestErrors}</p>
                </div>
                <div className="rounded-xl border border-brand-300/15 bg-brand-900/40 p-3">
                  <p className="text-xs text-brand-100/60">Attempted</p>
                  <p className="mt-1 text-2xl font-semibold">{attempted}</p>
                </div>
                <div className="rounded-xl border border-brand-300/15 bg-brand-900/40 p-3">
                  <p className="text-xs text-brand-100/60">Passed</p>
                  <p className="mt-1 text-2xl font-semibold">{passed}</p>
                </div>
                <div className="rounded-xl border border-brand-300/15 bg-brand-900/40 p-3">
                  <p className="text-xs text-brand-100/60">Created</p>
                  <p className="mt-1 text-2xl font-semibold">{created}</p>
                </div>
              </div>
            </section>

            <section className="card">
              <h2 className="text-xl font-semibold">Logok</h2>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div>
                  <p className="text-sm text-brand-100/70">web.err</p>
                  <pre className="mt-2 max-h-72 overflow-auto rounded-xl border border-brand-300/10 bg-brand-950/60 p-3 text-xs">
                    {status.tails.web_err.length > 0 ? status.tails.web_err.join("\n") : "(empty)"}
                  </pre>
                </div>
                <div>
                  <p className="text-sm text-brand-100/70">runner.out</p>
                  <pre className="mt-2 max-h-72 overflow-auto rounded-xl border border-brand-300/10 bg-brand-950/60 p-3 text-xs">
                    {status.tails.runner_out.length > 0 ? status.tails.runner_out.join("\n") : "(empty)"}
                  </pre>
                </div>
              </div>
            </section>

            <section className="card">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-xl font-semibold">Backcheck (1/7/30 nap)</h2>
                <button className="btn btn-ghost" onClick={refresh} disabled={!token || loading}>
                  {loading ? "Frissítés..." : "Frissít (adat)"}
                </button>
              </div>
              {backcheck?.rows?.length ? (
                <div className="mt-4">
                  <div className="grid gap-3 md:grid-cols-3">
                    {backcheck.rows.map((row: any) => {
                      const isOpen = openWindowDays === Number(row.window_days);
                      const topReject =
                        Array.isArray(row.summary?.top_reject_reasons_24h) && row.summary.top_reject_reasons_24h.length
                          ? String(row.summary.top_reject_reasons_24h[0].title ?? row.summary.top_reject_reasons_24h[0].reason)
                          : "-";
                      return (
                        <button
                          key={String(row.window_days)}
                          className="text-left rounded-xl border border-brand-300/15 bg-brand-900/40 p-3 hover:bg-brand-900/55 transition"
                          onClick={() => setOpenWindowDays(isOpen ? null : Number(row.window_days))}
                        >
                          <p className="text-sm font-semibold">{row.window_days} nap</p>
                          <p className="mt-1 text-xs text-brand-100/60">ts: {fmtTs(row.ts)}</p>
                          <p className="mt-2 text-xs text-brand-100/70">
                            Lanes: {Number(row.summary?.lanes?.length ?? 0)} | Families: {Number(row.summary?.families?.length ?? 0)}
                          </p>
                          <p className="mt-2 text-xs text-brand-100/60">Top reject: {topReject}</p>
                          <p className="mt-2 text-[11px] text-brand-100/50">{isOpen ? "Részletek elrejtése" : "Részletek"}</p>
                        </button>
                      );
                    })}
                  </div>

                  {(() => {
                    const row = (backcheck.rows as any[]).find((r) => Number(r.window_days) === openWindowDays);
                    if (!row) return null;
                    const lanes = Array.isArray(row.summary?.lanes) ? row.summary.lanes : [];
                    const families = Array.isArray(row.summary?.families) ? row.summary.families : [];
                    const topReasons = Array.isArray(row.summary?.top_reject_reasons_24h)
                      ? row.summary.top_reject_reasons_24h
                      : [];

                    const worstLanes = lanes.slice(0, 3);
                    const bestLanes = lanes.slice(-3).reverse();
                    const worstFamilies = families.slice(0, 3);
                    const bestFamilies = families.slice(-3).reverse();

                    return (
                      <div className="mt-4 rounded-2xl border border-brand-300/15 bg-brand-900/30 p-4">
                        <p className="text-sm font-semibold">{row.window_days} nap részletek</p>

                        <div className="mt-3 grid gap-4 md:grid-cols-3">
                          <div>
                            <p className="text-xs text-brand-100/60">Top okok (24h)</p>
                            <div className="mt-2 space-y-2">
                              {(topReasons.length ? topReasons : [{ title: "-", detail: "-", reason: "-", count: 0 }])
                                .slice(0, 3)
                                .map((x: any, idx: number) => (
                                <div key={idx} className="rounded-xl border border-brand-300/10 bg-brand-950/50 p-2 text-xs">
                                  <p className="font-semibold">{String(x.title ?? x.reason ?? "-")}</p>
                                  <p className="mt-1 text-[11px] text-brand-100/60">{String(x.detail ?? "")}</p>
                                  <p className="text-brand-100/60">count: {Number(x.count ?? 0)}</p>
                                </div>
                              ))}
                            </div>
                          </div>

                          <div>
                            <p className="text-xs text-brand-100/60">Lane-ek (worst / best)</p>
                            <div className="mt-2 grid gap-2">
                              <div className="rounded-xl border border-brand-300/10 bg-brand-950/50 p-2 text-xs">
                                <p className="font-semibold">Worst</p>
                                {worstLanes.length ? worstLanes.map((l: any) => (
                                  <p key={String(l.lane)} className="text-brand-100/70">
                                    {String(l.lane)}: {Number(l.total_pnl_usd ?? 0).toFixed(2)} USD ({Number(l.closed ?? 0)})
                                  </p>
                                )) : <p className="text-brand-100/60">-</p>}
                              </div>
                              <div className="rounded-xl border border-brand-300/10 bg-brand-950/50 p-2 text-xs">
                                <p className="font-semibold">Best</p>
                                {bestLanes.length ? bestLanes.map((l: any) => (
                                  <p key={String(l.lane)} className="text-brand-100/70">
                                    {String(l.lane)}: {Number(l.total_pnl_usd ?? 0).toFixed(2)} USD ({Number(l.closed ?? 0)})
                                  </p>
                                )) : <p className="text-brand-100/60">-</p>}
                              </div>
                            </div>
                          </div>

                          <div>
                            <p className="text-xs text-brand-100/60">Stratégiák (worst / best)</p>
                            <div className="mt-2 grid gap-2">
                              <div className="rounded-xl border border-brand-300/10 bg-brand-950/50 p-2 text-xs">
                                <p className="font-semibold">Worst</p>
                                {worstFamilies.length ? worstFamilies.map((f: any) => (
                                  <p key={String(f.type)} className="text-brand-100/70">
                                    {String(f.type)}: {Number(f.total_pnl_usd ?? 0).toFixed(2)} USD ({Number(f.closed ?? 0)})
                                  </p>
                                )) : <p className="text-brand-100/60">-</p>}
                              </div>
                              <div className="rounded-xl border border-brand-300/10 bg-brand-950/50 p-2 text-xs">
                                <p className="font-semibold">Best</p>
                                {bestFamilies.length ? bestFamilies.map((f: any) => (
                                  <p key={String(f.type)} className="text-brand-100/70">
                                    {String(f.type)}: {Number(f.total_pnl_usd ?? 0).toFixed(2)} USD ({Number(f.closed ?? 0)})
                                  </p>
                                )) : <p className="text-brand-100/60">-</p>}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              ) : (
                <p className="mt-3 text-sm text-brand-100/70">Még nincs backcheck run. (A runner tick fogja létrehozni.)</p>
              )}
            </section>
          </>
        ) : null}
      </div>
    </div>
  );
}
