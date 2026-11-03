# FINN — Financial Investment Agent

**An investor's attention is the scarce resource. FINN spends it carefully.**

FINN is a mobile-first agent for a 18-stock NSE portfolio. It **speaks first** — after every close it tells you the few things that changed and why they matter — and then **gets out of the way**: everything routine is collapsed, with the reason it was hidden. When you want depth, it **audits management** instead of summarising them: what did they promise on the last four earnings calls, and did the numbers deliver?

<!-- LIVE: https://<deployment-url> -->

| Today (push) | Alerts (your rules) | Research (pull) | Engine |
|---|---|---|---|
| "3 things need you. 9 worth knowing. 40 routine filings hidden." Results cards (Revenue/EBITDA/PBT/PAT, QoQ & YoY), people cards for management changes, unusual moves linked to the filing that likely caused them. 60-second spoken brief. Clear-to-zero. | Price ±X% and volume N× thresholds and the filing types allowed to interrupt you — set by you, applied instantly. | Any NSE ticker. **Promised vs delivered** with a credibility score, every quote verified word-for-word against the transcript and linked to its page. Trajectory, cash quality, balance sheet, bull vs bear. | What each step costs and which model does it. |

## Point of view

1. **Triage is the product.** A digest that lists 70 filings is a feed, not a filter. FINN ranks every filing 0–100, shows *why* it ranked it there, and hides the rest behind one line.
2. **Materiality is relative.** A ₹7 lakh GST penalty is noise for a ₹10 lakh-crore bank and news for a small-cap. FINN sizes every disclosed ₹ amount against market cap.
3. **One story, one card.** Results arrive as notice → filing → deck → press release → transcript. FINN folds them into one card ("+3 related") and retires the notice once results are out.
4. **A move needs a why.** Every unusual price/volume move is checked against material filings in the preceding two sessions — or flagged "no filing explains it", which is itself a signal.
5. **Analyse management, don't summarise them.** The research view leads with the promise audit, not a company description.
6. **Grounded or not shown.** Research uses only filed financials and the company's own transcripts. A quote the model extracts is shown only if it is found verbatim in the PDF; the count of discarded claims is displayed.

## Architecture

```
            screener.in (filings feed, financial tables, transcript & AR links → original BSE PDFs, EOD price/volume)
                  │
  PUSH  ── scripts/ingest.ts (GitHub Actions, 18:45 IST after close) ──────────────────────────────┐
        rules triage (free, ~80%) → batched Flash-Lite for the rest → group stories → enrich only    │
        what earned attention: results PDF → P&L pages only → Flash → EBITDA computed in code,       │
        cross-checked vs exchange table · management PDF → people → web-grounded bio                 │
                  └──► data/digest.json (committed → Vercel redeploys)                                │
                                                                                                      │
  PULL  ── /api/research?symbol=ANY (streams progress, NDJSON) ───────────────────────────────────────┘
        filed tables → lenses in code (CAGR, margins, D/E, cash cycle, cash conversion, flags)
        last 4 transcripts → Flash extracts guidance (quote+page) → verbatim check → Pro judges
        each promise vs reported numbers (delivered / partly / missed / goalposts moved / pending)
        → Pro bull/bear anchored to those numbers
  CLIENT  Next.js PWA · thresholds & window in localStorage · alerts computed on device (instant)
```

**Model routing & cost.** Rules → Gemini 2.5 Flash-Lite (classification, batched) → Flash (long-document extraction, thinking off) → Pro (two judgment calls only). Arithmetic never goes to a model. Every call is cached by a hash of its inputs, so a document is read once, ever. Each research report and the Engine tab show the call count and cost at paid list prices (the whole thing runs on the free tier). Quota errors fall back to the next model automatically.

## Run it

```bash
npm install
cp .env.example .env.local   # add a free key from aistudio.google.com/apikey
npm run ingest               # push pipeline → data/digest.json
npm run research             # precompute the demo research set (or: npm run research -- TCS)
npm run dev
```
Without a key FINN still runs: rules triage, results cards from exchange-reported tables, all numeric research lenses.

## Deliberately left out

- **A chat box.** The obvious interface puts the burden on the investor to ask. FINN's view is that it should already know what to say; research is one tap per company.
- **Intraday data, news, broker notes.** Out of scope by design — EOD and primary sources only.
- **Accounts/backend DB.** Preferences live on the device; the digest is a versioned JSON file in git — auditable and free.

## Known limits / next

- Screener's public filings endpoint returns each company's latest 5 filings; the daily job accumulates history. Production would read the exchange feed directly.
- Next: real web-push for critical items, per-holding position weights in the ranking, a "what changed since the last call" diff of guidance, and annual-report reading for contingent liabilities, RPTs and auditor remarks.
