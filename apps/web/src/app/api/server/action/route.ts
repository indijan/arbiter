import { NextRequest, NextResponse } from "next/server";
import { requireServerUiToken } from "@/server/serverCockpit/auth";
import { runMba } from "@/server/serverCockpit/localRuntime";

type Action = "restart" | "update" | "stop" | "start";

export async function POST(req: NextRequest) {
  const auth = requireServerUiToken(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const body = await req.json().catch(() => ({}));
  const action = String(body.action ?? "") as Action;

  if (!["restart", "update", "stop", "start"].includes(action)) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  try {
    if (action === "restart") {
      const stop = await runMba("stop");
      const start = await runMba("start");
      const status = await runMba("status");
      return NextResponse.json({ ok: true, stop, start, status });
    }

    if (action === "update") {
      const update = await runMba("update");
      const status = await runMba("status");
      return NextResponse.json({ ok: true, update, status });
    }

    if (action === "stop") {
      const stop = await runMba("stop");
      const status = await runMba("status");
      return NextResponse.json({ ok: true, stop, status });
    }

    const start = await runMba("start");
    const status = await runMba("status");
    return NextResponse.json({ ok: true, start, status });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}

