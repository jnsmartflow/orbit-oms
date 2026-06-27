# Session draft — Mail Parser v7.2: App-format path
# Date: 2026-06-19 · Source: Claude Code session
# Consolidate into: CLAUDE_MAIL_ORDERS.md §3 (Parser) + new §3.x (App path)
# Status: BUILT + BENCH-TESTED (21/21). DEPLOY PENDING (runs on separate PC).

---

## What changed (one line)
The parser now has TWO readers behind one sorter: the existing **human** reader (untouched) and a
new **app** reader for OrbitOMS app-generated orders. A sorter routes each email to the right one.

## The sorter — Test-IsAppFormat
- Returns `$true` when the **first real content line** (after the forward-header/BEWARE strip) starts with
  `Bill To:` (case-insensitive). Else `$false`.
- First-line anchor on purpose — a stray "bill to" buried mid-email never misroutes.
- Wired in the MAIN LOOP before the parse call:
  `$isApp = Test-IsAppFormat $mail` → `Parse-AppBody` if app, else `Parse-EmailBody`.

## The app reader — Parse-AppBody ($mail, $ignoreRemarks, $classificationKeywords)
- Mirrors Parse-EmailBody for sender/subject/date + the BEWARE/Subject body-strip.
- Reads a **header block** by label (order-independent), stopping at the first non-label line.
- REUSES `Normalize-Line` + `Extract-ProductLines` for product/Bill lines (no new product logic).
  - Strips leading Sr No `^\d+\.\s*` per line (handles `1.` `2.` …).
  - The ` - ` separator between product/base and packs is handled by the existing engine (same as
    human `Name- 10*3`). Multi-pack comma lists expand to one row per pack.
  - `Bill 1/2/3` emit `__BILL_MARKER__` rows → existing main-loop bill-split handles multi-bill.
- Returns the SAME keys as Parse-EmailBody PLUS: `AppDispatchStatus`, `AppDispatchPriority`,
  `AppShipToOverride`.

## App email TEMPLATE (the locked format the app sends)
```
Subject: Order — {CUSTOMER NAME} {CODE}

Bill To: {CUSTOMER NAME} ({CODE})        <- REQUIRED, must be first content line (sorter signal)
Ship To: {NAME} ({CODE})                 <- optional
Dispatch: {Normal | Urgent | Call ...}   <- optional
Remark: {order tag(s)}                    <- optional
Note: {free text}                         <- optional

1. {PRODUCT [BASE]} - {PACK}*{QTY}, {PACK}*{QTY}, …    <- Sr No prefix + " - " separator + multi-pack
2. …
Bill 2                                    <- multi-bill marker (single-bill has none)
3. …
```
- Header labels may appear in ANY order; all optional except `Bill To:`.
- (Older template used `Customer:` — renamed to `Bill To:` 2026-06-19 to be a unique sort signal.)

## Label → field mapping
| Label | → field | Notes |
|---|---|---|
| `Bill To: NAME (CODE)` | BodyCustomerName / BodyCustomerCode | code pulled from `(\d{4,7})` |
| `Ship To: NAME (CODE)` | DeliveryRemarks + AppShipToOverride=$true | server delivery-match.ts resolves real ship-to |
| `Dispatch: Urgent` | AppDispatchPriority="Urgent" | |
| `Dispatch: Call …` | AppDispatchStatus="Hold" | any "call" (Call to SO / Call to Dealer). Full text kept as an `instruction` remark so operator sees WHO to call. Business rule: "Hold" is never written directly. |
| `Dispatch: Normal` | default Dispatch/Normal | |
| `Remark: …` | RemarkRow (verbatim) | order tags: `Truck Order` / `Bounce` / `DTS` / `Cross Billing from {city}`. Contains "cross" → RemarkType="cross"; else "instruction". |
| `Note: …` | RemarkRow, RemarkType="instruction" | free text |

Dispatch is a closed set in the app: **Normal / Urgent / Call** (Call has sub-value **SO / Dealer**).
Order-remark tags are a closed set: **Truck / Cross (+From city) / Bounce / DTS** (multi-select).

## Main-loop wiring (the only existing-code edits)
- EDIT 1: sorter + route `Parse-AppBody` vs `Parse-EmailBody`.
- EDIT 2: when `$isApp`, dispatch/ship-to come from the App* fields (with safe fallbacks);
  else the original Get-DispatchStatus / Check-KeywordMatch path runs unchanged.
- Everything else (section-split, bill-split, Send-ToApi) is shared and unchanged — works for both
  because Parse-AppBody returns the same shape.

## Engineering notes
- Human path is **byte-for-byte untouched**. All work additive (two new functions + two scoped main-loop edits + two tiny tweaks inside Parse-AppBody). No schema change — app labels feed existing mo_orders fields.
- File must stay **UTF-8 with BOM** (PS 5.1; re-saved via ReadAllText-as-UTF8 → WriteAllText with BOM).

## Test harness — docs/Parser/test-app-parser.ps1 (KEEP — reusable regression bench)
- Loads ONLY the parser's functions: slice the file text BEFORE `#region STARTUP`, write to a temp .ps1
  with a dummy config.txt beside it, dot-source it (skips STARTUP + MAIN LOOP). Stub keywords.
- 6 samples (3 app incl. multi-bill / Cross / Call-Dealer / new Sr-No+dash format, 2 human, 1 BEWARE),
  21 assertions. Last run: **21/21 pass**.
- NOTE: product NAME→SKU matching is stubbed (empty keywords) — verify that on a real email with live keywords.

## Parser location (important)
- EDITING copy now in repo: `...\orbit-oms\docs\Parser\Parse-MailOrders-V7.ps1` (v7.2).
- LIVE copy runs on a SEPARATE PC, in the `...\mail-orders\` folder (config.txt / logs / processed_ids beside it).
- Deploy = manual: back up live file → paste v7.2 over it (same name, UTF-8 BOM) → STOP the running
  loop process → start fresh. No Vercel deploy.

## OPEN / DEFERRED
- [ ] Deploy v7.2 to the running PC + restart (owner will do post-template-finalisation).
- [ ] Live verification: product NAME→SKU match on a real app order (offline test stubbed keywords).
- [ ] Order-tag badges: `Truck Order` / `Bounce` / `DTS` → dedicated badges via OrbitOMS tag-catalog.
      Parser delivers the text now; badge wiring later (need meanings for Bounce / DTS). Cross already typed.
- [ ] Doc version drift: CLAUDE_MAIL_ORDERS.md header still says "Parser v6.5" — actual is v7.x → v7.2.
      Update on consolidation.
