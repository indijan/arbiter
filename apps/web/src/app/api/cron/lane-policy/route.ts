export async function GET(request: Request) {
  void request;
  return new Response(JSON.stringify({ error: "lane-policy cron disabled" }), {
    status: 410,
    headers: { "content-type": "application/json" }
  });
}

export async function POST(request: Request) {
  void request;
  return new Response(JSON.stringify({ error: "lane-policy cron disabled" }), {
    status: 410,
    headers: { "content-type": "application/json" }
  });
}
