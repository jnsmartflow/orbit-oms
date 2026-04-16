# Context Update v64

## NEW/MODIFIED FILES

- `Parse-MailOrders-v6_2.ps1` — **NEW** — Parser v6.2.0. Replaces v6.1 on depot PC. Location: `C:\Users\HP\OneDrive\VS Code\mail-orders\`

## BUSINESS RULES ADDED

**Parser v6.2.0 — 8 changes from v6.1:**

1. **Bag/bags + retail stripping:** Normalize-Line strips "bag/bags" as piece suffixes and "retail" as noise word. Fixes "25Kg Retail*8 bag" → "25*8".

2. **Per-segment carton detection:** When a comma-split line has multiple segments, carton flag (`isCarton`) is per-segment, not per-line. Only the segment containing a carton word (cartoon/carton/ctn/box) gets `isCarton=true`. Variable `$segIsCarton` used inside the `foreach ($rawSeg)` loop; all P3-P7b product row emissions use `$segIsCarton`.

3. **Delivery keyword concatenation guard:** Pre-processing join logic has extra condition `$line -notmatch "(?i)\bdelivery\b"`. Lines containing "delivery" are never concatenated with the next product line. They fall through to remark classification instead.

4. **Zero-skip fallback:** When `$parsed.ProductRows.Count -eq 0`, parser POSTs `$mail.Body` as a single raw-text line (qty=0, no pack) instead of skipping. Terminal shows `[RAW]` in dark yellow. Every FW: order email reaches OrbitOMS — no silent disappearance.

5. **P7 $Matches fix (critical):** In Extract-ProductLines P7 block, two `-match` operations were chained: `$seg -match "^(.*?)\s+(\d{1,4})\s*$" -and $seg -match "[A-Za-z]"`. The second `-match` overwrote `$Matches`, causing `$Matches[1].Trim()` to crash on null. Fix: swapped order so `[A-Za-z]` check (no capture groups) runs first, capture-group regex runs second. This was the root cause of 8 emails crashing with "null-valued expression".

6. **Parse-EmailBody try-catch wrapper:** The `Parse-EmailBody` call in the main loop is wrapped in `try { } catch { }`. If it crashes, a minimal `$parsed` is built with empty ProductRows, triggering the zero-skip fallback. Null guards on `$mail.Body`, `$mail.Subject`, `$mail.ReceivedTime`, `$mail.SenderName` using PS 5.1 compatible `try { $var = expr } catch { $var = fallback }` syntax (NOT `$var = try { } catch { }` which is PS 7+ only).

7. **Diagnostic logging:** Classify-Email logs every skip reason (`CLASSIFY-SKIP` with reason). Main loop logs every unprocessed email before classification (`SCAN` with subject, sender, time, entryId). Parse-EmailBody crash logs stack trace (`CRASH-TRACE`). Enhanced catch block logs subject name and error. Per-email parse summary (`PARSED` with body length, bodyLines, products, remarks, joins, deliveryBlocks, cartons, bills, carry-forward state, body customer).

8. **Lowercase x normalization:** Normalize-Line converts `(\d+)\s*x\s*(\d+)` to `$1*$2`. Handles "4x4", "1x13" typed from phone. Only fires between two numbers — safe for product names like "Max", "Texture".

**PS 5.1 compatibility rule:** `$x = try { expr } catch { fallback }` does NOT work in PowerShell 5.1 (depot PC). Must use statement form: `$x = default; try { $x = expr } catch { $x = fallback }`.

## PENDING ITEMS

1. **Carry-forward base spilling** — `$script:CarryBase` bleeds into subsequent lines that have their own product keyword. E.g., "Satin 90" sets CarryBase="90", then "Gloss Blk 1 6" inherits base "90" in rawText. Enrichment handles it correctly (DIRECT products ignore base), but rawText is wrong. Fix: reset CarryBase when a new product keyword is detected.
2. **Per-segment carton production verification** — Logic is sound but no real carton email has been tested with v6.2 yet.
3. **Multi-delivery bill splitting (v6.3)** — "Maruti Enterprise Delivery" / "Shiv Shakti Delivery" sections currently go to remarks. Future: auto-detect delivery headers and split into separate bills.
4. **Tinter shortcode enrichment coverage** — Codes like BU, NO, OR, XR, MA, GR, YE, Wht, Blk, Oxr now parse correctly. Enrichment depends on whether these exist in `mo_product_keywords` and `mo_sku_lookup`.

## CHECKLIST UPDATES

- **Parser version:** v6.2.0. File: `Parse-MailOrders-v6_2.ps1`. Update Task Scheduler on depot PC. Keep v6.1 as backup.
- **Zero-skip guarantee:** Every FW: order email reaches OrbitOMS. No silent SKIPs. Worst case = 1 raw-text unmatched line.
- **P7 $Matches rule:** In any `-and` chain with multiple `-match` operations, the regex WITHOUT capture groups must come FIRST. The regex WITH capture groups must come LAST (so `$Matches` has correct values).
- **PS 5.1 try-catch rule:** Never use `$x = try { } catch { }` — PS 7+ only. Always use `$x = default; try { $x = expr } catch { $x = fallback }`.
- **Log file diagnostics:** Check `mail_order.log` for: `CLASSIFY-SKIP` (why email was skipped), `SCAN` (every email seen), `CRASH-TRACE` (parse crash location), `PARSED` (per-email summary with all counters), `DELIVERY-BLOCK` (delivery guard activated).
