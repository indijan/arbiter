import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

type ReviewRecommendation = {
  strategy_key: string;
  recommended_state: "active" | "watch" | "standby" | "paused";
};

export async function POST() {
  const supabase = createServerSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "Missing Supabase env vars." }, { status: 500 });
  }

  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

  if (recommendations.length === 0) {
    return NextResponse.json({ error: "No recommendations to apply." }, { status: 400 });
  }

  const rows = recommendations.map((row) => ({
    user_id: userData.user.id,
    strategy_key: row.strategy_key,
    enabled: row.recommended_state !== "paused",
    config: { state: row.recommended_state }
  }));

  const { error: upsertError } = await supabase
    .from("strategy_settings")
    .upsert(rows, { onConflict: "user_id,strategy_key" });

  if (upsertError) {
    return NextResponse.json({ error: upsertError.message }, { status: 500 });
  }

  await supabase
    .from("lane_policy_reviews")
    .update({ status: "applied" })
    .eq("id", review.id);

  return NextResponse.json({ ok: true, applied: recommendations.length });
}
