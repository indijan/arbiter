import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

type ReviewRecommendation = {
  strategy_key: string;
  recommended_state: "active" | "watch" | "standby" | "paused";
};

export async function POST(request: Request) {
  const supabase = createServerSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "Missing Supabase env vars." }, { status: 500 });
  }

  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { strategy_key?: string };
  const strategyKey = String(body.strategy_key ?? "").trim();
  if (!strategyKey) {
    return NextResponse.json({ error: "Missing strategy_key." }, { status: 400 });
  }

  const { data: review, error: reviewError } = await supabase
    .from("lane_policy_reviews")
    .select("id, recommendations")
    .eq("user_id", userData.user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (reviewError) {
    return NextResponse.json({ error: reviewError.message }, { status: 500 });
  }
  if (!review) {
    return NextResponse.json({ error: "No lane policy review found." }, { status: 404 });
  }

  const recommendations = Array.isArray(review.recommendations)
    ? (review.recommendations as ReviewRecommendation[])
    : [];
  const selected = recommendations.find((row) => row.strategy_key === strategyKey);

  if (!selected) {
    return NextResponse.json({ error: "No recommendation found for this lane." }, { status: 404 });
  }

  const { error: upsertError } = await supabase
    .from("strategy_settings")
    .upsert(
      {
        user_id: userData.user.id,
        strategy_key: selected.strategy_key,
        enabled: selected.recommended_state !== "paused",
        config: { state: selected.recommended_state }
      },
      { onConflict: "user_id,strategy_key" }
    );

  if (upsertError) {
    return NextResponse.json({ error: upsertError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, applied: 1, strategy_key: selected.strategy_key });
}
