# Arbiter — System Architecture (Paper → Live)

## 1. Purpose

Arbiter is a Next.js + Supabase based platform for detecting, simulating, and eventually executing crypto spot–perpetual (perp) market-neutral arbitrage strategies.

The system is explicitly designed to:
- Model **real market conditions** (bid/ask, fees, slippage, latency)
- Run **paper-trading simulations first**
- Switch to **live execution only after extensive testing**

This document describes the **technical architecture and data flow**, not trading advice.

---

## 2. High-Level Architecture

The system consists of four main layers:

1. **Web Application (Next.js)**
2. **Backend Platform (Supabase)**
3. **Market Data & Strategy Logic**
4. **Execution Engine (Paper → Live)**

All critical logic runs **server-side**.  
The client is only a visualization and control layer.

---

## 3. Technology Stack

- Frontend: Next.js (App Router, TypeScript)
- Backend: Supabase (Auth, Postgres, Realtime, Edge Functions)
- Package manager: pnpm
- Execution model: Paper-first, Live gated by configuration

---

## 4. Core Design Principles

### 4.1 Paper-First Execution

All strategies must:
- Work in simulated mode
- Be statistically validated
- Pass risk constraints

**No strategy is allowed to execute live by default.**

---

### 4.2 Market-Realistic Simulation

Paper trading is NOT mid-price based.

Execution prices are modeled as:
- Buy → ask + slippage
- Sell → bid − slippage

Fees, latency buffers, and partial fills will be introduced progressively.

---

### 4.3 Market-Neutral Strategies Only

Initial scope includes only **delta-neutral** strategies:
- Spot long + Perpetual short
- No directional exposure
- No overnight risk assumptions

---

## 5. Data Flow (MVP)

### Step 1: Market Ingest
- Scheduled Edge Function fetches spot and perp bid/ask prices
- Funding rate and mark price are included if available
- Data is stored in `market_snapshots`

---

### Step 2: Opportunity Detection
- A detection job calculates:
  - Expected funding yield
  - Spread / basis
  - Fees and slippage
- Valid opportunities are stored in `opportunities`

---

### Step 3: User Interaction
- Users observe opportunities in real time
- Users may manually trigger **paper execution**
- No automatic live execution in MVP

---

### Step 4: Paper Execution Engine
- Creates a simulated position
- Generates simulated execution legs
- Tracks PnL and risk metrics
- Logs everything for audit

---

## 6. Execution Model

### 6.1 Paper Mode

Paper execution simulates:
- Order fill price
- Execution fee
- Slippage
- Latency buffer

All executions are recorded in the database.

---

### 6.2 Live Mode (Future Phase)

Live execution will require:
- Explicit user opt-in
- Encrypted API key storage
- Risk limits and kill switch
- Manual enable per exchange account

---

## 7. Data Model Overview

Key tables (simplified):

- `market_snapshots`
- `opportunities`
- `positions`
- `executions`
- `exchange_accounts`
- `users / profiles`

Row Level Security (RLS) ensures full data isolation between users.

---

## 8. Risk Management (Baseline)

Baseline controls:
- Max position size
- Max leverage (perp side)
- Delta neutrality checks
- Execution sanity checks

Advanced controls are added only after stability is proven.

---

## 9. Non-Goals (MVP)

The MVP explicitly does NOT include:
- High-frequency trading
- Millisecond arbitrage
- Fully automated live execution
- Multi-strategy portfolio management

---

## 10. Evolution Path

1. Paper simulation with historical + live market data
2. Statistical validation of strategies
3. Limited live execution with strict caps
4. Gradual scaling and strategy expansion

---

## 11. Summary

Arbiter is built as a **risk-first, paper-first** arbitrage system.

The goal is **not speed**, but:
- correctness
- auditability
- survivability in real markets
