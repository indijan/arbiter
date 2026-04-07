import "server-only";

// Human-readable Hungarian labels for executor prefilter/skip reasons.
// Keep these short (1 line) so they fit UI chips/tooltips.

const HU: Record<string, { title: string; detail: string }> = {
  symbol_not_allowed: {
    title: "Symbol nincs engedelyezve",
    detail: "Ez a symbol nincs benne a PAPER_ALLOWED_SYMBOLS allowlistben, ezért nem nyitunk rá."
  },
  relative_strength_symbol_blocked: {
    title: "Symbol tiltva (lane)",
    detail: "Ez a symbol nincs a lane allowlistben, ezért a lane nem nyithat rá."
  },
  missing_symbol: {
    title: "Hibas opportunity",
    detail: "Az opportunity-ben hianyzik a symbol."
  },
  type_not_allowed: {
    title: "Nem jóváhagyott stratégia",
    detail: "Mostantól csak a jóváhagyott lane-ek nyithatnak, más stratégia-family nem."
  },
  symbol_disabled: {
    title: "Symbol célzottan tiltva",
    detail: "Ez a symbol erre a stratégia-familyre külön le van tiltva."
  },
  break_even_too_long: {
    title: "Túl lassú megtérülés",
    detail: "A break-even idő túl hosszú ehhez a beállításhoz, ezért nem nyitunk."
  },
  xarb_below_min_edge: {
    title: "Xarb edge túl kicsi",
    detail: "A xarb nettó edge nem éri el a minimumot."
  },
  live_edge_below_threshold: {
    title: "Élő árakon nincs előny",
    detail: "A valós idejű árakon a nettó előny a küszöb alá esett (költségek + csúszás)."
  },
  stale_xarb_signal: {
    title: "Túl régi jel (xarb)",
    detail: "A jel már túl régi, nagy eséllyel elolvadt az árkülönbség."
  },
  stale_spread_reversion_signal: {
    title: "Túl régi jel (spread)",
    detail: "A mean reversion jel túl régi, ezért nem nyitunk rá."
  },
  stale_relative_strength_signal: {
    title: "Túl régi jel (lane)",
    detail: "A lane jel túl régi az engedett időablakhoz képest."
  },
  below_min_net_edge: {
    title: "Túl kicsi nettó előny",
    detail: "A nettó edge nem éri el a minimumot."
  },
  below_min_confidence: {
    title: "Alacsony megbízhatóság",
    detail: "A jel confidence értéke a minimum alatt van."
  },
  already_open: {
    title: "Már van nyitott pozíció",
    detail: "Erre az opportunity-re már van nyitott pozíció."
  },
  max_open_per_symbol: {
    title: "Túl sok nyitott ugyanarra",
    detail: "Az adott symbolra elértük a maximális nyitott pozíció számot."
  },
  insufficient_balance: {
    title: "Nincs elég szabad tőke",
    detail: "A szabad (nem lekötött) paper balance kevés ehhez a nyitáshoz."
  },
  blocked_symbol: {
    title: "Symbol tiltva",
    detail: "A symbol jelenleg blokkolva van a policy szerint."
  },
  xarb_auto_open_disabled: {
    title: "Xarb auto-open letiltva",
    detail: "A cross-exchange arb jelzések nyitása le van tiltva a beállításokban."
  },
  spread_reversion_auto_open_disabled: {
    title: "Spread auto-open letiltva",
    detail: "A spread mean reversion jelzések nyitása le van tiltva a beállításokban."
  },
  carry_auto_open_disabled: {
    title: "Carry auto-open letiltva",
    detail: "A carry jelzések nyitása le van tiltva a beállításokban."
  },
  tri_arb_auto_open_disabled: {
    title: "Tri-arb auto-open letiltva",
    detail: "A háromszög arbitrázs nyitása le van tiltva a beállításokban."
  },
  relative_strength_disabled: {
    title: "Lane-ek tiltva",
    detail: "A relative strength lane stratégia jelenleg nem engedélyezett."
  },
  relative_strength_lane_disabled: {
    title: "Lane standby/paused",
    detail: "A lane nincs ACTIVE állapotban, ezért nem fut."
  },
  lane_cooldown_active: {
    title: "Lane cooldown aktív",
    detail: "Ugyanarra a lane-re és symbolra túl hamar jött új jel, ezért most nem nyitunk újra."
  },
  candidate_canary_disabled: {
    title: "Canary jelölt tiltva",
    detail: "Ez egy jelölt (canary/validated) lane, ami nincs engedélyezve."
  }
};

export function rejectReasonHu(code: string | null | undefined) {
  const key = String(code ?? "").trim();
  if (!key) return { title: "-", detail: "-" };
  return HU[key] ?? { title: key, detail: "Nincs még lefordítva." };
}
