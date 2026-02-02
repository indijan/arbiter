# Arbiter — Spot–Perp Arbitrage Platform (Paper → Live)

Arbiter egy Next.js + Supabase alapú platform, amely kripto spot–perp (perpetual futures) market-neutral stratégiákat figyel, modellez, jelzi az opportunity-ket, és **először paper-trading (szimulált) módban** végrehajtási szimulációt futtat. Ha a modell és tesztek stabilak, akkor kapcsolható élő tőkére.

## Alapelvek
- **Valós piaci körülmények modellezése**: bid/ask, fee, slippage, latency buffer.
- **Először csak paper-trading**: nincs éles order küldés, nincs valódi tőzsdei végrehajtás.
- **Auditálhatóság**: minden szimulált “execution” naplózva (position/execution log).
- **Kockázatkezelés**: limit-ek, circuit breaker, kill switch (későbbi sprint).

## Stack
- Next.js (App Router) + TypeScript
- Supabase (Auth, Postgres, Realtime, Edge Functions)
- pnpm

## Repo struktúra
