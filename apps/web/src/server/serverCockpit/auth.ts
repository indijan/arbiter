import "server-only";

import { NextRequest } from "next/server";

export function requireServerUiToken(req: NextRequest) {
  const token = (process.env.SERVER_UI_TOKEN ?? "").trim();
  if (!token) {
    return { ok: false as const, status: 404, error: "Not enabled" };
  }

  // Never allow these endpoints on Vercel/production hosting by accident.
  if (process.env.VERCEL === "1") {
    return { ok: false as const, status: 403, error: "Forbidden" };
  }

  const got =
    req.headers.get("x-server-ui-token") ??
    new URL(req.url).searchParams.get("token") ??
    "";

  if (got !== token) {
    return { ok: false as const, status: 401, error: "Unauthorized" };
  }

  return { ok: true as const };
}

