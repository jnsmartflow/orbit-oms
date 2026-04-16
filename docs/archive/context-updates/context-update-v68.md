# Context Update v68

## MODIFIED FILES

- `Parse-MailOrders-v6_3.ps1` — Parser v6.3.0. Base injection guard in `Send-ToApi` + script-scope fix.

## BUSINESS RULES ADDED

**Parser v6.3 — Base injection guard in Send-ToApi:** Before appending `_Base` to `rawText`, `Send-ToApi` checks if `ProductName` already contains a text-based base keyword (from `$script:BaseKW`, populated from API `/api/mail-orders/keywords`). If a base keyword like `WHITE`, `BR WHITE`, `BW`, `BRILLIANT WHITE` etc. is found via word-boundary match, `_Base` injection is skipped. The enrichment engine detects text-based bases from `rawText` directly.

**Script-scope requirement:** `$baseKW` is a local variable in `Process-Email`. `Send-ToApi` is a separate function and cannot read it. `$script:BaseKW` is set in `Process-Email` (after keyword fetch) and referenced in `Send-ToApi`. Any future function needing base keywords outside `Process-Email` must use `$script:BaseKW`.

**Root cause:** When an email has a numeric base line followed by a text-base line (e.g. `Promise int 92` then `Smartchoice int White`), the parser's carry-forward set `_Base=92` on the second line. `Send-ToApi` built `rawText = "Smartchoice int White 92"`. While enrichment still resolved correctly, the dirty rawText confused billing operators.

**No enrichment engine changes.** Debug endpoint confirmed `enrichLine()` correctly resolves text-based bases when rawText is clean.

**Duplicate customer keyword cleanup:** Duplicate `mo_customer_keywords` row (id=669, keyword `AMBIKA PAINTS` → code `327298`) deleted. Two distinct customers share the name "AMBIKA PAINTS" (327298 VAPI UPC, 102492 PARLE POINT LOCAL). With duplicate removed, future matches return `multiple` status for operator selection.

## PENDING ITEMS

1. **Deploy parser v6.3** — Copy `Parse-MailOrders-v6_3.ps1` to depot PC. Save with UTF-8 BOM. Replaces v6.2.
2. **Update Task Scheduler** — Point scheduled task to `Parse-MailOrders-v6_3.ps1`.

## CHECKLIST UPDATES

- **Parser version:** v6.3.0. Base injection guard in `Send-ToApi` using `$script:BaseKW`. Skips `_Base` append when `ProductName` contains a text-based base keyword.
- **Script-scope variables:** `$script:CarryProduct`, `$script:CarryBase`, `$script:BaseKW`. All three persist across function boundaries.
