import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/server-admin";

type SnapshotInsert = {
  exchange: string;
  symbol: string;
  spot_bid: number;
  spot_ask: number;
  perp_bid: number;
  perp_ask: number;
  funding_rate: number;
  mark_price: number;
  index_price: number;
};

const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"];

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function createSnapshot(symbol: string, goodEdge: boolean): SnapshotInsert {
  const basePrice =
    symbol === "BTCUSDT"
      ? randomBetween(42000, 52000)
      : symbol === "ETHUSDT"
        ? randomBetween(2000, 3400)
        : symbol === "SOLUSDT"
          ? randomBetween(80, 180)
          : symbol === "BNBUSDT"
            ? randomBetween(260, 520)
            : randomBetween(0.4, 0.8);

  const spotBid = basePrice * randomBetween(0.998, 0.9995);
  const spotAsk = basePrice * randomBetween(1.0005, 1.002);

  let perpBid: number;
  let perpAsk: number;
  let fundingRate: number;

  if (goodEdge) {
    const basis = spotAsk * randomBetween(0.0008, 0.002);
    const perpMid = spotAsk + basis;
    perpBid = perpMid * randomBetween(0.999, 0.9995);
    perpAsk = perpMid * randomBetween(1.0005, 1.0015);
    fundingRate = randomBetween(0.0002, 0.0006);
  } else {
    const basis = basePrice * randomBetween(-0.0015, 0.0015);
    const perpMid = basePrice + basis;
    perpBid = perpMid * randomBetween(0.998, 0.9995);
    perpAsk = perpMid * randomBetween(1.0005, 1.002);
    fundingRate = Math.random() < 0.2 ? -0.0001 : randomBetween(0, 0.00025);
  }

  return {
    exchange: "mock",
    symbol,
    spot_bid: Number(spotBid.toFixed(2)),
    spot_ask: Number(spotAsk.toFixed(2)),
    perp_bid: Number(perpBid.toFixed(2)),
    perp_ask: Number(perpAsk.toFixed(2)),
    funding_rate: Number(fundingRate.toFixed(6)),
    mark_price: Number(((perpBid + perpAsk) / 2).toFixed(2)),
    index_price: Number(basePrice.toFixed(2))
  };
}

export async function POST() {
  const authSupabase = createServerSupabase();
  if (!authSupabase) {
    return NextResponse.json(
      { error: "Missing Supabase env vars." },
      { status: 500 }
    );
  }

  const {
    data: { user }
  } = await authSupabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const adminSupabase = createAdminSupabase();
  if (!adminSupabase) {
    return NextResponse.json(
      { error: "Missing service role key." },
      { status: 500 }
    );
  }

  const count = Math.floor(randomBetween(3, 6));
  const picks = SYMBOLS.sort(() => 0.5 - Math.random()).slice(0, count);
  const goodEdge = Math.random() < 0.33;
  const payload = picks.map((symbol) => createSnapshot(symbol, goodEdge));

  const { error } = await adminSupabase.from("market_snapshots").insert(payload);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ inserted: payload.length, good_edge: goodEdge });
}
