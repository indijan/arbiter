import "server-only";

import { createAdminSupabase } from "@/lib/supabase/server-admin";
import { paperFill } from "@/lib/execution/paperFill";
import { CARRY_CONFIG } from "@/lib/strategy/spotPerpCarry";

const SLIPPAGE_BPS = 2;
const FEE_BPS = 4;

const TP_PCT = 0.003;
const SL_PCT = 0.002;

const HOLDING_HOURS = 24;

const COSTS_BPS_XARB = {
  fee_bps_total: 6,
  slippage_bps_total: 4,
  transfer_buffer_bps: 8
};

const KRAKEN_PAIR_MAP: Record<string, string> = {
  BTCUSD: "XXBTZUSD",
  ETHUSD: "XETHZUSD"
};

type BybitTicker = {
  bid1Price: string;
  ask1Price: string;
  fundingRate?: string;
};

type BybitResponse = {
  retCode: number;
  retMsg: string;
  result: { list: BybitTicker[] };
};

type OkxTicker = {
  bidPx: string;
  askPx: string;
};

type OkxResponse = {
  code: string;
  msg: string;
  data: OkxTicker[];
};

type OkxFunding = {
  instId: string;
  fundingRate: string;
  fundingTime: string;
};

type OkxFundingResponse = {
  code: string;
  msg: string;
  data: OkxFunding[];
};

type KrakenTicker = {
  a: [string, string, string];
  b: [string, string, string];
};

type KrakenResponse = {
  error: string[];
  result: Record<string, KrakenTicker>;
};

type CloseResult = {
  attempted: number;
  closed: number;
  skipped: number;
  reasons: Array<{ position_id: string; reason: string }>;
};

function toNumber(value: string | undefined | null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      "accept": "application/json",
      "user-agent": "Mozilla/5.0 (compatible; ArbiterBot/1.0)"
    }
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

function okxSpotInstId(symbol: string) {
  const base = symbol.replace("USDT", "");
  return `${base}-USDT`;
}

function okxSwapInstId(symbol: string) {
  return `${okxSpotInstId(symbol)}-SWAP`;
}

async function fetchSpotTicker(exchange: string, symbol: string) {
  if (exchange === "bybit") {
    const spot = await fetchJson<BybitResponse>(
      `https://api.bybit.com/v5/market/tickers?category=spot&symbol=${symbol}`
    );
    if (spot.retCode !== 0) {
      throw new Error(`Bybit error: ${spot.retMsg}`);
    }
    const ticker = spot.result.list[0];
    const bid = toNumber(ticker?.bid1Price ?? null);
    const ask = toNumber(ticker?.ask1Price ?? null);
    if (!bid || !ask || ask <= bid) {
      throw new Error("Bybit invalid bid/ask");
    }
    return { bid, ask };
  }

  if (exchange === "okx") {
    const instId = okxSpotInstId(symbol);
    const spot = await fetchJson<OkxResponse>(
      `https://www.okx.com/api/v5/market/ticker?instId=${instId}`
    );
    if (spot.code !== "0") {
      throw new Error(`OKX error: ${spot.msg}`);
    }
    const ticker = spot.data[0];
    const bid = toNumber(ticker?.bidPx ?? null);
    const ask = toNumber(ticker?.askPx ?? null);
    if (!bid || !ask || ask <= bid) {
      throw new Error("OKX invalid bid/ask");
    }
    return { bid, ask };
  }

  if (exchange === "kraken") {
    const pair = KRAKEN_PAIR_MAP[symbol];
    if (!pair) {
      throw new Error("Kraken pair not supported");
    }
    const data = await fetchJson<KrakenResponse>(
      `https://api.kraken.com/0/public/Ticker?pair=${pair}`
    );
    if (data.error && data.error.length > 0) {
      throw new Error(data.error.join(", "));
    }
    const ticker = data.result?.[pair];
    const ask = toNumber(ticker?.a?.[0]);
    const bid = toNumber(ticker?.b?.[0]);
    if (!bid || !ask || ask <= bid) {
      throw new Error("Kraken invalid bid/ask");
    }
    return { bid, ask };
  }

  throw new Error("unsupported exchange");
}

async function fetchCarryQuotes(exchange: string, symbol: string) {
  if (exchange === "bybit") {
    const spot = await fetchJson<BybitResponse>(
      `https://api.bybit.com/v5/market/tickers?category=spot&symbol=${symbol}`
    );
    const perp = await fetchJson<BybitResponse>(
      `https://api.bybit.com/v5/market/tickers?category=linear&symbol=${symbol}`
    );
    if (spot.retCode !== 0 || perp.retCode !== 0) {
      throw new Error(`Bybit error: ${spot.retMsg || perp.retMsg}`);
    }
    const spotTicker = spot.result.list[0];
    const perpTicker = perp.result.list[0];
    const spot_bid = toNumber(spotTicker?.bid1Price ?? null);
    const spot_ask = toNumber(spotTicker?.ask1Price ?? null);
    const perp_bid = toNumber(perpTicker?.bid1Price ?? null);
    const perp_ask = toNumber(perpTicker?.ask1Price ?? null);
    const funding_rate = toNumber(perpTicker?.fundingRate ?? null);
    if (!spot_bid || !spot_ask || !perp_bid || !perp_ask || spot_ask <= spot_bid || perp_ask <= perp_bid) {
      throw new Error("Bybit invalid bid/ask");
    }
    return { spot_bid, spot_ask, perp_bid, perp_ask, funding_rate };
  }

  if (exchange === "okx") {
    const spotInstId = okxSpotInstId(symbol);
    const swapInstId = okxSwapInstId(symbol);
    const spot = await fetchJson<OkxResponse>(
      `https://www.okx.com/api/v5/market/ticker?instId=${spotInstId}`
    );
    const swap = await fetchJson<OkxResponse>(
      `https://www.okx.com/api/v5/market/ticker?instId=${swapInstId}`
    );
    const funding = await fetchJson<OkxFundingResponse>(
      `https://www.okx.com/api/v5/public/funding-rate?instId=${swapInstId}`
    );
    if (spot.code !== "0" || swap.code !== "0") {
      throw new Error(`OKX error: ${spot.msg || swap.msg}`);
    }
    const spotTicker = spot.data[0];
    const swapTicker = swap.data[0];
    const spot_bid = toNumber(spotTicker?.bidPx ?? null);
    const spot_ask = toNumber(spotTicker?.askPx ?? null);
    const perp_bid = toNumber(swapTicker?.bidPx ?? null);
    const perp_ask = toNumber(swapTicker?.askPx ?? null);
    const funding_rate = funding.code === "0" ? toNumber(funding.data[0]?.fundingRate) : null;
    if (!spot_bid || !spot_ask || !perp_bid || !perp_ask || spot_ask <= spot_bid || perp_ask <= perp_bid) {
      throw new Error("OKX invalid bid/ask");
    }
    return { spot_bid, spot_ask, perp_bid, perp_ask, funding_rate };
  }

  throw new Error("unsupported exchange");
}

function shouldCloseByPnl(pnlUsd: number, notionalUsd: number) {
  if (!Number.isFinite(notionalUsd) || notionalUsd <= 0) {
    return false;
  }
  const pct = pnlUsd / notionalUsd;
  return pct >= TP_PCT || pct <= -SL_PCT;
}

export async function autoClosePaper(): Promise<CloseResult> {
  const adminSupabase = createAdminSupabase();
  if (!adminSupabase) {
    throw new Error("Missing service role key.");
  }

  let { data: account, error: accountError } = await adminSupabase
    .from("paper_accounts")
    .select("id, user_id, balance_usd, reserved_usd")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (accountError) {
    throw new Error(accountError.message);
  }

  if (!account) {
    const { data: profile, error: profileError } = await adminSupabase
      .from("profiles")
      .select("id")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (profileError) {
      throw new Error(profileError.message);
    }

    if (!profile?.id) {
      return { attempted: 0, closed: 0, skipped: 0, reasons: [] };
    }

    const { data: createdAccount, error: createError } = await adminSupabase
      .from("paper_accounts")
      .insert({
        user_id: profile.id,
        balance_usd: 10000,
        reserved_usd: 0
      })
      .select("id, user_id, balance_usd, reserved_usd")
      .single();

    if (createError || !createdAccount) {
      throw new Error(createError?.message ?? "Failed to create paper account.");
    }

    account = createdAccount;
  }

  const userId = account.user_id;
  let reservedCurrent = Number(account.reserved_usd ?? 0);

  const { data: positions, error: positionsError } = await adminSupabase
    .from("positions")
    .select("id, opportunity_id, symbol, status, spot_qty, perp_qty, entry_spot_price, entry_perp_price, meta")
    .eq("user_id", userId)
    .eq("status", "open");

  if (positionsError) {
    throw new Error(positionsError.message);
  }

  const opportunityIds = (positions ?? [])
    .map((p) => p.opportunity_id)
    .filter((id): id is number => typeof id === "number");

  const { data: opportunities, error: oppError } = await adminSupabase
    .from("opportunities")
    .select("id, exchange, symbol, type")
    .in("id", opportunityIds.length > 0 ? opportunityIds : [0]);

  if (oppError) {
    throw new Error(oppError.message);
  }

  const oppMap = new Map((opportunities ?? []).map((o) => [o.id, o]));

  let attempted = 0;
  let closed = 0;
  let skipped = 0;
  const reasons: Array<{ position_id: string; reason: string }> = [];

  for (const position of positions ?? []) {
    attempted += 1;

    const opp = position.opportunity_id ? oppMap.get(position.opportunity_id) : null;
    if (!opp) {
      skipped += 1;
      reasons.push({ position_id: position.id, reason: "missing_opportunity" });
      continue;
    }

    const meta = (position.meta ?? {}) as Record<string, unknown>;
    const notionalUsd = Number(meta.notional_usd ?? 0);

    if (opp.type === "spot_perp_carry") {
      let quotes;
      try {
        quotes = await fetchCarryQuotes(opp.exchange, opp.symbol);
      } catch (err) {
        skipped += 1;
        reasons.push({ position_id: position.id, reason: "live_price_error" });
        continue;
      }

      const spot_mid = (quotes.spot_bid + quotes.spot_ask) / 2;
      const perp_mid = (quotes.perp_bid + quotes.perp_ask) / 2;

      const spot_qty = Number(position.spot_qty ?? 0);
      const perp_qty = Number(position.perp_qty ?? 0);
      const entry_spot_price = Number(position.entry_spot_price ?? 0);
      const entry_perp_price = Number(position.entry_perp_price ?? 0);

      const spot_pnl = spot_qty * (spot_mid - entry_spot_price);
      const perp_pnl = perp_qty * (perp_mid - entry_perp_price);
      const unrealized = spot_pnl + perp_pnl;

      const funding_daily_bps = Number(quotes.funding_rate ?? 0) * 3 * 10000;
      const expected_holding_bps = funding_daily_bps * (HOLDING_HOURS / 24);
      const basis_bps = ((perp_mid - spot_mid) / spot_mid) * 10000;
      const costs_bps =
        CARRY_CONFIG.fee_bps_total +
        CARRY_CONFIG.slippage_bps_total +
        CARRY_CONFIG.latency_buffer_bps;
      const net_edge_bps = basis_bps + expected_holding_bps - costs_bps;

      const shouldClose =
        shouldCloseByPnl(unrealized, notionalUsd) ||
        funding_daily_bps <= 0 ||
        net_edge_bps < 0;

      if (!shouldClose) {
        skipped += 1;
        reasons.push({ position_id: position.id, reason: "hold" });
        continue;
      }

      const spotClose = paperFill({
        side: "sell",
        price: quotes.spot_bid,
        notional_usd: notionalUsd,
        slippage_bps: SLIPPAGE_BPS,
        fee_bps: FEE_BPS
      });

      const perpClose = paperFill({
        side: "buy",
        price: quotes.perp_ask,
        notional_usd: notionalUsd,
        slippage_bps: SLIPPAGE_BPS,
        fee_bps: FEE_BPS
      });

      const realized = Number((unrealized - spotClose.fee_usd - perpClose.fee_usd).toFixed(4));

      const { error: closeError } = await adminSupabase
        .from("positions")
        .update({
          status: "closed",
          exit_ts: new Date().toISOString(),
          exit_spot_price: spotClose.fill_price,
          exit_perp_price: perpClose.fill_price,
          realized_pnl_usd: realized
        })
        .eq("id", position.id)
        .eq("status", "open");

      if (closeError) {
        throw new Error(closeError.message);
      }

      const execPayload = [
        {
          position_id: position.id,
          leg: "spot_sell",
          requested_qty: spotClose.qty,
          filled_qty: spotClose.qty,
          avg_price: spotClose.fill_price,
          fee: spotClose.fee_usd,
          raw: {
            side: "sell",
            price: quotes.spot_bid,
            fill_price: spotClose.fill_price,
            slippage_bps: SLIPPAGE_BPS,
            fee_bps: FEE_BPS,
            notional_usd: notionalUsd
          }
        },
        {
          position_id: position.id,
          leg: "perp_buy",
          requested_qty: perpClose.qty,
          filled_qty: perpClose.qty,
          avg_price: perpClose.fill_price,
          fee: perpClose.fee_usd,
          raw: {
            side: "buy",
            price: quotes.perp_ask,
            fill_price: perpClose.fill_price,
            slippage_bps: SLIPPAGE_BPS,
            fee_bps: FEE_BPS,
            notional_usd: notionalUsd
          }
        }
      ];

      const { error: execError } = await adminSupabase
        .from("executions")
        .insert(execPayload);

      if (execError) {
        throw new Error(execError.message);
      }

      reservedCurrent = Number((reservedCurrent - notionalUsd).toFixed(2));
      await adminSupabase
        .from("paper_accounts")
        .update({ reserved_usd: Math.max(0, reservedCurrent), updated_at: new Date().toISOString() })
        .eq("id", account.id);

      closed += 1;
      continue;
    }

    if (opp.type === "xarb_spot") {
      const buyExchange = String(meta.buy_exchange ?? "");
      const sellExchange = String(meta.sell_exchange ?? "");
      const buySymbol = String(meta.buy_symbol ?? "");
      const sellSymbol = String(meta.sell_symbol ?? "");
      const buyEntry = Number(meta.buy_entry_price ?? 0);
      const sellEntry = Number(meta.sell_entry_price ?? 0);
      const buyQty = Number(meta.buy_qty ?? 0);
      const sellQty = Number(meta.sell_qty ?? 0);

      if (!buyExchange || !sellExchange || !buySymbol || !sellSymbol) {
        skipped += 1;
        reasons.push({ position_id: position.id, reason: "missing_meta" });
        continue;
      }

      let buyQuote: { bid: number; ask: number };
      let sellQuote: { bid: number; ask: number };
      try {
        [buyQuote, sellQuote] = await Promise.all([
          fetchSpotTicker(buyExchange, buySymbol),
          fetchSpotTicker(sellExchange, sellSymbol)
        ]);
      } catch (err) {
        skipped += 1;
        reasons.push({ position_id: position.id, reason: "live_price_error" });
        continue;
      }

      const buyPnl = buyQty * (buyQuote.bid - buyEntry);
      const sellPnl = sellQty * (sellEntry - sellQuote.ask);
      const unrealized = buyPnl + sellPnl;

      const gross_edge_bps = ((sellQuote.bid - buyQuote.ask) / buyQuote.ask) * 10000;
      const costs_bps =
        COSTS_BPS_XARB.fee_bps_total +
        COSTS_BPS_XARB.slippage_bps_total +
        COSTS_BPS_XARB.transfer_buffer_bps;
      const net_edge_bps = gross_edge_bps - costs_bps;

      const shouldClose =
        shouldCloseByPnl(unrealized, notionalUsd) ||
        net_edge_bps < 0;

      if (!shouldClose) {
        skipped += 1;
        reasons.push({ position_id: position.id, reason: "hold" });
        continue;
      }

      const buyClose = paperFill({
        side: "sell",
        price: buyQuote.bid,
        notional_usd: notionalUsd,
        slippage_bps: SLIPPAGE_BPS,
        fee_bps: FEE_BPS
      });

      const sellClose = paperFill({
        side: "buy",
        price: sellQuote.ask,
        notional_usd: notionalUsd,
        slippage_bps: SLIPPAGE_BPS,
        fee_bps: FEE_BPS
      });

      const realized = Number((unrealized - buyClose.fee_usd - sellClose.fee_usd).toFixed(4));

      const { error: closeError } = await adminSupabase
        .from("positions")
        .update({
          status: "closed",
          exit_ts: new Date().toISOString(),
          exit_spot_price: buyClose.fill_price,
          exit_perp_price: sellClose.fill_price,
          realized_pnl_usd: realized
        })
        .eq("id", position.id)
        .eq("status", "open");

      if (closeError) {
        throw new Error(closeError.message);
      }

      const execPayload = [
        {
          position_id: position.id,
          leg: "spot_sell",
          requested_qty: buyClose.qty,
          filled_qty: buyClose.qty,
          avg_price: buyClose.fill_price,
          fee: buyClose.fee_usd,
          raw: {
            side: "sell",
            price: buyQuote.bid,
            fill_price: buyClose.fill_price,
            slippage_bps: SLIPPAGE_BPS,
            fee_bps: FEE_BPS,
            notional_usd: notionalUsd
          }
        },
        {
          position_id: position.id,
          leg: "spot_buy",
          requested_qty: sellClose.qty,
          filled_qty: sellClose.qty,
          avg_price: sellClose.fill_price,
          fee: sellClose.fee_usd,
          raw: {
            side: "buy",
            price: sellQuote.ask,
            fill_price: sellClose.fill_price,
            slippage_bps: SLIPPAGE_BPS,
            fee_bps: FEE_BPS,
            notional_usd: notionalUsd
          }
        }
      ];

      const { error: execError } = await adminSupabase
        .from("executions")
        .insert(execPayload);

      if (execError) {
        throw new Error(execError.message);
      }

      reservedCurrent = Number((reservedCurrent - notionalUsd).toFixed(2));
      await adminSupabase
        .from("paper_accounts")
        .update({ reserved_usd: Math.max(0, reservedCurrent), updated_at: new Date().toISOString() })
        .eq("id", account.id);

      closed += 1;
      continue;
    }

    skipped += 1;
    reasons.push({ position_id: position.id, reason: "unsupported_type" });
  }

  return { attempted, closed, skipped, reasons };
}
