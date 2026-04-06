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

  useEffect(() => {
    const saved = window.localStorage.getItem("server_ui_token") ?? "";
    if (saved) setToken(saved);
  }, []);

  const tokenHeader = useMemo(() => ({ "x-server-ui-token": token }), [token]);

  const envsyncCommand = useMemo(() => {
    if (typeof window === "undefined") return "";
    const host = window.location.hostname;
    // Prefer current host for SSH; this works for Tailscale IP and LAN IP.
    const sshHost = host && host !== "localhost" ? `indijan@${host}` : "indijan@192.168.1.182";
    return `cd /Users/indijanmac/Projects/arbiter && RESTART=1 ./scripts/envsync.sh ${sshHost}`;
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
      } else {
        setStatus(payload as StatusPayload);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
      setStatus(null);
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
          </>
        ) : null}
      </div>
    </div>
  );
}
