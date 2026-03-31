import { NextResponse } from "next/server";

export function ensureCronAuthorized(request: Request) {
  const expected = process.env.CRON_SECRET;
  const headerSecret = request.headers.get("x-cron-secret");
  const url = new URL(request.url);
  const querySecret = url.searchParams.get("secret");
  const provided = headerSecret ?? querySecret;
  const userAgent = request.headers.get("user-agent") ?? "";
  const isVercelCron = userAgent.toLowerCase().includes("vercel-cron");

  if (!isVercelCron && (!expected || !provided || provided !== expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null;
}

