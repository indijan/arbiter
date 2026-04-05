export async function POST(request: Request) {
  void request;
  return new Response(
    JSON.stringify({ error: "Lane policy apply is disabled. Regime-based activation is enforced server-side." }),
    { status: 410, headers: { "content-type": "application/json" } }
  );
}
