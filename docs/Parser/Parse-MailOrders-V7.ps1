# ============================================================
#  Parse-MailOrders-V7_1.ps1
#  Mail Order Email Parser -> OrbitOMS API
#  Monitors Outlook for FW: order emails, parses product lines,
#  POSTs raw parsed data to OrbitOMS for server-side enrichment.
#  Also extracts dispatch data (status, priority, overrides).
# ============================================================
#  Version: 7.3.0
#  v7.3: App-only piece-pack peel in Parse-AppBody STEP C
#    Fix: /po emits piece packs as "1 pc*12" (CLAUDE_PLACE_ORDER.md §267, formatPack
#    PC -> "1 pc"). Normalize-Line §1b peels pcs|pic|pics|pieces|piece|nos|tin|tins|
#    bag|bags but NOT bare "pc" — the letter left of the star blocks every pack
#    detector (\d+\s*\*\s*\d+), so "1 pc*12" survives as an unrecognised remark
#    instead of a product row. App format is a fixed contract (always
#    "{pack} pc*{qty}"), so the peel is safe as an app-path-only fix in
#    Parse-AppBody — NOT added to the shared Normalize-Line, since human mail
#    places units freely (e.g. "5mm:1*18 tin") and needs its own handling.
#  v7.1: Fix "800" base code mapping — was incorrectly converting to "90 BASE"
#    Business rule: "800" = BRILLIANT WHITE (retail ready-mix, IN28080xxx series)
#    NOT 90 BASE (which is the SUPER SATIN tinting base IN28079xxx series)
#    Root cause: 4 hardcoded mapping sites established before business clarification
#    Fix sites: P5 (line ~676), P7 (line ~734), Resolve-ProductBase (~947, ~957)
#    All four flipped from "90 BASE" -> "BRILLIANT WHITE"
#    Verified data alignment: mo_base_keywords already maps 800 -> BRILLIANT WHITE,
#    and IN28080xxx SUPER SATIN BRILLIANT WHITE SKUs exist in mo_sku_lookup
#    Parser previously corrupted rawText (e.g. "Satin finish 800" -> "Satin finish 90 BASE"),
#    causing enrichment to score against wrong base and pick IN28079xxx (90 BASE) SKU
#    No SQL changes required. Historical mo_order_lines.rawText still contains
#    the corrupted "90 BASE" text — fix is going-forward only.
#  v7: Trailing punctuation strip in Normalize-Line
#    Fix: segments ending in "." or ";" silently dropped by Extract-SinglePackQty
#    Root cause: P3/P4/P2b regex anchors with \s*$ reject trailing period
#    Example failure (pre-v7): "Vt pearl glo:90:10*10,4*8,1*18." dropped 1*18
#                              "Vt pearl glo:br white :1*18." dropped 1*18
#    Fix location: Normalize-Line step 1r — strips \s*[.;]+\s*$ before return
#    Safety: mid-line decimals preserved (0.9L, 1.0*18, 3.30 pm all unchanged)
#            Header detection (Detect-SectionHeaders) runs on raw bodyLines,
#            unaffected by this change.
#    Verified: 40-case stress test, zero regression on mid-line decimals
#  v6.5: Multi-customer/delivery split + carry-forward hint + parser fixes
#    ITEM 3: Multi-pack comma insertion LOOP (was single-pass, missed 3+ groups)
#    ITEM 4: Digit-dash normalization with stainer code guard
#            "20-5" → "20*5" but "NO 1-4" stays (stainer protected)
#    ITEM 6: _CarryProduct field on each line for server-side carry-forward hint
#            Enrichment engine uses carry product as hint for colour-only lines
#    ITEM 1: Multi-customer truck orders — detect numbered customer headers,
#            split into separate orders per customer
#    ITEM 2: Multi-delivery bill splitting — detect delivery headers,
#            split into separate bills with deliveryRemarks
#    Detection: two-pass (customer headers first, delivery headers second)
#    Safety: minimum 2 headers required, product keyword disqualifies,
#            fallback to single-order mode when ambiguous
#  v6.4: Parser fixes from April 14 audit
#    P1. Normalize dash-before-star: 94-*6 -> 94*6
#    P2. Normalize trailing word-dash-digit: "Gva wht-6" -> "Gva wht 6"
#    P3. Material code + DN description on same line: treat as single entry
#    P4. Multi-pack star separator: "20*5 *1*18" -> "20*5,1*18"
#    P5. Material code + colon-qty: "5827811 ... 1L:6" -> matcode qty=6
#    P6. Carton suffix *Nc: "*3c" -> qty=3 isCarton=true
#    P7. Stainer range format: "NO 1-4" -> stainer code with qty
#  v6.3: Fix text-based base carry-forward injection in Send-ToApi
#    - Send-ToApi now checks if ProductName already contains a text-based
#      base keyword (BR WHITE, BW, BRILLIANT WHITE, etc.) from $baseKW
#    - When text has its own base keyword, skips _Base injection
#    - Prevents stale carry-forward numeric bases (e.g. "90") from
#      corrupting rawText when dealer wrote text bases like "br white"
#    - Enrichment engine detects text-based bases from rawText directly
#  v6.2: Production bug fixes from session v64
#      - bag/bags piece suffix stripping + "retail" noise word (Bug 1+2)
#      - Per-segment carton detection for comma-split lines (Bug 5)
#      - Delivery keyword guard: don't concatenate delivery headers with product lines (Bug 6)
#      - Zero-skip fallback: POST raw body as 1 unmatched line instead of skipping (Bug 7)
#      - Diagnostic logging in Classify-Email and main loop for invisible emails (Bug 9)
#  v6.1: Audit fixes from session v59
#      - Tinter code pattern: NO1-2, XY1-3, BLK-6 etc. (C1)
#      - Slash separator normalization: 1/18 -> 1*18 (C2)
#      - @ separator normalization: 20@5 -> 20*5 (C2b)
#      - New signal patterns: URGENT, DEAR DEPOT, N DAYS timing
#  v6: Complete line parsing rewrite — Normalize -> Split -> Extract
#      - Carton suffix detection (cartoon/c/box) with isCarton flag
#      - & divider normalization
#      - gm/ltr/ml unit stripping from pack codes
#      - Word-boundary keyword matching (no length threshold)
#      - Number-only continuation lines (base+pack+qty)
#      - Product-boundary detection within comma segments
#      - Piece suffix stripping (pcs/nos/tin)
#      - Area keyword classification
#  v5.1: Space-separated pack/qty detection using ValidPacks
#  v5: Line Classification Engine
#  v4: Parser fixes
#  v3: Dispatch extraction
#  v2: Enrichment moved to server
# ============================================================

#region CONFIG

# Load config from config.txt (same folder as this script)
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$ConfigFile = "$ScriptDir\config.txt"

if (-not (Test-Path $ConfigFile)) {
    Write-Host "FATAL: config.txt not found at $ConfigFile" -ForegroundColor Red
    Write-Host "Create config.txt with: ApiBaseUrl, HmacSecret, BaseDir, OutlookAccount, CheckInterval" -ForegroundColor Yellow
    exit
}

$Config = @{}
foreach ($line in (Get-Content $ConfigFile)) {
    $line = $line.Trim()
    if ($line -eq "" -or $line.StartsWith("#")) { continue }
    $parts = $line -split "=", 2
    if ($parts.Count -eq 2) {
        $Config[$parts[0].Trim()] = $parts[1].Trim()
    }
}

# Apply config
$BaseDir        = $Config["BaseDir"]
$ApiBaseUrl     = $Config["ApiBaseUrl"]
$HmacSecret     = $Config["HmacSecret"]
$OutlookAccount = $Config["OutlookAccount"]
$CheckInterval  = if ($Config["CheckInterval"]) { [int]$Config["CheckInterval"] } else { 10 }

if (-not $BaseDir -or -not $ApiBaseUrl -or -not $HmacSecret -or -not $OutlookAccount) {
    Write-Host "FATAL: config.txt missing required values (BaseDir, ApiBaseUrl, HmacSecret, OutlookAccount)" -ForegroundColor Red
    exit
}

# Derived paths
$LogFile             = "$BaseDir\mail_order.log"
$ProcessedIdsFile    = "$BaseDir\processed_ids_fw.json"
$SenderConfigFile    = "$BaseDir\accepted_senders.txt"
$RemarksFile         = "$BaseDir\Remarks.xlsx"

$ProcessedIdRetentionDays = 7
$ScriptVersion = "6.5.0"

#endregion


#region LOGGING

function Write-Log ($msg, $level = "INFO") {
    try {
        $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
        $line = "$ts [$level] $msg`r`n"
        [System.IO.File]::AppendAllText($LogFile, $line)
    } catch { }
}

#endregion


#region PROCESSED ID TRACKING

function Load-ProcessedIds {
    $ids = @{}
    if (-not (Test-Path $ProcessedIdsFile)) {
        Write-Log "No processed_ids_fw.json found - starting fresh"
        return $ids
    }
    try {
        $json = Get-Content $ProcessedIdsFile -Raw -ErrorAction Stop
        if ([string]::IsNullOrWhiteSpace($json)) { return $ids }
        $parsed = $json | ConvertFrom-Json
        foreach ($prop in $parsed.PSObject.Properties) {
            $ids[$prop.Name] = $prop.Value
        }
        Write-Log "Loaded $($ids.Count) processed FW IDs"
    } catch {
        Write-Log "Failed to load processed_ids_fw.json: $_ - starting fresh" "WARN"
        $ids = @{}
    }
    return $ids
}

function Save-ProcessedIds ($ids) {
    try {
        $cutoff = (Get-Date).AddDays(-$ProcessedIdRetentionDays)
        $pruned = @{}
        foreach ($key in @($ids.Keys)) {
            try {
                $ts = [datetime]::Parse($ids[$key])
                if ($ts -ge $cutoff) { $pruned[$key] = $ids[$key] }
            } catch {
                $pruned[$key] = $ids[$key]
            }
        }
        $pruned | ConvertTo-Json -Depth 1 -Compress | Set-Content $ProcessedIdsFile -Force
        return $pruned
    } catch {
        Write-Log "Failed to save processed IDs: $_" "ERROR"
        return $ids
    }
}

function Mark-AsProcessed ($ids, $entryId) {
    $ids[$entryId] = (Get-Date).ToString("o")
}

#endregion


#region LOAD CONFIG FILES

function Load-IgnoreRemarks {
    $words = @()
    if (-not (Test-Path $RemarksFile)) {
        Write-Log "Remarks.xlsx not found - no ignore list" "WARN"
        return $words
    }
    try {
        $xl = New-Object -ComObject Excel.Application
        $xl.Visible = $false
        $xl.DisplayAlerts = $false
        $wb = $xl.Workbooks.Open([System.IO.Path]::GetFullPath($RemarksFile))
        $ws = $wb.Worksheets.Item(1)
        $lastRow = $ws.Cells($ws.Rows.Count, 1).End(-4162).Row
        for ($r = 2; $r -le $lastRow; $r++) {
            $val = $ws.Cells.Item($r, 1).Value2
            if ($val) { $words += $val.ToString().Trim() }
        }
        $wb.Close($false)
        $xl.Quit()
        [System.Runtime.Interopservices.Marshal]::ReleaseComObject($xl) | Out-Null
        Write-Log "Loaded $($words.Count) ignore-remarks words"
    } catch {
        Write-Log "Failed to load Remarks.xlsx: $_" "WARN"
    }
    return $words
}

function Load-AcceptedSenders {
    $senders = @()
    if (-not (Test-Path $SenderConfigFile)) { return $senders }
    try {
        $lines = Get-Content $SenderConfigFile -ErrorAction Stop
        foreach ($line in $lines) {
            $trimmed = $line.Trim()
            if ([string]::IsNullOrWhiteSpace($trimmed)) { continue }
            if ($trimmed.StartsWith("#")) { continue }
            $senders += $trimmed.ToLower()
        }
        Write-Log "Loaded $($senders.Count) accepted senders"
    } catch {
        Write-Log "Failed to load accepted_senders.txt: $_" "WARN"
    }
    return $senders
}

function Load-Keywords ($filePath, $label) {
    $keywords = @()
    if (-not (Test-Path $filePath)) {
        Write-Log "$label keywords file not found: $filePath" "WARN"
        return $keywords
    }
    try {
        $lines = Get-Content $filePath -ErrorAction Stop
        foreach ($line in $lines) {
            $trimmed = $line.Trim()
            if ([string]::IsNullOrWhiteSpace($trimmed)) { continue }
            if ($trimmed.StartsWith("#")) { continue }
            $keywords += $trimmed.ToLower()
        }
        Write-Log "Loaded $($keywords.Count) $label keywords"
    } catch {
        Write-Log "Failed to load $label keywords: $_" "WARN"
    }
    return $keywords
}

function Check-KeywordMatch ($text, $keywords) {
    if (-not $text -or $keywords.Count -eq 0) { return $false }
    $lower = $text.ToLower()
    foreach ($kw in $keywords) {
        if ($lower.Contains($kw)) { return $true }
    }
    return $false
}

#endregion


#region V6 LINE PARSING ENGINE

# ── Signal patterns for remark detection ─────────────────────
$SignalPatterns = @{
    delivery    = @("DELIVERY", "CHALLAN", "GODOWN", "DISPATCH", "TRANSPORT", "LORRY", "TRUCK", "SITE DELIVERY", "HAND OVER", "LANDING", "UNLOADING")
    billing     = @("DPL", "CREDIT", "EXTENSION", "BOUNCE", "BILL TOMORROW", "BILL TOMMOROW", "BILL TOMOROW", "PUNCH", "7 DAYS", "OVERDUE", "URGENT", "FIRST TIME", "BILL TODAY", "SAVE ORDER", "DO SAVE")
    contact     = @("CONTACT NO", "CONTACT NUMBER", "MOBILE", "PHONE NO")
    instruction = @("PLEASE", "KINDLY", "STICKER", "SHADE CARD", "CALL SO", "CALL DEALER", "CALL TO DEALER", "CALL TO SO", "PROVIDE", "SHARE DPL", "ALSO PLACE", "DEALER NAME", "SEND INVOICE", "SHED CARD")
    cross       = @("CROSS BILLING", "CROSS BILL", "DO CROSS")
    noise       = @("SENT FROM OUTLOOK", "SENT FROM MY", "GET OUTLOOK", "REGARDS", "THANK YOU", "THANKS AND REGARDS", "HTTPS://", "HTTP://", "DEAR DEPOT", "DEAR SIR", "NOTE MY ORDER", "HIII", "HII")
}

# ── Valid pack codes ─────────────────────────────────────────
$ValidPacks = @(
    "1","2","3","4","5","10","15","20","22","25",
    "30","40","50","100","200","250","400","500"
)

# ── Base code patterns ───────────────────────────────────────
$BaseCodes = @("90","91","92","93","94","95","96","97","98","00","800")

# ── Fetch keywords from API ──────────────────────────────────
function Fetch-ClassificationKeywords {
    $keywordsUrl = $ApiBaseUrl -replace "/ingest$", "/keywords"
    Write-Host "DEBUG Keywords URL: '$keywordsUrl'" -ForegroundColor Magenta
    try {
        $response = Invoke-WebRequest -Uri $keywordsUrl -Method GET -UseBasicParsing -TimeoutSec 15
        $data = $response.Content | ConvertFrom-Json
        $productKW = @()
        $baseKW = @()
        $customerKW = @()
        $areaKW = @()
        foreach ($kw in $data.productKeywords) { $productKW += $kw.ToUpper() }
        foreach ($kw in $data.baseKeywords) { $baseKW += $kw.ToUpper() }
        if ($data.customerKeywords) {
            foreach ($kw in $data.customerKeywords) { $customerKW += $kw.ToUpper() }
        }
        if ($data.areaKeywords) {
            foreach ($kw in $data.areaKeywords) { $areaKW += $kw.ToUpper() }
        }
        Write-Log "Fetched keywords: $($productKW.Count) product, $($baseKW.Count) base, $($customerKW.Count) customer, $($areaKW.Count) area"
        Write-Host "Keywords: $($productKW.Count) product, $($baseKW.Count) base, $($customerKW.Count) customer, $($areaKW.Count) area" -ForegroundColor Cyan
        return @{ ProductKeywords = $productKW; BaseKeywords = $baseKW; CustomerKeywords = $customerKW; AreaKeywords = $areaKW }
    } catch {
        Write-Log "Failed to fetch classification keywords: $_ - engine will use signal patterns only" "WARN"
        Write-Host "WARNING: Could not fetch keywords: $_" -ForegroundColor Yellow
        return @{ ProductKeywords = @(); BaseKeywords = @(); CustomerKeywords = @(); AreaKeywords = @() }
    }
}

# ── Word-boundary keyword check ──────────────────────────────
function Test-KeywordWB ($text, $keyword) {
    # Word-boundary match — safe even for 2-char keywords
    # Skip single-char keywords (too many false positives)
    if ($keyword.Length -lt 2) { return $false }
    $escaped = [regex]::Escape($keyword)
    return ($text -match "\b$escaped\b")
}

# ── PHASE 1: NORMALIZE ──────────────────────────────────────
function Normalize-Line ($line) {
    # Returns @{ Text = "..."; IsCarton = $false }
    $result = @{ Text = $line; IsCarton = $false }
    $t = $line

    # 1a. Detect and strip carton suffixes
    if ($t -match "(?i)\d+(cartoon|cartton|carton|cartn|ctn|box|bx)") {
        $result.IsCarton = $true
        $t = $t -replace "(?i)(cartoon|cartton|carton|cartn|ctn|box|bx)", ""
    }
    # Single "c" after digit at word boundary: "2c" "3c"
    if ($t -match "\d+c\b" -and $t -notmatch "(?i)\d+c[a-bd-z]") {
        $result.IsCarton = $true
        $t = $t -replace "(\d+)c\b", '$1'
    }
    # Standalone carton/box word (with space): "100*1 cartoon"
    if ($t -match "(?i)\b(cartoon|carton|box)\b") {
        $result.IsCarton = $true
        $t = $t -replace "(?i)\b(cartoon|carton|box)\b", ""
    }

    # 1b. Strip piece suffixes (no multiplication)
    $t = $t -replace "(?i)(\d+)\s*(pcs|pic|pics|pieces|piece|nos|tin|tins|bag|bags)\b", '$1'
    $t = $t -replace "(?i)\b(pcs|pic|nos|tins?|bags?)\b", ""

    # 1c. Strip "Drums" suffix
    $t = $t -replace "(?i)\b[Dd]rums?\b", ""

    # 1d. Strip "All" prefix when before text
    $t = $t -replace "(?i)^All\s+", ""

    # 1e. Normalize dividers to *
    $t = $t -replace "&", "*"

    # 1f. Normalize unit-attached packs: 100gm -> 100, 1ltr -> 1, 500ml -> 500
    $t = $t -replace "(?i)(\d+)\s*(gm|g)\b", '$1'
    $t = $t -replace "(?i)(\d+)\s*(ml)\b", '$1'
    $t = $t -replace "(?i)(\d+)\s*(ltr|lt|litt|l)\b", '$1'
    $t = $t -replace "(?i)(\d+)\s*(kg|kgs)\b", '$1'

    # 1g. Normalize × to * (fullwidth multiply sign)
    $t = $t -replace [char]0x00D7, "*"

    # 1g2. Normalize lowercase x between digits: 4x4 -> 4*4, 1x13 -> 1*13
    $t = $t -replace "(\d+)\s*x\s*(\d+)", '$1*$2'

    # 1h. Strip noise words
    $t = $t -replace "(?i)\boil\s+paint\b", ""
    $t = $t -replace "(?i)\bgoes\s+years\b", ""
    $t = $t -replace "(?i)\bretail\b", ""

    # 1i. Normalize equals separator
    $t = $t -replace "\s*=\s*", " - "

    # 1j. Normalize slash separator: 1/18 -> 1*18, 4/8 -> 4*8
    # Only when both sides are numbers (avoid breaking text/paths)
    $t = $t -replace "(\d{1,3})/(\d{1,4})", '$1*$2'

    # 1k. Normalize @ separator: 20@5 -> 20*5
    $t = $t -replace "(\d{1,3})@(\d{1,4})", '$1*$2'

    # 1l. v6.4 P1: Normalize dash-before-star: 94-*6 -> 94*6
    $t = $t -replace "(\d+)-\*(\d+)", '$1*$2'

    # 1m. v6.4 P6: Detect carton suffix *Nc before stripping: *3c -> qty=3 isCarton
    if ($t -match "\*\d+c\b" -and $t -notmatch "(?i)\*\d+c[a-bd-z]") {
        $result.IsCarton = $true
        $t = $t -replace "(\*\d+)c\b", '$1'
    }

    # 1n. v6.4 P4: Multi-pack star separator: "20*5 *1*18" -> "20*5,1*18"
    # When space-star appears between two pack*qty groups, replace with comma
    $t = $t -replace "(\d+\*\d+)\s+\*(\d+\*\d+)", '$1,$2'

    # 1o. v6.4 P2: Trailing word-dash-digit at end of segment: "Gva wht-6" -> "Gva wht 6"
    # Only when preceded by letters (not "94-6" which is base-qty)
    $t = $t -replace "([A-Za-z])-(\d{1,3})\s*$", '$1 $2'

    # 1q. v6.5 ITEM 4: Digit-dash-digit at end of line: "20-5" -> "20*5"
    # Normalizes pack-dash-qty to pack*qty for product lines
    # STAINER GUARD: skip if text before dash is a 2-3 letter stainer code
    # Stainer codes: NO, BU, RE, OR, XR, MA, GR, YE, XY, BLK, WHT, COB, COG,
    #   HEY, HER, FFR, OXR, WH, YOX, TBL, MAG, LFY, GRN
    if ($t -match '(\d{1,3})-(\d{1,4})\s*$') {
        $beforeDash = ($t -replace '\d{1,3}-\d{1,4}\s*$', '').Trim()
        $isStainerCode = $false
        # Check if last word before the number is a stainer code
        if ($beforeDash -match '([A-Za-z]{2,3})\d?\s*$') {
            $codeCheck = $Matches[1].ToUpper()
            if ($codeCheck -match '^(NO|BU|RE|OR|XR|MA|GR|YE|XY|BLK|WHT|COB|COG|HEY|HER|FFR|OXR|WH|YOX|TBL|MAG|LFY|GRN)$') {
                $isStainerCode = $true
            }
        }
        # Also check if entire text before is a stainer code (e.g. "NO1")
        if (-not $isStainerCode) {
            $stripped = $beforeDash -replace '\s+', ''
            if ($stripped -match '^([A-Za-z]{2,3})\d?$') {
                $codeCheck2 = $Matches[1].ToUpper()
                if ($codeCheck2 -match '^(NO|BU|RE|OR|XR|MA|GR|YE|XY|BLK|WHT|COB|COG|HEY|HER|FFR|OXR|WH|YOX|TBL|MAG|LFY|GRN)$') {
                    $isStainerCode = $true
                }
            }
        }
        if (-not $isStainerCode) {
            $t = $t -replace '(\d{1,3})-(\d{1,4})\s*$', '$1*$2'
        }
    }

    # 1p. Collapse multiple spaces
    $t = $t -replace "\s{2,}", " "

    # 1r. v7: Strip trailing sentence punctuation (period, semicolon)
    # Runs after all normalization so only true end-of-line punctuation
    # is caught, never mid-line decimals (0.9L, 1.0*18, 3.30 pm preserved).
    # Fixes segment drop on lines like "Vt pearl glo:90:10*10,4*8,1*18."
    # where Extract-SinglePackQty regex anchors with \s*$ and rejects the
    # trailing period, silently dropping the last pack*qty segment.
    $t = $t -replace '\s*[.;]+\s*$', ''

    $result.Text = $t.Trim()
    return $result
}

# ── PHASE 2+3: SPLIT AND EXTRACT ────────────────────────────
function Extract-ProductLines ($normalizedText, [bool]$isCarton, $prodKW, $baseKW, $custKW, $areaKW) {
    # Input: normalized line text (after Phase 1)
    # Output: @{ ProductRows = @(...); RemarkRows = @(...); LastProduct = "..."; LastBase = "..." }

    $ProductRows = @()
    $RemarkRows = @()

    # Carry-forward state (persists across segments within this line)
    $lastProduct = $script:CarryProduct
    $lastBase = $script:CarryBase

    # Phase 2: Split by comma
    $segments = $normalizedText -split ","
    
    foreach ($rawSeg in $segments) {
        $seg = $rawSeg.Trim()
        if ([string]::IsNullOrWhiteSpace($seg)) { continue }

        # ── Per-segment carton override (v6.2) ───────────────
        # When line has multiple comma-split segments, only apply
        # isCarton to segments that actually contain a carton word
        $segIsCarton = $isCarton
        if ($segments.Count -gt 1) {
            $segHasCartonWord = ($rawSeg -match "(?i)(cartoon|cartton|carton|cartn|ctn|box|bx)\b") -or ($rawSeg -match "\d+c\b" -and $rawSeg -notmatch "(?i)\d+c[a-bd-z]")
            if ($isCarton -and -not $segHasCartonWord) {
                # Line-level carton flag is ON but THIS segment has no carton word — don't apply
                $segIsCarton = $false
            }
            if (-not $isCarton -and $segHasCartonWord) {
                # Line-level carton flag is OFF but THIS segment has a carton word — apply
                $segIsCarton = $true
            }
        }

        # ── P0: Noise check ──────────────────────────────────
        $upper = $seg.ToUpper()
        $isNoise = $false
        foreach ($category in $SignalPatterns.Keys) {
            if ($category -eq "noise") {
                foreach ($signal in $SignalPatterns[$category]) {
                    if ($upper.Contains($signal)) { $isNoise = $true; break }
                }
            }
            if ($isNoise) { break }
        }
        if ($isNoise) { continue }
        if ($seg.Length -le 1) { continue }

        # ── P1: Bill marker ──────────────────────────────────
        if ($seg -match "(?i)^\s*Bill\s*[\.\-:\s]*(?:No)?[\.\-:\s]*(\d+)\s*[\-:]?\s*$") {
            $ProductRows += @{
                ProductName = "__BILL_MARKER__"
                PackCode    = ""
                Quantity    = $Matches[1]
                IsCarton    = $false
            }
            continue
        }

        # ── P2: Material code ────────────────────────────────
        $noWsSeg = $seg -replace "\s+", ""
        if ($noWsSeg -match "^(IN)?\d{5,10}$") {
            # Material code with optional trailing qty
            if ($seg -match "^\s*((?:IN)?\d{5,10})\s*[-:.]?\s*(\d+)?\s*$") {
                $qty = if ($Matches[2]) { $Matches[2] } else { "1" }
                $ProductRows += @{
                    ProductName = $Matches[1].Trim()
                    PackCode    = "__MATERIAL_CODE__"
                    Quantity    = $qty
                    IsCarton    = $false
                }
                continue
            }
        }

        # ── P2b: v6.4 P3 — Material code + DN/DP/DPP description on same line ──
        # "5556514 DN SADOLIN EPOXY INSULATOR 1L*3c" → single entry using material code
        # "IN29316281 DN PROMISE ENML SMOKE GREY 20L*1" → single entry
        # Prevents double-parse: material code line + description line
        if ($seg -match "^\s*((?:IN)?\d{5,10})\s+(?:DN|DP|DPP|IP|ICI)\s") {
            $matCode = $Matches[1].Trim()
            # Extract trailing pack*qty if present
            $p2bQty = "1"
            $p2bPack = "__MATERIAL_CODE__"
            $p2bCarton = $segIsCarton
            if ($seg -match "(\d{1,3})\s*\*\s*(\d{1,4})\s*$") {
                $p2bPack = $Matches[1]
                $p2bQty = $Matches[2]
            }
            # Check for standalone trailing qty after L/ML: "1L:6" or "1L 6"
            elseif ($seg -match "(?i)\d+\s*(?:L|ML|LT|KG)\s*[:\s]\s*(\d{1,4})\s*$") {
                $p2bQty = $Matches[1]
            }
            $ProductRows += @{
                ProductName = $matCode
                PackCode    = $p2bPack
                Quantity    = $p2bQty
                IsCarton    = $p2bCarton
            }
            continue
        }

        # ── P2c: v6.4 P5 — Material code + colon-qty (no DN prefix) ──
        # "5827811 DPP-GVA 147 White 1L:6 tin" → material code, qty from colon
        if ($seg -match "^\s*((?:IN)?\d{5,10})\s+\S" -and $seg -match "(?i)(\d+)\s*(?:L|ML|LT|KG)\s*[:\s]\s*(\d{1,4})") {
            $matCode2 = ""
            if ($seg -match "^\s*((?:IN)?\d{5,10})") { $matCode2 = $Matches[1].Trim() }
            if ($matCode2) {
                # Get qty from the colon pattern
                $p2cQty = "1"
                if ($seg -match "(?i)\d+\s*(?:L|ML|LT|KG)\s*[:\s]\s*(\d{1,4})") {
                    $p2cQty = $Matches[1]
                }
                $ProductRows += @{
                    ProductName = $matCode2
                    PackCode    = "__MATERIAL_CODE__"
                    Quantity    = $p2cQty
                    IsCarton    = $segIsCarton
                }
                continue
            }
        }

        # ── Normalize segment-level separators ───────────────
        # Fix variant joined with pack: 90-1*9 -> 90 - 1*9
        if ($seg -match "\b\d{2,3}-\d+\*\d+") {
            $seg = $seg -replace '(\d{2,3})-(\d+\*\d+)', '$1 - $2'
        }
        # Fix period+space: "90. 1*6" -> "90 - 1*6"
        if ($seg -match "\b\d{2,3}\.\s+\d+\*\d+") {
            $seg = $seg -replace '(\d{2,3})\.\s+(\d+\*\d+)', '$1 - $2'
        }
        # Fix double-colon: MAX:92:20*2 -> MAX 92 - 20*2
        if ($seg -match "^([A-Za-z\s]+):(\d{2,3}):(\d+\*\d+)") {
            $seg = "$($Matches[1].Trim()) $($Matches[2]) - $($Matches[3])"
        }
        # Normalize slash between packs: "20*5 / 10*10" -> "20*5, 10*10"
        $seg = $seg -replace '(\d+\*\d+)\s*/\s*', '$1, '

        # ── P3: Explicit separator (contains NUM*NUM) ────────
        if ($seg -match "\d+\s*\*\s*\d+") {
            # Could be multi-pack: "Black 100*3 200*3 50*3" or single
            # Also handle product boundary: "50*2 burntseina 100*1"

            # Insert commas between adjacent pack*qty groups
            # v6.5 ITEM 3: LOOP until no more adjacent pairs (was single-pass in v6.4)
            $loopGuard = 0
            do {
                $prevSeg = $seg
                $seg = $seg -replace '(\d+\s*\*\s*\d+)\s+(\d+\s*\*\s*\d+)', '$1,$2'
                $loopGuard++
            } while ($seg -ne $prevSeg -and $loopGuard -lt 10)
            # Re-split if we added commas
            $subSegs = $seg -split ","
            
            foreach ($ss in $subSegs) {
                $ss = $ss.Trim()
                if ([string]::IsNullOrWhiteSpace($ss)) { continue }

                # Check for product boundary: text between pack*qty patterns
                # e.g. "50*2 burntseina 100*1" -> split at keyword
                if (($ss -split "\d+\s*\*\s*\d+").Count -gt 2) {
                    # Multiple pack*qty in one segment — check for product keyword between them
                    if ($ss -match "^(.*?\d+\s*\*\s*\d+)\s+([A-Za-z].*?\s+\d+\s*\*\s*\d+.*)$") {
                        $firstPart = $Matches[1].Trim()
                        $secondPart = $Matches[2].Trim()
                        # Check if secondPart starts with a product keyword
                        $hasKw = $false
                        foreach ($kw in $prodKW) {
                            if (Test-KeywordWB $secondPart.ToUpper() $kw) { $hasKw = $true; break }
                        }
                        if ($hasKw) {
                            # Split: process first part, then recurse on second
                            $subResult1 = Extract-SinglePackQty $firstPart $lastProduct $lastBase $segIsCarton $prodKW $baseKW
                            if ($subResult1) {
                                $ProductRows += $subResult1
                                $lastProduct = $subResult1.ProductName
                            }
                            $subResult2 = Extract-ProductLines $secondPart $segIsCarton $prodKW $baseKW $custKW $areaKW
                            $ProductRows += $subResult2.ProductRows
                            $RemarkRows += $subResult2.RemarkRows
                            continue
                        }
                    }
                }

                # Standard: extract product text + pack*qty
                $extracted = Extract-SinglePackQty $ss $lastProduct $lastBase $segIsCarton $prodKW $baseKW
                if ($extracted) {
                    $ProductRows += $extracted
                    if ($extracted.ProductName -ne "__BILL_MARKER__") {
                        $lastProduct = $extracted.ProductName
                        # Update base if the text had a base code
                        if ($extracted._Base) { $lastBase = $extracted._Base }
                    }
                }
            }
            continue
        }

        # ── P4: Space-separated with text (letters present) ──
        # "VT 90 1 36" or "Superclean 90 1 18" or "Promise 2in1 10 3"
        if ($seg -match "[A-Za-z]" -and $seg -match "\s(\d{1,3})\s+(\d{1,4})\s*$") {
            $possiblePack = $Matches[1]
            $possibleQty = $Matches[2]
            if ($ValidPacks -contains $possiblePack) {
                $textPart = ($seg -replace "\s+\d{1,3}\s+\d{1,4}\s*$", "").Trim()
                $prodAndBase = Resolve-ProductBase $textPart $lastProduct $lastBase $prodKW $baseKW
                $ProductRows += @{
                    ProductName = $prodAndBase.Product
                    PackCode    = $possiblePack
                    Quantity    = $possibleQty
                    IsCarton    = $segIsCarton
                    _Base       = $prodAndBase.Base
                }
                $lastProduct = $prodAndBase.Product
                $lastBase = $prodAndBase.Base
                continue
            }
        }

        # ── P5: Number-only with base code (3+ tokens, all digits) ──
        # "94 1 6" -> base=94, pack=1, qty=6
        if ($seg -match "^\s*(\d{1,3})\s+(\d{1,3})\s+(\d{1,4})\s*$" -and $seg -notmatch "[A-Za-z]") {
            $possibleBase = $Matches[1]
            $possiblePack = $Matches[2]
            $possibleQty = $Matches[3]
            if ($BaseCodes -contains $possibleBase -and $ValidPacks -contains $possiblePack) {
                # Base code + pack + qty — use carry-forward product
                # v7.1: "800" maps to BRILLIANT WHITE (retail), not 90 BASE (tinting)
                $baseName = if ($possibleBase -eq "800") { "BRILLIANT WHITE" } else { "$possibleBase" }
                $ProductRows += @{
                    ProductName = $lastProduct
                    PackCode    = $possiblePack
                    Quantity    = $possibleQty
                    IsCarton    = $segIsCarton
                    _Base       = $baseName
                }
                $lastBase = $baseName
                continue
            }
        }

        # ── P6: Number-only pair (2 tokens, all digits) ──────
        # "4 8" -> pack=4, qty=8 (carry-forward product)
        if ($seg -match "^\s*(\d{1,3})\s+(\d{1,4})\s*$" -and $seg -notmatch "[A-Za-z]") {
            $possiblePack = $Matches[1]
            $possibleQty = $Matches[2]
            if ($ValidPacks -contains $possiblePack -and $lastProduct) {
                $ProductRows += @{
                    ProductName = $lastProduct
                    PackCode    = $possiblePack
                    Quantity    = $possibleQty
                    IsCarton    = $segIsCarton
                    _Base       = $lastBase
                }
                continue
            }
        }

        # ── P6b: Multi-pair numbers "1 6 4 2" ───────────────
        if ($seg -match "^(\d+\s+\d+)(\s+\d+\s+\d+)+$" -and $lastProduct) {
            $tokens = $seg -split "\s+"
            for ($t = 0; $t -lt $tokens.Count - 1; $t += 2) {
                if ($ValidPacks -contains $tokens[$t]) {
                    $ProductRows += @{
                        ProductName = $lastProduct
                        PackCode    = $tokens[$t]
                        Quantity    = $tokens[$t + 1]
                        IsCarton    = $segIsCarton
                        _Base       = $lastBase
                    }
                }
            }
            continue
        }

        # ── P7: Product text + trailing number ───────────────
        # "Gloss 90" or "Product 6" — check if trailing num is base code
        # NOTE: Must check [A-Za-z] FIRST — second -match overwrites $Matches (v6.2 fix)
        if ($seg -match "[A-Za-z]" -and $seg -match "^(.*?)\s+(\d{1,4})\s*$") {
            $textPart = $Matches[1].Trim()
            $trailingNum = $Matches[2]

            # Is the trailing number a base code?
            if ($BaseCodes -contains $trailingNum) {
                # "Gloss 90" -> product + base, no line emitted
                $prodAndBase = Resolve-ProductBase $textPart $lastProduct $lastBase $prodKW $baseKW
                # v7.1: "800" maps to BRILLIANT WHITE (retail), not 90 BASE (tinting)
                $baseName = if ($trailingNum -eq "800") { "BRILLIANT WHITE" } else { "$trailingNum" }
                $lastProduct = $prodAndBase.Product
                $lastBase = $baseName
                # Check if text alone has a product keyword - only update carry-forward
                $hasProdKw = $false
                foreach ($kw in $prodKW) {
                    if (Test-KeywordWB $textPart.ToUpper() $kw) { $hasProdKw = $true; break }
                }
                if ($hasProdKw) {
                    # Product + base only, wait for pack*qty on next segment/line
                    continue
                }
            }

            # Trailing number is qty (no pack) — emit with pack=null
            if ($textPart.Length -gt 0) {
                $prodAndBase = Resolve-ProductBase $textPart $lastProduct $lastBase $prodKW $baseKW
                $ProductRows += @{
                    ProductName = ($prodAndBase.Product -replace "[:.=\-]", "").Trim()
                    PackCode    = ""
                    Quantity    = $trailingNum
                    IsCarton    = $segIsCarton
                    _Base       = $prodAndBase.Base
                }
                $lastProduct = $prodAndBase.Product
                $lastBase = $prodAndBase.Base
                continue
            }
        }

        # ── P7b: Tinter code pattern: NO1-2, XY1-3, BLK-6, WHT-1 etc. ──
        # 2-3 letter product code + optional digit + dash + qty
        if ($seg -match "^([A-Za-z]{2,3}\d?)\s*[\-]\s*(\d{1,3})$") {
            $tinterCode = $Matches[1].Trim()
            $tinterQty = $Matches[2]
            $ProductRows += @{
                ProductName = $tinterCode
                PackCode    = "1"
                Quantity    = $tinterQty
                IsCarton    = $segIsCarton
                _Base       = $lastBase
            }
            continue
        }

        # ── P7c: v6.4 P7 — Stainer code with space: "NO 1-4", "XY 1-4" ──
        # 2-3 letter code + space + digit + dash + qty
        # "NO 1-4" → NO1, qty=4 (the "1" is part of the code, "4" is qty)
        if ($seg -match "^([A-Za-z]{2,3})\s+(\d)\s*[\-]\s*(\d{1,3})$") {
            $stainerCode = "$($Matches[1].Trim())$($Matches[2])"
            $stainerQty = $Matches[3]
            $ProductRows += @{
                ProductName = $stainerCode
                PackCode    = "1"
                Quantity    = $stainerQty
                IsCarton    = $segIsCarton
                _Base       = $lastBase
            }
            continue
        }

        # ── P8: Signal/remark detection ──────────────────────
        $isRemark = $false
        $remarkType = ""
        $detectedBy = ""

        # Phone number
        if ($seg -match "\d{10,}") {
            $isRemark = $true; $remarkType = "contact"; $detectedBy = "pattern"
        }

        # Signal patterns
        if (-not $isRemark) {
            foreach ($category in $SignalPatterns.Keys) {
                if ($category -eq "noise") { continue }
                foreach ($signal in $SignalPatterns[$category]) {
                    if ($upper.Contains($signal)) {
                        $isRemark = $true; $remarkType = $category; $detectedBy = "pattern"
                        break
                    }
                }
                if ($isRemark) { break }
            }
        }

        # N DAYS pattern (45 DAYS, 28 DAYS, etc.) -> timing/billing
        if (-not $isRemark -and $upper -match "\b\d+\s*DAYS?\b") {
            $isRemark = $true; $remarkType = "billing"; $detectedBy = "pattern"
        }

        # "Tomorrow" pattern -> timing/billing
        if (-not $isRemark -and $upper -match "\bTOMORROW\b") {
            $isRemark = $true; $remarkType = "billing"; $detectedBy = "pattern"
        }

        # Customer keywords
        if (-not $isRemark -and $custKW.Count -gt 0) {
            foreach ($kw in $custKW) {
                if (Test-KeywordWB $upper $kw) {
                    $isRemark = $true; $remarkType = "customer"; $detectedBy = "keyword"
                    break
                }
            }
        }

        # Area keywords
        if (-not $isRemark -and $areaKW.Count -gt 0) {
            foreach ($kw in $areaKW) {
                if (Test-KeywordWB $upper $kw) {
                    $isRemark = $true; $remarkType = "area"; $detectedBy = "keyword"
                    break
                }
            }
        }

        if ($isRemark) {
            $RemarkRows += @{
                RawText    = $rawSeg.Trim()
                RemarkType = $remarkType
                DetectedBy = $detectedBy
            }
            continue
        }

        # ── P9: Product name only (no numbers) ──────────────
        if ($seg -notmatch "\d") {
            # Check product keywords
            $hasProdKw = $false
            foreach ($kw in $prodKW) {
                if (Test-KeywordWB $upper $kw) { $hasProdKw = $true; break }
            }
            $hasBaseKw = $false
            foreach ($kw in $baseKW) {
                if (Test-KeywordWB $upper $kw) { $hasBaseKw = $true; break }
            }
            if ($hasProdKw -or $hasBaseKw) {
                # Product/base name — update carry-forward, don't emit
                $prodAndBase = Resolve-ProductBase $seg $lastProduct $lastBase $prodKW $baseKW
                $lastProduct = $prodAndBase.Product
                $lastBase = $prodAndBase.Base
            } else {
                # Unknown text — probably remark
                $wordCount = ($seg -split "\s+").Count
                $rt = if ($wordCount -le 2) { "unknown" } else { "unknown" }
                $RemarkRows += @{
                    RawText    = $rawSeg.Trim()
                    RemarkType = $rt
                    DetectedBy = "unknown"
                }
            }
            continue
        }

        # ── P10: Fallback — unknown ─────────────────────────
        # Has some content but matched nothing above
        $RemarkRows += @{
            RawText    = $rawSeg.Trim()
            RemarkType = "unknown"
            DetectedBy = "unknown"
        }
    }

    # Update script-level carry-forward
    $script:CarryProduct = $lastProduct
    $script:CarryBase = $lastBase

    return @{ ProductRows = $ProductRows; RemarkRows = $RemarkRows }
}

# ── Helper: Extract single pack*qty segment ──────────────────
function Extract-SinglePackQty ($seg, $lastProduct, $lastBase, $isCarton, $prodKW, $baseKW) {
    # Handles: "Black 100*3", "200*3", "Gloss 92 1*12", etc.
    if ($seg -match "^(.*?)\s*[-:]?\s*(\d{1,4})\s*\*\s*(\d{1,4})\s*$") {
        $textPart = $Matches[1].Trim()
        $packCode = $Matches[2]
        $quantity = $Matches[3]

        # Clean text part
        $textPart = ($textPart -replace "[:.=\-]+$", "").Trim()

        if ([string]::IsNullOrWhiteSpace($textPart)) {
            # No product text — use carry-forward
            return @{
                ProductName = $lastProduct
                PackCode    = $packCode
                Quantity    = $quantity
                IsCarton    = $isCarton
                _Base       = $lastBase
            }
        }

        $prodAndBase = Resolve-ProductBase $textPart $lastProduct $lastBase $prodKW $baseKW
        return @{
            ProductName = $prodAndBase.Product
            PackCode    = $packCode
            Quantity    = $quantity
            IsCarton    = $isCarton
            _Base       = $prodAndBase.Base
        }
    }
    return $null
}

# ── Helper: Resolve product + base from text ─────────────────
function Resolve-ProductBase ($text, $lastProduct, $lastBase, $prodKW, $baseKW) {
    $upper = $text.Trim().ToUpper()
    $product = $lastProduct
    $base = $lastBase

    # Check if text is a 2-3 digit variant code (base code continuation)
    if ($upper -match "^(\d{2,3})$") {
        $code = $Matches[1]
        if ($BaseCodes -contains $code) {
            # v7.1: "800" maps to BRILLIANT WHITE (retail), not 90 BASE (tinting)
            $base = if ($code -eq "800") { "BRILLIANT WHITE" } else { "$code" }
            return @{ Product = $product; Base = $base }
        }
    }

    # Check if text ends with a variant code: "Gloss 92" -> product=Gloss, base=92
    if ($upper -match "^(.*\D)\s+(\d{2,3})$") {
        $namePart = $Matches[1].Trim()
        $codePart = $Matches[2]
        if ($BaseCodes -contains $codePart) {
            # v7.1: "800" maps to BRILLIANT WHITE (retail), not 90 BASE (tinting)
            $base = if ($codePart -eq "800") { "BRILLIANT WHITE" } else { "$codePart" }
            # Resolve the name part as product
            $subResult = Resolve-ProductBase $namePart $lastProduct $lastBase $prodKW $baseKW
            return @{ Product = $subResult.Product; Base = $base }
        }
    }

    # Check product keywords (word-boundary)
    $bestLen = 0
    foreach ($kw in $prodKW) {
        if ($kw.Length -gt $bestLen -and (Test-KeywordWB $upper $kw)) {
            $bestLen = $kw.Length
            # We don't have the product mapping here — just use the cleaned text as product name
            $product = ($text -replace "[:.=\-]", "").Trim()
        }
    }

    if ($bestLen -eq 0) {
        # No keyword match — if text is all-alpha short, might be product name
        $product = ($text -replace "[:.=\-]", "").Trim()
    }

    return @{ Product = $product; Base = $base }
}

#endregion


function Get-DispatchPriority ($subject, $deliveryRemarks, $remarks) {
    $combined = "$subject $deliveryRemarks $remarks"
    if ($combined -match "(?i)urgent") { return "Urgent" }
    return "Normal"
}

function Get-DispatchStatus ($subject, $deliveryRemarks, $remarks) {
    $combined = "$subject $deliveryRemarks $remarks"
    if ($combined -match "(?i)(hold|call\s*(to\s*)?so|call\s*(to\s*)?dealer)") { return "Hold" }
    return "Dispatch"
}

function Extract-SubjectSignals ($subject) {
    $signals = @{
        CustomerCode    = ""
        BillTomorrow    = $false
        Extension       = $false
        CrossBilling    = ""
        OdCi            = $false
        SubjectRemarks  = @()
    }

    if (-not $subject) { return $signals }

    if ($subject -match "\b(\d{6,7})\b") {
        $signals.CustomerCode = $Matches[1]
    }

    if ($subject -match "(?i)bill\s+tomorrow|(?i)bill\s+tommorow") {
        $signals.BillTomorrow = $true
        $signals.SubjectRemarks += "Bill tomorrow"
    }

    if ($subject -match "(?i)extension") {
        $signals.Extension = $true
        $signals.SubjectRemarks += "Extension"
    }

    if ($subject -match "(?i)cross\s*billing\s*(\w+)?") {
        $crossCode = if ($Matches[1]) { $Matches[1].Trim() } else { "" }
        $signals.CrossBilling = if ($crossCode) { "Cross billing $crossCode" } else { "Cross billing" }
        $signals.SubjectRemarks += $signals.CrossBilling
    }

    if ($subject -match "\bOD\b" -or $subject -match "(?i)\bCI\b" -or $subject -match "(?i)credit\s*(hold|block|issue)") {
        $signals.OdCi = $true
        $signals.SubjectRemarks += "OD/CI"
    }

    if ($subject -match "(?i)\bCIC\b") {
        $signals.SubjectRemarks += "CIC"
    }

    if ($subject -match "(?i)bounce") {
        $signals.SubjectRemarks += "Bounce"
    }

    return $signals
}

function Build-BillRemarks ($subjectSignals, $bodyBillRemarks, $bodyRemarks) {
    $parts = @()

    if ($subjectSignals.SubjectRemarks.Count -gt 0) {
        $parts += $subjectSignals.SubjectRemarks
    }

    if (-not [string]::IsNullOrWhiteSpace($bodyBillRemarks)) {
        $parts += $bodyBillRemarks
    }

    if (-not [string]::IsNullOrWhiteSpace($bodyRemarks)) {
        $remarkParts = $bodyRemarks -split ";\s*"
        foreach ($rp in $remarkParts) {
            $rp = $rp.Trim()
            if ($rp -match "(?i)(DPL|7\s*days|credit|extension|bounce|bill\s+tomorrow|bill\s+tommorow|punch)") {
                if ($parts -notcontains $rp) {
                    $parts += $rp
                }
            }
        }
    }

    return ($parts -join "; ")
}

# ── Extract customer info from email body ───────────────────
function Extract-BodyCustomer ($bodyLines, $prodKW) {
    # Scans the first non-empty body lines looking for explicit
    # customer name/code patterns. Stops when a product keyword
    # is found (everything after = product data).
    # Returns @{ CustomerName = "..."; CustomerCode = "" }

    $result = @{ CustomerName = ""; CustomerCode = "" }
    $lineCount = 0
    $maxLines = 10

    foreach ($line in $bodyLines) {
        $trimmed = $line.Trim()
        if ([string]::IsNullOrWhiteSpace($trimmed)) { continue }
        $lineCount++
        if ($lineCount -gt $maxLines) { break }

        # Stop if line contains a product keyword
        if ($prodKW -and $prodKW.Count -gt 0) {
            $hasProdKw = $false
            foreach ($kw in $prodKW) {
                if (Test-KeywordWB $trimmed.ToUpper() $kw) {
                    $hasProdKw = $true; break
                }
            }
            if ($hasProdKw) { break }
        }

        # Pattern 1: Labeled customer line
        # "Customer: Ravi Paints", "Dealer Name: ABC", "Party: XYZ"
        if ($trimmed -match "(?i)^\s*(Customer|Dealer|Party)\s*(Name)?\s*[:\-]\s*(.+)$") {
            $name = $Matches[3].Trim()
            # Check for trailing code: "Ravi Paints 102405"
            if ($name -match "^(.*?)\s+(\d{4,7})\s*$") {
                $result.CustomerName = $Matches[1].Trim()
                $result.CustomerCode = $Matches[2]
            } else {
                $result.CustomerName = $name
            }
            return $result
        }

        # Pattern 2: Labeled code line
        # "Code: 682327", "Customer Code: 3296171", "A/c: 102405"
        if ($trimmed -match "(?i)^\s*(Customer\s*|Dealer\s*|A\/c\s*|Account\s*)?Code\s*[:\-]\s*(\d{4,7})\s*$") {
            $result.CustomerCode = $Matches[2]
            return $result
        }

        # Pattern 4: Standalone code (first 5 lines only)
        # A line that is ONLY a 5-7 digit number
        if ($lineCount -le 5 -and $trimmed -match "^\s*(\d{5,7})\s*$") {
            $result.CustomerCode = $Matches[1]
            return $result
        }
    }

    return $result
}


#region OUTLOOK CONNECTION

function Connect-Outlook {
    $ol = $null
    try {
        $ol = [Runtime.Interopservices.Marshal]::GetActiveObject("Outlook.Application")
        Write-Log "Attached to running Outlook"
    } catch {
        try {
            $ol = New-Object -ComObject Outlook.Application
            Write-Log "Created new Outlook COM instance"
        } catch {
            Write-Log "FATAL: Cannot connect to Outlook - $_" "ERROR"
            return $null
        }
    }
    return $ol
}

function Get-OrderFolder ($outlook) {
    try {
        $ns = $outlook.GetNamespace("MAPI")
        $ns.Logon()
        $inbox = $null
        foreach ($store in $ns.Stores) {
            if ($store.DisplayName -match [regex]::Escape($OutlookAccount)) {
                $root = $store.GetRootFolder()
                foreach ($folder in $root.Folders) {
                    if ($folder.Name -eq "Inbox") {
                        $inbox = $folder
                        break
                    }
                }
                break
            }
        }
        if (-not $inbox) {
            Write-Log "FATAL: Could not find Inbox for $OutlookAccount - check Outlook account setup" "ERROR"
            return $null
        }
        Write-Log "Using Inbox from $OutlookAccount"
        return $inbox
    } catch {
        Write-Log "Error accessing Inbox: $_" "ERROR"
        return $null
    }
}

#endregion


#region EMAIL CLASSIFICATION

function Classify-Email ($mail, $acceptedSenders) {
    if ($mail.Class -ne 43) { Write-Log "CLASSIFY-SKIP: Class=$($mail.Class) | $($mail.Subject)" "DEBUG"; return "SKIP" }

    if ($acceptedSenders.Count -gt 0) {
        $sender = $mail.SenderEmailAddress
        if ($sender -match "^/O=") {
            try { $sender = $mail.Sender.GetExchangeUser().PrimarySmtpAddress } catch { }
        }
        if ($sender -and ($acceptedSenders -notcontains $sender.ToLower())) { Write-Log "CLASSIFY-SKIP: sender-rejected=$sender | $($mail.Subject)" "DEBUG"; return "SKIP" }
    }

    $subj = $mail.Subject
    if (-not $subj) { Write-Log "CLASSIFY-SKIP: no-subject" "DEBUG"; return "SKIP" }
    if ($subj -notmatch "(?i)order") { Write-Log "CLASSIFY-SKIP: no-order-keyword | $subj" "DEBUG"; return "SKIP" }

    $badKeywords = @("Site Order", "Cross Billing Order")
    foreach ($bad in $badKeywords) {
        if ($subj.ToUpper().Contains($bad.ToUpper())) { Write-Log "CLASSIFY-SKIP: bad-keyword=$bad | $subj" "DEBUG"; return "SKIP" }
    }

    if ($subj -match "(?i)^RE\s*:") { Write-Log "CLASSIFY-SKIP: RE-reply | $subj" "DEBUG"; return "SKIP" }
    return "FW"
}

#endregion


#region SECTION DETECTION (v6.5)

# ── v6.5 ITEMS 1+2: Detect multi-customer and multi-delivery sections ──
# Two-pass algorithm:
#   Pass 1: Look for CUSTOMER headers (numbered prefix: "1.Customer Name")
#           If 2+ found → CUSTOMER SPLIT MODE
#   Pass 2: If <2 customer headers, look for DELIVERY headers ("Customer Delivery")
#           If 2+ found → DELIVERY SPLIT MODE
#   Otherwise: single order mode (no split)
#
# Safety: product keyword in line → NOT a header (disqualified)
#         pack*qty in line → NOT a header (disqualified)
#         Minimum 2 headers required to activate splitting

function Detect-SectionHeaders ($bodyLines, $prodKW, $baseKW, $custKW) {
    $customerHeaders = @()
    $deliveryHeaders = @()

    for ($i = 0; $i -lt $bodyLines.Count; $i++) {
        $line = $bodyLines[$i].Trim()
        if ([string]::IsNullOrWhiteSpace($line)) { continue }

        $upper = $line.ToUpper()

        # ── Disqualify: has pack*qty pattern → product line, not header ──
        if ($line -match "\d+\s*\*\s*\d+") { continue }

        # ── Disqualify: has product keyword → product line, not header ──
        $hasProdKw = $false
        foreach ($kw in $prodKW) {
            if ($kw.Length -ge 2 -and (Test-KeywordWB $upper $kw)) {
                $hasProdKw = $true; break
            }
        }
        if ($hasProdKw) { continue }

        # ── Disqualify: line starts with a material code ──
        if ($line -match "^\s*(IN)?\d{5,10}\s") { continue }

        # ── Disqualify: noise patterns ──
        $isNoise = $false
        foreach ($signal in $SignalPatterns["noise"]) {
            if ($upper.Contains($signal)) { $isNoise = $true; break }
        }
        if ($isNoise) { continue }

        # ── Disqualify: very short lines (1-2 chars) ──
        if ($line.Length -le 2) { continue }

        # ── Check for numbered prefix: "1." "2)" "3-" "4 " ──
        $numberedName = $null
        $numberPrefix = $false
        if ($line -match '^\s*(\d{1,2})\s*[.\)\-]\s*(.+)') {
            $numberedName = $Matches[2].Trim()
            $numberPrefix = $true
        }
        elseif ($line -match '^\s*(\d{1,2})\s+([A-Za-z].+)') {
            # "1 Customer Name" — number + space + text starting with letter
            $numberedName = $Matches[2].Trim()
            $numberPrefix = $true
        }

        # ── Check for delivery keyword ──
        $isDelivery = $false
        if ($upper -match "\bDELIVERY\b" -or $upper -match "^DELIVER\s+TO\s+" -or $upper -match "^DELIVERY\s+TO\s+") {
            $isDelivery = $true
        }

        # ── Check for customer keyword match ──
        $hasCustKw = $false
        $checkText = if ($numberedName) { $numberedName.ToUpper() } else { $upper }
        if ($custKW -and $custKW.Count -gt 0) {
            foreach ($kw in $custKW) {
                if (Test-KeywordWB $checkText $kw) {
                    $hasCustKw = $true; break
                }
            }
        }

        # ── Extract trailing customer code (6-7 digits) ──
        $custCode = ""
        $headerName = if ($numberedName) { $numberedName } else { $line.Trim() }
        if ($headerName -match '(\d{6,7})\s*$') {
            $custCode = $Matches[1]
            $headerName = ($headerName -replace '\d{6,7}\s*$', '').Trim()
        }
        # Also handle parenthesized code: "(3183111)"
        if ($headerName -match '\((\d{6,7})\)\s*$') {
            $custCode = $Matches[1]
            $headerName = ($headerName -replace '\(\d{6,7}\)\s*$', '').Trim()
        }

        # ── Strip parenthetical remarks from name: "(Delivery as per chalan)" ──
        $deliveryRemark = ""
        if ($headerName -match '\(([^)]+)\)\s*$') {
            $parenContent = $Matches[1].Trim()
            $deliveryRemark = $parenContent
            $headerName = ($headerName -replace '\([^)]+\)\s*$', '').Trim()
        }

        # ── Score and classify ──
        $score = 0

        if ($numberPrefix) { $score += 10 }
        if ($hasCustKw) { $score += 10 }
        if ($isDelivery) { $score += 8 }
        if ($custCode) { $score += 3 }

        # ── Numbered prefix ALWAYS = customer type ──
        if ($numberPrefix -and $score -ge 10) {
            $customerHeaders += @{
                LineIndex       = $i
                Type            = "customer"
                Name            = $headerName
                Code            = $custCode
                DeliveryRemark  = $deliveryRemark
                Score           = $score
            }
        }
        elseif ($isDelivery -and $score -ge 8) {
            # Delivery header (no numbered prefix)
            $deliveryHeaders += @{
                LineIndex       = $i
                Type            = "delivery"
                Name            = $headerName
                Code            = ""
                DeliveryRemark  = $line.Trim()
                Score           = $score
            }
        }
        elseif ($hasCustKw -and $score -ge 10 -and -not $numberPrefix) {
            # Customer keyword match without number — could be standalone customer name
            # Only treat as customer header if next non-empty line has product content
            $nextHasProduct = $false
            for ($j = $i + 1; $j -lt [Math]::Min($i + 3, $bodyLines.Count); $j++) {
                $nextL = $bodyLines[$j].Trim()
                if ([string]::IsNullOrWhiteSpace($nextL)) { continue }
                if ($nextL -match "\d+\s*\*\s*\d+") { $nextHasProduct = $true; break }
                # Check for space-separated pack qty
                if ($nextL -match "\d+\s+\d+\s*$") { $nextHasProduct = $true; break }
                break
            }
            if ($nextHasProduct) {
                $customerHeaders += @{
                    LineIndex       = $i
                    Type            = "customer"
                    Name            = $headerName
                    Code            = $custCode
                    DeliveryRemark  = $deliveryRemark
                    Score           = $score
                }
            }
        }
    }

    # ── Two-pass priority: customer headers first ──
    if ($customerHeaders.Count -ge 2) {
        Write-Log "SECTION-DETECT: $($customerHeaders.Count) customer headers found" "DEBUG"
        return $customerHeaders
    }

    if ($deliveryHeaders.Count -ge 2) {
        Write-Log "SECTION-DETECT: $($deliveryHeaders.Count) delivery headers found" "DEBUG"
        return $deliveryHeaders
    }

    # No split
    return @()
}

#endregion


#region BODY PARSER v6

function Parse-EmailBody ($mail, $ignoreRemarks, $classificationKeywords) {
    # v6.2: Safe COM property access — PS 5.1 compatible try/catch
    $FullBody = ""
    try { $FullBody = $mail.Body } catch { $FullBody = "" }
    $Subject = ""
    try { $Subject = $mail.Subject } catch { $Subject = "" }
    $ReceivedTime = $null
    try { $ReceivedTime = $mail.ReceivedTime } catch { $ReceivedTime = $null }


    # v6.2: Null guards
    if (-not $FullBody) { $FullBody = "" }
    if (-not $Subject) { $Subject = "" }

    # === Extract original sender details from forwarded mail body ===
    $From = "(unknown sender)"
    try { $From = $mail.SenderName } catch { $From = "(unknown sender)" }
    if (-not $From) { $From = "(unknown sender)" }
    $ReceiveDate = if ($ReceivedTime) { $ReceivedTime.ToString("dd-MM-yyyy") } else { (Get-Date).ToString("dd-MM-yyyy") }
    $ReceiveTime = if ($ReceivedTime) { $ReceivedTime.ToString("HH:mm") } else { (Get-Date).ToString("HH:mm") }


    if ($FullBody -match "From:\s*(.+?)\s*\r?\nSent:\s*(.+?)\s*\r?\n(?:.*\r?\n)*?Subject:\s*(.+?)\r?\n") {
        $From = ($Matches[1] -replace "<.*?>", "").Trim()
        $OriginalSent = $Matches[2].Trim()
        $Subject = $Matches[3].Trim()
        try {
            $ParsedDate = [DateTime]::Parse($OriginalSent, $null, [System.Globalization.DateTimeStyles]::AssumeUniversal)
            $istZone = [System.TimeZoneInfo]::FindSystemTimeZoneById("India Standard Time")
            $ParsedDateIST = [System.TimeZoneInfo]::ConvertTimeFromUtc($ParsedDate, $istZone)
            $ReceiveDate = $ParsedDateIST.ToString("dd-MM-yyyy")
            $ReceiveTime = $ParsedDateIST.ToString("HH:mm")
        } catch { }
    }


    # === Clean body: strip before BEWARE or after Subject: header ===
    $rawLines = $FullBody -split "`n"
    $startLine = ($rawLines | Select-String -Pattern "BEWARE! This is an external email\. Think before you click!").LineNumber
    if ($startLine -gt 0) {
        $rawLines = $rawLines[$startLine..($rawLines.Count - 1)]
    } else {
        $fallbackLine = ($rawLines | Select-String -Pattern "^Subject\s*:\s*").LineNumber
        if ($fallbackLine -gt 0 -and $fallbackLine + 1 -lt $rawLines.Count) {
            $rawLines = $rawLines[($fallbackLine + 1)..($rawLines.Count - 1)]
        }
    }


    $Body = ($rawLines -join "`n") -replace "\s{4,}", "`r`n"
    $Body = ($Body -split "(?i)REGARDS")[0].Trim()
    $Body = ($Body -split "(?i)Sent from Outlook")[0].Trim()
    $Body = ($Body -split "(?i)Get Outlook for")[0].Trim()


    # === Extract delivery remarks ===
    $DeliveryRemarks = ""
    if ($Body -match "(?i)(Delivery|Challan)\s*[:-]?\s*(in\s+name\s+of\s+)?\s*(.+)") {
        $DeliveryRemarks = $Matches[3].Trim()
    }

    # === Detect challan attachment ===
    $HasChallanAttachment = $false
    try {
        if ($mail.Attachments.Count -gt 0) {
            $bodyAndSubject = "$($mail.Subject) $FullBody"
            if ($bodyAndSubject -match "(?i)challan") {
                $HasChallanAttachment = $true
            }
        }
    } catch { }

    # === Pre-process body lines: handle multi-line product+pack patterns ===
    $Body = $Body -replace "\s{4,}", "`r`n"
    $rawLines = $Body -split "`n"
    $bodyLines = @()
    $joinCount = 0
    $deliveryBlockCount = 0

    for ($i = 0; $i -lt $rawLines.Count; $i++) {
        $line = $rawLines[$i].Trim()
        if ($ignoreRemarks -contains $line) { continue }
        if ($line -match "^\s*Order\s*[:\-]?\s*$") { continue }

        $nextLine = if ($i + 1 -lt $rawLines.Count) { $rawLines[$i + 1].Trim() } else { "" }
        $nextLineHasPack = ($nextLine -match "\d+[\*xX]|&|\d+\s*[x]\s*\d+")

        # === Line ends with dash/colon, next line has pack*qty ===
        if (($line -match "[:\-]\s*$" -or $line -match "\s{2,}$") -and $nextLineHasPack) {
            $combined = ($line -replace "[:\-]\s*$", "").Trim() + " " + $nextLine
            $bodyLines += $combined
            $joinCount++
            $i++
            continue
        }

        # === Product name (no digits), next line has pack*qty ===
        # Guard: don't concatenate if line contains "delivery" — it's a ship-to header, not a product name (v6.2)
        if (($line -notmatch "\d") -and $nextLineHasPack -and
            ($line -notmatch "^(?i)(Delivery|Remarks|Bill|Sent|Get)\s*[:\-]") -and
            ($line -notmatch "(?i)\bdelivery\b")) {
            $bodyLines += "$line $nextLine"
            $joinCount++
            $i++
            continue
        }

        # Log if delivery guard blocked a join
        if (($line -notmatch "\d") -and $nextLineHasPack -and ($line -match "(?i)\bdelivery\b")) {
            $deliveryBlockCount++
            Write-Log "DELIVERY-BLOCK: '$line' not joined with '$nextLine'" "DEBUG"
        }

        $bodyLines += $line
    }

    # === V6 LINE PARSING: Normalize → Split → Extract ===
    $AllProductRows = @()
    $AllRemarkRows = @()
    $BodyRemarks = ""
    $BillNoRemarks = ""

    # Classification keywords
    $prodKW = if ($classificationKeywords) { $classificationKeywords.ProductKeywords } else { @() }
    $baseKW = if ($classificationKeywords) { $classificationKeywords.BaseKeywords } else { @() }
    $custKW = if ($classificationKeywords) { $classificationKeywords.CustomerKeywords } else { @() }
    $areaKW = if ($classificationKeywords) { $classificationKeywords.AreaKeywords } else { @() }
    # v6.3: script-scope for Send-ToApi base injection guard
    $script:BaseKW = $baseKW
    # v6.5: script-scope for Send-ToApi carry-forward product hint
    $script:ProdKW = $prodKW

    # === Extract customer info from body (before product extraction) ===
    $bodyCustomer = Extract-BodyCustomer $bodyLines $prodKW


    # === v6.5 ITEMS 1+2: Detect section headers (multi-customer / multi-delivery) ===
    $sectionHeaders = Detect-SectionHeaders $bodyLines $prodKW $baseKW $custKW

    # Reset carry-forward state for this email
    $script:CarryProduct = ""
    $script:CarryBase = ""

    if ($sectionHeaders.Count -ge 2) {
        # ── SECTION SPLIT MODE ──
        # Split bodyLines into sections at detected header lines
        # Process each section independently, insert __SECTION_MARKER__ between them
        Write-Log "SECTION-SPLIT: $($sectionHeaders.Count) sections ($($sectionHeaders[0].Type) mode)"

        # Build section ranges: each section starts at header line, ends before next header
        $sectionRanges = @()
        for ($si = 0; $si -lt $sectionHeaders.Count; $si++) {
            $startIdx = $sectionHeaders[$si].LineIndex
            $endIdx = if ($si + 1 -lt $sectionHeaders.Count) { $sectionHeaders[$si + 1].LineIndex - 1 } else { $bodyLines.Count - 1 }
            $sectionRanges += @{
                Header   = $sectionHeaders[$si]
                StartIdx = $startIdx + 1  # skip header line itself
                EndIdx   = $endIdx
            }
        }

        # Check for products BEFORE first header (orphan lines)
        $firstHeaderIdx = $sectionHeaders[0].LineIndex
        if ($firstHeaderIdx -gt 0) {
            # Process orphan lines before first header — assign to section 1
            for ($li = 0; $li -lt $firstHeaderIdx; $li++) {
                $line = $bodyLines[$li].Trim()
                $line = $line -replace "^\d+\.\s*", ""
                if ([string]::IsNullOrWhiteSpace($line)) { continue }
                $normalized = Normalize-Line $line
                if ([string]::IsNullOrWhiteSpace($normalized.Text)) { continue }
                $result = Extract-ProductLines $normalized.Text $normalized.IsCarton $prodKW $baseKW $custKW $areaKW
                $AllProductRows += $result.ProductRows
                foreach ($remark in $result.RemarkRows) {
                    $AllRemarkRows += $remark
                }
            }
            Write-Log "SECTION-SPLIT: $($AllProductRows.Count) orphan lines before first header assigned to section 1"
        }

        # Process each section
        $sectionNum = 0
        foreach ($sr in $sectionRanges) {
            $sectionNum++
            $hdr = $sr.Header

            # Insert section marker
            $AllProductRows += @{
                ProductName      = "__SECTION_MARKER__"
                PackCode         = ""
                Quantity         = $sectionNum
                IsCarton         = $false
                _Base            = ""
                _SectionType     = $hdr.Type
                _CustomerName    = $hdr.Name
                _CustomerCode    = $hdr.Code
                _DeliveryRemarks = $hdr.DeliveryRemark
            }

            # Reset carry-forward for each section
            $script:CarryProduct = ""
            $script:CarryBase = ""

            # Process lines in this section
            for ($li = $sr.StartIdx; $li -le $sr.EndIdx; $li++) {
                if ($li -ge $bodyLines.Count) { break }
                $line = $bodyLines[$li].Trim()
                $line = $line -replace "^\d+\.\s*", ""
                if ([string]::IsNullOrWhiteSpace($line)) { continue }

                $normalized = Normalize-Line $line
                if ([string]::IsNullOrWhiteSpace($normalized.Text)) { continue }

                $result = Extract-ProductLines $normalized.Text $normalized.IsCarton $prodKW $baseKW $custKW $areaKW
                $AllProductRows += $result.ProductRows
                foreach ($remark in $result.RemarkRows) {
                    $AllRemarkRows += $remark
                    if ([string]::IsNullOrWhiteSpace($BodyRemarks)) {
                        $BodyRemarks = $remark.RawText
                    } else {
                        $BodyRemarks = "$BodyRemarks; $($remark.RawText)"
                    }
                }

                foreach ($row in $result.ProductRows) {
                    if ($row.ProductName -eq "__BILL_MARKER__") {
                        $BillNoRemarks = "Bill $($row.Quantity)"
                    }
                }
            }
        }
    } else {
        # ── SINGLE ORDER MODE (existing flow — unchanged) ──

        foreach ($line in $bodyLines) {
            $line = $line.Trim()
            $line = $line -replace "^\d+\.\s*", ""  # Strip leading numbers like "1. "
            if ([string]::IsNullOrWhiteSpace($line)) { continue }

            # Phase 1: Normalize
            $normalized = Normalize-Line $line

            if ([string]::IsNullOrWhiteSpace($normalized.Text)) { continue }

            # Phase 2+3: Split and Extract
            $result = Extract-ProductLines $normalized.Text $normalized.IsCarton $prodKW $baseKW $custKW $areaKW

            $AllProductRows += $result.ProductRows
            foreach ($remark in $result.RemarkRows) {
                $AllRemarkRows += $remark
                if ([string]::IsNullOrWhiteSpace($BodyRemarks)) {
                    $BodyRemarks = $remark.RawText
                } else {
                    $BodyRemarks = "$BodyRemarks; $($remark.RawText)"
                }
            }

            # Extract bill number from product rows
            foreach ($row in $result.ProductRows) {
                if ($row.ProductName -eq "__BILL_MARKER__") {
                    $BillNoRemarks = "Bill $($row.Quantity)"
                }
            }
        }
    }

    # === v6.2: Per-email parse summary ===
    $cartonCount = @($AllProductRows | Where-Object { $_.IsCarton -eq $true }).Count
    $billCount = @($AllProductRows | Where-Object { $_.ProductName -eq "__BILL_MARKER__" }).Count
    $carryInfo = "prod='$($script:CarryProduct)' base='$($script:CarryBase)'"
    Write-Log "PARSED: '$Subject' | body=$($FullBody.Length) | bodyLines=$($bodyLines.Count) | products=$($AllProductRows.Count) | remarks=$($AllRemarkRows.Count) | joins=$joinCount | deliveryBlocks=$deliveryBlockCount | cartons=$cartonCount | bills=$billCount | carry=($carryInfo) | bodyCust='$($bodyCustomer.CustomerName)' code='$($bodyCustomer.CustomerCode)'"

    return @{
        From                 = $From
        ReceiveDate          = $ReceiveDate
        ReceiveTime          = $ReceiveTime
        Subject              = $Subject
        DeliveryRemarks      = $DeliveryRemarks
        Remarks              = $BodyRemarks
        BillRemarks          = $BillNoRemarks
        HasChallanAttachment = $HasChallanAttachment
        ProductRows          = $AllProductRows
        RemarkRows           = $AllRemarkRows
        BodyCustomerName     = $bodyCustomer.CustomerName
        BodyCustomerCode     = $bodyCustomer.CustomerCode
    }
}

# ── APP-FORMAT BODY PARSER (additive — Place-Order app emails) ──────────────
# Mirrors Parse-EmailBody for sender/subject/date extraction, the BEWARE/Subject
# body-strip, and the 4-space->newline cleanup. Then DIVERGES: the app body opens
# with a labelled header block (Bill To / Dispatch / Ship To / Remark / Note in
# any order), after which the product/Bill region is parsed by REUSING the
# existing Normalize-Line + Extract-ProductLines engine (so "Bill N" still emits
# __BILL_MARKER__ rows the main-loop bill-split path handles for free).
# Returns the SAME keys as Parse-EmailBody PLUS AppDispatchStatus,
# AppDispatchPriority, AppShipToOverride (read by the main loop in the next step).
function Parse-AppBody ($mail, $ignoreRemarks, $classificationKeywords) {
    # ── Mirror Parse-EmailBody: COM-safe property access ──
    $FullBody = ""
    try { $FullBody = $mail.Body } catch { $FullBody = "" }
    $Subject = ""
    try { $Subject = $mail.Subject } catch { $Subject = "" }
    $ReceivedTime = $null
    try { $ReceivedTime = $mail.ReceivedTime } catch { $ReceivedTime = $null }

    if (-not $FullBody) { $FullBody = "" }
    if (-not $Subject) { $Subject = "" }

    # ── Mirror: original sender details from forwarded mail body ──
    $From = "(unknown sender)"
    try { $From = $mail.SenderName } catch { $From = "(unknown sender)" }
    if (-not $From) { $From = "(unknown sender)" }
    $ReceiveDate = if ($ReceivedTime) { $ReceivedTime.ToString("dd-MM-yyyy") } else { (Get-Date).ToString("dd-MM-yyyy") }
    $ReceiveTime = if ($ReceivedTime) { $ReceivedTime.ToString("HH:mm") } else { (Get-Date).ToString("HH:mm") }

    if ($FullBody -match "From:\s*(.+?)\s*\r?\nSent:\s*(.+?)\s*\r?\n(?:.*\r?\n)*?Subject:\s*(.+?)\r?\n") {
        $From = ($Matches[1] -replace "<.*?>", "").Trim()
        $OriginalSent = $Matches[2].Trim()
        $Subject = $Matches[3].Trim()
        try {
            $ParsedDate = [DateTime]::Parse($OriginalSent, $null, [System.Globalization.DateTimeStyles]::AssumeUniversal)
            $istZone = [System.TimeZoneInfo]::FindSystemTimeZoneById("India Standard Time")
            $ParsedDateIST = [System.TimeZoneInfo]::ConvertTimeFromUtc($ParsedDate, $istZone)
            $ReceiveDate = $ParsedDateIST.ToString("dd-MM-yyyy")
            $ReceiveTime = $ParsedDateIST.ToString("HH:mm")
        } catch { }
    }

    # ── Mirror: clean body — strip before BEWARE or after Subject: header ──
    $rawLines = $FullBody -split "`n"
    $startLine = ($rawLines | Select-String -Pattern "BEWARE! This is an external email\. Think before you click!").LineNumber
    if ($startLine -gt 0) {
        $rawLines = $rawLines[$startLine..($rawLines.Count - 1)]
    } else {
        $fallbackLine = ($rawLines | Select-String -Pattern "^Subject\s*:\s*").LineNumber
        if ($fallbackLine -gt 0 -and $fallbackLine + 1 -lt $rawLines.Count) {
            $rawLines = $rawLines[($fallbackLine + 1)..($rawLines.Count - 1)]
        }
    }

    # ── Mirror: 4-space -> newline cleanup + signature trim ──
    $Body = ($rawLines -join "`n") -replace "\s{4,}", "`r`n"
    $Body = ($Body -split "(?i)REGARDS")[0].Trim()
    $Body = ($Body -split "(?i)Sent from Outlook")[0].Trim()
    $Body = ($Body -split "(?i)Get Outlook for")[0].Trim()
    $Body = $Body -replace "\s{4,}", "`r`n"

    $appLines = $Body -split "`n"

    # ── Classification keywords (same script-scope wiring Send-ToApi relies on) ──
    $prodKW = if ($classificationKeywords) { $classificationKeywords.ProductKeywords } else { @() }
    $baseKW = if ($classificationKeywords) { $classificationKeywords.BaseKeywords } else { @() }
    $custKW = if ($classificationKeywords) { $classificationKeywords.CustomerKeywords } else { @() }
    $areaKW = if ($classificationKeywords) { $classificationKeywords.AreaKeywords } else { @() }
    $script:BaseKW = $baseKW
    $script:ProdKW = $prodKW

    # ── App-format defaults ──
    $BodyCustomerName    = ""
    $BodyCustomerCode    = ""
    $DeliveryRemarks     = ""
    $AppShipToOverride   = $false
    $AppDispatchStatus   = "Dispatch"
    $AppDispatchPriority = "Normal"
    $HeaderRemarkRows    = @()
    $BodyRemarks         = ""

    # ── STEP A: read the labelled header block ──
    # Header line = starts (case-insensitive) with one of exactly these 5 labels.
    # Labels may appear in any order. Block ends at first non-empty NON-label line.
    $headerLabelRegex = "(?i)^\s*(Bill\s*To|Dispatch|Ship\s*To|Remark|Note)\s*:"
    $productStartIdx = -1

    for ($i = 0; $i -lt $appLines.Count; $i++) {
        $line = $appLines[$i].Trim()
        if ([string]::IsNullOrWhiteSpace($line)) { continue }

        if ($line -match $headerLabelRegex) {
            $labelKey = ($Matches[1] -replace "\s+", "").ToUpper()   # BILLTO|DISPATCH|SHIPTO|REMARK|NOTE
            $value = ($line -replace $headerLabelRegex, "").Trim()

            switch ($labelKey) {
                "BILLTO" {
                    # NAME (CODE) -> name (parens+code stripped), code from (\d{4,7})
                    if ($value -match "\((\d{4,7})\)") { $BodyCustomerCode = $Matches[1] }
                    elseif ($value -match "(\d{4,7})") { $BodyCustomerCode = $Matches[1] }
                    $nm = $value -replace "\s*\(\s*\d{4,7}\s*\)\s*", " "
                    $nm = $nm -replace "\s*\b\d{4,7}\b\s*$", ""
                    $BodyCustomerName = $nm.Trim()
                }
                "SHIPTO" {
                    # DeliveryRemarks = "NAME (CODE)" verbatim; server resolves the
                    # real ship-to from this text (delivery-match.ts). Flag override.
                    if (-not [string]::IsNullOrWhiteSpace($value)) {
                        $DeliveryRemarks = $value
                        $AppShipToOverride = $true
                    }
                }
                "DISPATCH" {
                    $dval = $value.ToLower()
                    if ($dval.Contains("urgent")) { $AppDispatchPriority = "Urgent" }
                    # Business rule: never write "Hold" directly — any "Call" = Hold.
                    # v7.2: broadened to ANY form of "call" (Call to SO / Call to Dealer / Call).
                    if ($dval.Contains("call")) {
                        $AppDispatchStatus = "Hold"
                        # Capture the full dispatch value verbatim so the operator sees WHO to call.
                        if (-not [string]::IsNullOrWhiteSpace($value)) {
                            $HeaderRemarkRows += @{ RawText = $value; RemarkType = "instruction"; DetectedBy = "pattern" }
                        }
                    }
                }
                "REMARK" {
                    if (-not [string]::IsNullOrWhiteSpace($value)) {
                        # v7.2: tag cross-billing remarks so the right badge fires.
                        $remarkKind = if ($value.ToLower().Contains("cross")) { "cross" } else { "instruction" }
                        $HeaderRemarkRows += @{ RawText = $value; RemarkType = $remarkKind; DetectedBy = "pattern" }
                        if ([string]::IsNullOrWhiteSpace($BodyRemarks)) { $BodyRemarks = $value }
                        else { $BodyRemarks = "$BodyRemarks; $value" }
                    }
                }
                "NOTE" {
                    if (-not [string]::IsNullOrWhiteSpace($value)) {
                        $HeaderRemarkRows += @{ RawText = $value; RemarkType = "instruction"; DetectedBy = "pattern" }
                        if ([string]::IsNullOrWhiteSpace($BodyRemarks)) { $BodyRemarks = $value }
                        else { $BodyRemarks = "$BodyRemarks; $value" }
                    }
                }
            }
            continue
        }

        # First non-empty, non-label line -> product/Bill region begins here
        $productStartIdx = $i
        break
    }

    # ── STEP C: products + Bill N (REUSE Normalize-Line + Extract-ProductLines) ──
    $AllProductRows = @()
    $AllRemarkRows  = @()
    foreach ($hr in $HeaderRemarkRows) { $AllRemarkRows += $hr }   # header remarks first
    $BillNoRemarks = ""

    # Reset carry-forward state for this email (same as Parse-EmailBody)
    $script:CarryProduct = ""
    $script:CarryBase = ""

    if ($productStartIdx -ge 0) {
        for ($i = $productStartIdx; $i -lt $appLines.Count; $i++) {
            $line = $appLines[$i].Trim()
            if ($ignoreRemarks -contains $line) { continue }
            $line = $line -replace "^\d+\.\s*", ""   # strip leading "1. "
            if ([string]::IsNullOrWhiteSpace($line)) { continue }

            # ── App name-lock: capture the canonical emitted name (text left of
            #    the first " - "), so the posted rawText equals the app's
            #    emitted v2 name verbatim and the Table C key matches by
            #    construction — no base-split / reformat. Lines without " - "
            #    (e.g. "Bill N") get no override; the engine names them as today.
            $appName = ""
            $dashIdx = $line.IndexOf(" - ")
            if ($dashIdx -ge 0) { $appName = $line.Substring(0, $dashIdx).Trim() }

            # v7.3: app-only piece-pack peel. /po emits "1 pc*12" for TOOLS packs
            # (PLACE_ORDER §267). Normalize-Line §1b knows "pcs" but not bare "pc",
            # so the letter left of the star blocks every pack detector.
            # App format is a fixed contract (always "{pack} pc*{qty}"), so this peel
            # is safe HERE and is deliberately NOT added to the shared Normalize-Line —
            # human mail places units freely (e.g. "5mm:1*18 tin") and needs its own fix.
            $line = $line -replace "(?i)(\d+)\s*pc\b", '$1'

            $normalized = Normalize-Line $line
            if ([string]::IsNullOrWhiteSpace($normalized.Text)) { continue }

            $result = Extract-ProductLines $normalized.Text $normalized.IsCarton $prodKW $baseKW $custKW $areaKW

            # Pin the name on this line's product rows (incl. carried-forward
            # pack rows). Pack/qty/carton stay as parsed; __BILL_MARKER__ rows
            # are left untouched. Clear _Base so Send-ToApi posts $appName
            # verbatim (the base is already part of the pinned name).
            if (-not [string]::IsNullOrWhiteSpace($appName)) {
                foreach ($prow in $result.ProductRows) {
                    if ($prow.ProductName -ne "__BILL_MARKER__") {
                        $prow.ProductName = $appName
                        $prow._Base = ""
                    }
                }
            }

            $AllProductRows += $result.ProductRows
            foreach ($remark in $result.RemarkRows) {
                $AllRemarkRows += $remark
                if ([string]::IsNullOrWhiteSpace($BodyRemarks)) { $BodyRemarks = $remark.RawText }
                else { $BodyRemarks = "$BodyRemarks; $($remark.RawText)" }
            }

            foreach ($row in $result.ProductRows) {
                if ($row.ProductName -eq "__BILL_MARKER__") { $BillNoRemarks = "Bill $($row.Quantity)" }
            }
        }
    }

    # ── STEP D: per-email summary + return (same keys as Parse-EmailBody + 3) ──
    $cartonCount = @($AllProductRows | Where-Object { $_.IsCarton -eq $true }).Count
    $billCount = @($AllProductRows | Where-Object { $_.ProductName -eq "__BILL_MARKER__" }).Count
    Write-Log "PARSED-APP: '$Subject' | products=$($AllProductRows.Count) | remarks=$($AllRemarkRows.Count) | cartons=$cartonCount | bills=$billCount | cust='$BodyCustomerName' code='$BodyCustomerCode' | dispatch=$AppDispatchStatus/$AppDispatchPriority | shipToOverride=$AppShipToOverride"

    return @{
        From                 = $From
        ReceiveDate          = $ReceiveDate
        ReceiveTime          = $ReceiveTime
        Subject              = $Subject
        DeliveryRemarks      = $DeliveryRemarks
        Remarks              = $BodyRemarks
        BillRemarks          = $BillNoRemarks
        HasChallanAttachment = $false
        ProductRows          = $AllProductRows
        RemarkRows           = $AllRemarkRows
        BodyCustomerName     = $BodyCustomerName
        BodyCustomerCode     = $BodyCustomerCode
        AppDispatchStatus    = $AppDispatchStatus
        AppDispatchPriority  = $AppDispatchPriority
        AppShipToOverride    = $AppShipToOverride
    }
}

function Test-IsAppFormat ($mail) {
    # v7.2: $true when the email is an OrbitOMS app order (first content line starts "Bill To:").
    $fullBody = ""
    try { $fullBody = $mail.Body } catch { return $false }
    if (-not $fullBody) { return $false }
    $rawLines = $fullBody -split "`n"
    $startLine = ($rawLines | Select-String -Pattern "BEWARE! This is an external email\. Think before you click!").LineNumber
    if ($startLine -gt 0) {
        $rawLines = $rawLines[$startLine..($rawLines.Count - 1)]
    } else {
        $fallbackLine = ($rawLines | Select-String -Pattern "^Subject\s*:\s*").LineNumber
        if ($fallbackLine -gt 0 -and $fallbackLine + 1 -lt $rawLines.Count) {
            $rawLines = $rawLines[($fallbackLine + 1)..($rawLines.Count - 1)]
        }
    }
    $body = ($rawLines -join "`n") -replace "\s{4,}", "`r`n"
    foreach ($line in ($body -split "`n")) {
        $t = $line.Trim()
        if ([string]::IsNullOrWhiteSpace($t)) { continue }
        return ($t -match "(?i)^Bill\s*To\s*:")
    }
    return $false
}

#endregion


#region API - HMAC + POST

function Compute-Hmac ($body, $secret) {
    $encoding = [System.Text.Encoding]::UTF8
    $hmacsha256 = New-Object System.Security.Cryptography.HMACSHA256
    $hmacsha256.Key = $encoding.GetBytes($secret)
    $hash = $hmacsha256.ComputeHash($encoding.GetBytes($body))
    return [BitConverter]::ToString($hash).Replace("-","").ToLower()
}

function Send-ToApi ($parsed, $entryId, $dispatchStatus, $dispatchPriority, $shipToOverride, $slotToOverride) {
    $receivedAtStr = ""
    try {
        $dt = [DateTime]::ParseExact("$($parsed.ReceiveDate) $($parsed.ReceiveTime)", "dd-MM-yyyy HH:mm", $null)
        $receivedAtStr = $dt.ToString("yyyy-MM-ddTHH:mm:ss+05:30")
    } catch {
        $receivedAtStr = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ss+05:30")
        Write-Log "Date parse failed for '$($parsed.ReceiveDate) $($parsed.ReceiveTime)' - using now" "WARN"
    }

    $lines = @()
    # v6.5 ITEM 6: Track carry-forward product for colour-only lines
    # For each line, check if rawText has a product keyword.
    # If not (colour-only line), include the last product that DID have a keyword.
    # Server enrichment uses this as a HINT for matching.
    $lastKnownProduct = ""
    # Also make $prodKW available (from $script:ProdKW set in Parse-EmailBody)
    $prodKWLocal = if ($script:ProdKW) { $script:ProdKW } else { @() }

    foreach ($row in $parsed.ProductRows) {
        $qty = 0
        try { $qty = [int]$row.Quantity } catch { $qty = 0 }

        # v6.3: Skip _Base injection when ProductName already contains a
        # text-based base keyword (e.g. "br white", "bw", "brilliant white").
        $shouldInjectBase = $false
        if ($row._Base) {
            $shouldInjectBase = $true
            $nameUpper = ([string]$row.ProductName).ToUpper()
            foreach ($bkw in $script:BaseKW) {
                if ($bkw.Length -ge 2 -and (Test-KeywordWB $nameUpper $bkw)) {
                    $shouldInjectBase = $false
                    break
                }
            }
        }

        $rawText = if ($shouldInjectBase) { "$($row.ProductName) $($row._Base)" } else { [string]$row.ProductName }

        # v6.5 ITEM 6: Determine carryProduct for this line
        # Compare longest product keyword match vs longest base keyword match.
        # If base keyword is longer than product keyword, this is a colour-only line
        # (e.g. "Golden yellow" → YELLOW product kw (6) vs GOLDEN YELLOW base kw (13))
        # In that case, set carryProduct hint instead of updating lastKnownProduct.
        $rawUpper = $rawText.ToUpper()
        $longestProdKwLen = 0
        foreach ($pkw in $prodKWLocal) {
            if ($pkw.Length -ge 2 -and $pkw.Length -gt $longestProdKwLen -and (Test-KeywordWB $rawUpper $pkw)) {
                $longestProdKwLen = $pkw.Length
            }
        }
        $longestBaseKwLen = 0
        foreach ($bkw in $script:BaseKW) {
            if ($bkw.Length -ge 2 -and $bkw.Length -gt $longestBaseKwLen -and (Test-KeywordWB $rawUpper $bkw)) {
                $longestBaseKwLen = $bkw.Length
            }
        }

        $carryProduct = $null
        # Line is colour-only if: base keyword is LONGER than product keyword
        # OR no product keyword at all but has base keyword
        $isColourOnly = ($longestBaseKwLen -gt $longestProdKwLen) -or ($longestProdKwLen -eq 0 -and $longestBaseKwLen -gt 0)

        if (-not $isColourOnly -and $longestProdKwLen -gt 0) {
            # This line has a dominant product keyword — update tracking
            $lastKnownProduct = $rawText
        } elseif ($isColourOnly -and $lastKnownProduct) {
            # Colour-only line — set carry hint
            $carryProduct = $lastKnownProduct
        }

        $lines += @{
            rawText      = $rawText
            packCode     = [string]$row.PackCode
            quantity      = $qty
            isCarton     = [bool]$row.IsCarton
            carryProduct = $carryProduct
        }
    }

    $remarkLines = @()
    if ($parsed.RemarkRows -and $parsed.RemarkRows.Count -gt 0) {
        foreach ($remark in $parsed.RemarkRows) {
            $remarkLines += @{
                rawText    = [string]$remark.RawText
                remarkType = [string]$remark.RemarkType
                detectedBy = [string]$remark.DetectedBy
            }
        }
    }

    $payload = @{
        emailEntryId    = $entryId
        soName          = [string]$parsed.From
        soEmail         = $null
        receivedAt      = $receivedAtStr
        subject         = [string]$parsed.Subject
        deliveryRemarks = [string]$parsed.DeliveryRemarks
        remarks         = [string]$parsed.Remarks
        billRemarks     = [string]$parsed.BillRemarks
        dispatchStatus   = $dispatchStatus
        dispatchPriority = $dispatchPriority
        shipToOverride   = $shipToOverride
        slotToOverride   = $slotToOverride
        lines           = $lines
        remarkLines     = $remarkLines
        bodyCustomerName = if ($parsed.BodyCustomerName) { [string]$parsed.BodyCustomerName } else { $null }
        bodyCustomerCode = if ($parsed.BodyCustomerCode) { [string]$parsed.BodyCustomerCode } else { $null }
    }

    $json = $payload | ConvertTo-Json -Depth 4 -Compress
    $sig = Compute-Hmac $json $HmacSecret

    try {
        $webResponse = Invoke-WebRequest -Uri $ApiBaseUrl -Method POST -Body $json `
            -ContentType "application/json; charset=utf-8" `
            -Headers @{ "x-hmac-signature" = $sig } `
            -UseBasicParsing
        $response = $webResponse.Content | ConvertFrom-Json
        return $response
    } catch {
        $statusCode = $null
        $errorBody = ""
        if ($_.Exception.Response) {
            $statusCode = [int]$_.Exception.Response.StatusCode
            try {
                $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
                $errorBody = $reader.ReadToEnd()
            } catch { }
        }
        Write-Log "API POST failed (HTTP $statusCode): $($_.Exception.Message) | $errorBody" "ERROR"
        Write-Host " FAIL (HTTP $statusCode)" -ForegroundColor Red
        return $null
    }
}

#endregion


#region STARTUP

Write-Log "============================================"
Write-Log "Parse-MailOrders v$ScriptVersion starting"
Write-Log "Base dir:  $BaseDir"
Write-Log "API:       $ApiBaseUrl"
Write-Log "============================================"

# Load config
$IgnoreRemarks   = Load-IgnoreRemarks
$AcceptedSenders = Load-AcceptedSenders
$ProcessedIds    = Load-ProcessedIds

# Fetch classification keywords from API
$ClassificationKeywords = Fetch-ClassificationKeywords

# Load override keyword configs
$ShipToKeywordsFile = if ($Config["ShipToKeywordsFile"]) { $Config["ShipToKeywordsFile"] } else { "$BaseDir\shipto_keywords.txt" }
$SlotToKeywordsFile = if ($Config["SlotToKeywordsFile"]) { $Config["SlotToKeywordsFile"] } else { "$BaseDir\slotto_keywords.txt" }
$ShipToKeywords = Load-Keywords $ShipToKeywordsFile "ShipTo"
$SlotToKeywords = Load-Keywords $SlotToKeywordsFile "SlotTo"

# Connect to Outlook
$Outlook = Connect-Outlook
if (-not $Outlook) {
    Write-Log "Cannot proceed without Outlook" "ERROR"
    exit
}

$OrderFolder = Get-OrderFolder $Outlook
if (-not $OrderFolder) {
    Write-Log "Cannot proceed without Inbox folder" "ERROR"
    exit
}

$totalItems = $OrderFolder.Items.Count
$pkCount = if ($ClassificationKeywords.ProductKeywords) { $ClassificationKeywords.ProductKeywords.Count } else { 0 }
$bkCount = if ($ClassificationKeywords.BaseKeywords) { $ClassificationKeywords.BaseKeywords.Count } else { 0 }
$ckCount = if ($ClassificationKeywords.CustomerKeywords) { $ClassificationKeywords.CustomerKeywords.Count } else { 0 }
$akCount = if ($ClassificationKeywords.AreaKeywords) { $ClassificationKeywords.AreaKeywords.Count } else { 0 }
Write-Log "Inbox: $totalItems items | Remarks: $($IgnoreRemarks.Count) | Senders: $($AcceptedSenders.Count) | ShipTo: $($ShipToKeywords.Count) | SlotTo: $($SlotToKeywords.Count) | ProductKW: $pkCount | BaseKW: $bkCount | CustomerKW: $ckCount | AreaKW: $akCount"
Write-Host "Ready | Inbox: $totalItems items | $($IgnoreRemarks.Count) remarks | $($AcceptedSenders.Count) senders | $pkCount prodKW | $bkCount baseKW | $ckCount custKW | $akCount areaKW"
Write-Host "Monitoring for FW: order emails every ${CheckInterval}s (Ctrl+C to stop)"
Write-Host ""

#endregion


#region MAIN LOOP

while ($true) {
    try {
        $items = $OrderFolder.Items
        $items.Sort("[ReceivedTime]", $true) | Out-Null

        $cycleProcessed = 0
        $reachedOld = $false

        foreach ($mail in $items) {
            if ($reachedOld) { break }
            try {
                if ($mail.Class -ne 43) { continue }

                # Only today's emails (sorted newest first)
                if ($mail.ReceivedTime.Date -lt (Get-Date).AddDays(-1).Date) {
                    $reachedOld = $true
                    break
                }

                $entryId = $mail.EntryID
                if ($ProcessedIds.ContainsKey($entryId)) { continue }

                # v6.2: Diagnostic logging — log every unprocessed email before classification
                Write-Log "SCAN: $($mail.Subject) | From: $($mail.SenderName) | Received: $($mail.ReceivedTime) | EntryID: $($entryId.Substring(0, [Math]::Min(20, $entryId.Length)))..."

                $type = Classify-Email $mail $AcceptedSenders
                if ($type -eq "SKIP") {
                    Mark-AsProcessed $ProcessedIds $entryId
                    continue
                }

                # === SORTER (v7.2): route app-format emails to Parse-AppBody ===
                $isApp = $false
                try { $isApp = Test-IsAppFormat $mail } catch { $isApp = $false }

                # Parse the email body — wrapped in try-catch for COM-hostile emails (v6.2)
                $parsed = $null
                try {
                    if ($isApp) {
                        $parsed = Parse-AppBody $mail $IgnoreRemarks $ClassificationKeywords
                    } else {
                        $parsed = Parse-EmailBody $mail $IgnoreRemarks $ClassificationKeywords
                    }
                } catch {
                    Write-Log "Parse body crashed for: $($mail.Subject) - $_ - using raw fallback" "WARN"
                    Write-Log "CRASH-TRACE: $($_.ScriptStackTrace)" "WARN"
                }

                # If parse crashed, build a minimal $parsed with empty fields
                if (-not $parsed) {
                    $mailSubject = ""
                    try { $mailSubject = $mail.Subject } catch { }
                    $mailSender = "(unknown)"
                    try { $mailSender = $mail.SenderName } catch { }
                    $mailDate = (Get-Date).ToString("dd-MM-yyyy")
                    $mailTime = (Get-Date).ToString("HH:mm")
                    try {
                        $mailDate = $mail.ReceivedTime.ToString("dd-MM-yyyy")
                        $mailTime = $mail.ReceivedTime.ToString("HH:mm")
                    } catch { }

                    $parsed = @{
                        From                 = $mailSender
                        ReceiveDate          = $mailDate
                        ReceiveTime          = $mailTime
                        Subject              = $mailSubject
                        DeliveryRemarks      = ""
                        Remarks              = ""
                        BillRemarks          = ""
                        HasChallanAttachment = $false
                        ProductRows          = @()
                        RemarkRows           = @()
                        BodyCustomerName     = ""
                        BodyCustomerCode     = ""
                    }
                }

                # Derive dispatch data from email content
                if ($isApp) {
                    # App path: dispatch + ship-to come straight from the labelled header block
                    $dispatchStatus   = if ($parsed.AppDispatchStatus)   { $parsed.AppDispatchStatus }   else { "Dispatch" }
                    $dispatchPriority = if ($parsed.AppDispatchPriority) { $parsed.AppDispatchPriority } else { "Normal" }
                    $shipToOverride   = if ($parsed.AppShipToOverride)   { [bool]$parsed.AppShipToOverride } else { $false }
                    $slotToOverride   = $false
                } else {
                    $dispatchStatus   = Get-DispatchStatus $parsed.Subject $parsed.DeliveryRemarks $parsed.Remarks
                    $dispatchPriority = Get-DispatchPriority $parsed.Subject $parsed.DeliveryRemarks $parsed.Remarks
                    $checkText = "$($parsed.Subject) $($parsed.DeliveryRemarks) $($parsed.Remarks)"
                    $shipToOverride   = Check-KeywordMatch $checkText $ShipToKeywords
                    $slotToOverride   = Check-KeywordMatch $checkText $SlotToKeywords
                }

                # Extract structured signals from subject line
                $subjectSignals = Extract-SubjectSignals $parsed.Subject

                # Build enriched billRemarks from subject + body signals
                $enrichedBillRemarks = Build-BillRemarks $subjectSignals $parsed.BillRemarks $parsed.Remarks

                # Store enriched data back into parsed for Send-ToApi
                $parsed.BillRemarks = $enrichedBillRemarks

                # If customer code found in subject, store in remarks for matching
                if ($subjectSignals.CustomerCode -ne "" -and [string]::IsNullOrWhiteSpace($parsed.Remarks)) {
                    $parsed.Remarks = "Code: $($subjectSignals.CustomerCode)"
                } elseif ($subjectSignals.CustomerCode -ne "") {
                    $parsed.Remarks = "$($parsed.Remarks); Code: $($subjectSignals.CustomerCode)"
                }

                # Flag challan attachment for manual review
                if ($parsed.HasChallanAttachment) {
                    if ([string]::IsNullOrWhiteSpace($parsed.Remarks)) {
                        $parsed.Remarks = "Challan attachment"
                    } else {
                        $parsed.Remarks = "$($parsed.Remarks); Challan attachment"
                    }
                }

                if ($parsed.ProductRows.Count -eq 0) {
                    # v6.2: Zero-skip fallback — POST raw body as 1 unmatched line instead of skipping
                    Write-Log "No product lines found in: $($mail.Subject) - sending as raw text" "WARN"
                    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] [RAW] $($parsed.From) | $($mail.Subject) | 0 lines, sending raw..." -NoNewline -ForegroundColor DarkYellow

                    # Build raw body text from mail body (not $bodyLines which is scoped inside Parse-EmailBody)
                    $fallbackBody = ""
                    try { $fallbackBody = $mail.Body } catch { $fallbackBody = "" }
                    if (-not $fallbackBody) { $fallbackBody = "" }
                    # Strip forwarding headers and noise, keep just product-relevant lines
                    $fallbackLines = ($fallbackBody -split "`n") | ForEach-Object { $_.Trim() } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
                    $rawBody = ($fallbackLines -join " | ")
                    if ([string]::IsNullOrWhiteSpace($rawBody)) { $rawBody = "(empty email body)" }
                    # Truncate to 500 chars
                    if ($rawBody.Length -gt 500) { $rawBody = $rawBody.Substring(0, 500) }

                    $parsed.ProductRows = @(
                        @{
                            ProductName = $rawBody
                            PackCode    = ""
                            Quantity    = 0
                            IsCarton    = $false
                            _Base       = ""
                        }
                    )
                    # Fall through to normal POST flow below (no continue/skip)
                }

                # === v6.5 SECTION SPLITTING: Check for section markers (multi-customer / multi-delivery) ===
                $sectionMarkers = @($parsed.ProductRows | Where-Object { $_.ProductName -eq "__SECTION_MARKER__" })

                if ($sectionMarkers.Count -gt 0) {
                    # Split product rows into section groups
                    $sectionGroups = @()
                    $currentSection = @{ Number = 0; Type = ""; CustomerName = ""; CustomerCode = ""; DeliveryRemarks = ""; Rows = @(); Remarks = @() }

                    foreach ($row in $parsed.ProductRows) {
                        if ($row.ProductName -eq "__SECTION_MARKER__") {
                            if ($currentSection.Rows.Count -gt 0) {
                                $sectionGroups += $currentSection
                            }
                            $currentSection = @{
                                Number          = [int]$row.Quantity
                                Type            = [string]$row._SectionType
                                CustomerName    = [string]$row._CustomerName
                                CustomerCode    = [string]$row._CustomerCode
                                DeliveryRemarks = [string]$row._DeliveryRemarks
                                Rows            = @()
                                Remarks         = @()
                            }
                        } elseif ($row.ProductName -eq "__BILL_MARKER__") {
                            # Bill markers within a section — keep them for nested bill splitting
                            $currentSection.Rows += $row
                        } else {
                            $currentSection.Rows += $row
                        }
                    }
                    if ($currentSection.Rows.Count -gt 0) {
                        $sectionGroups += $currentSection
                    }

                    # Also handle orphan rows before first section marker (assign to section 1)
                    $orphanRows = @()
                    foreach ($row in $parsed.ProductRows) {
                        if ($row.ProductName -eq "__SECTION_MARKER__") { break }
                        if ($row.ProductName -ne "__BILL_MARKER__") {
                            $orphanRows += $row
                        }
                    }
                    if ($orphanRows.Count -gt 0 -and $sectionGroups.Count -gt 0) {
                        $sectionGroups[0].Rows = $orphanRows + $sectionGroups[0].Rows
                    }

                    # POST each section as a separate order
                    $sectionSuccess = $true
                    $sectionType = $sectionGroups[0].Type
                    foreach ($sg in $sectionGroups) {
                        if ($sg.Rows.Count -eq 0) { continue }

                        # Build entryId based on section type
                        $secEntryId = ""
                        if ($sectionType -eq "customer") {
                            $secEntryId = "${entryId}__Sec$($sg.Number)"
                        } else {
                            $secEntryId = "${entryId}__Bill$($sg.Number)"
                        }

                        # Build section-specific parsed object
                        $secParsed = @{
                            From             = $parsed.From
                            ReceiveDate      = $parsed.ReceiveDate
                            ReceiveTime      = $parsed.ReceiveTime
                            Subject          = $parsed.Subject
                            DeliveryRemarks  = if ($sg.DeliveryRemarks) { $sg.DeliveryRemarks } else { $parsed.DeliveryRemarks }
                            Remarks          = $parsed.Remarks
                            BillRemarks      = if ($sectionType -eq "delivery") { "Bill $($sg.Number)" } else { $parsed.BillRemarks }
                            ProductRows      = $sg.Rows
                            RemarkRows       = $parsed.RemarkRows
                            BodyCustomerName = if ($sectionType -eq "customer" -and $sg.CustomerName) { $sg.CustomerName } else { $parsed.BodyCustomerName }
                            BodyCustomerCode = if ($sectionType -eq "customer" -and $sg.CustomerCode) { $sg.CustomerCode } else { $parsed.BodyCustomerCode }
                        }

                        $lineCount = @($sg.Rows).Count
                        $typeLabel = if ($sectionType -eq "customer") { "Sec $($sg.Number) '$($sg.CustomerName)'" } else { "Bill $($sg.Number) '$($sg.DeliveryRemarks)'" }
                        Write-Host "[$(Get-Date -Format 'HH:mm:ss')] [POST] $($parsed.From) | $($parsed.Subject) | $typeLabel ($lineCount lines)..." -NoNewline

                        $result = Send-ToApi $secParsed $secEntryId $dispatchStatus $dispatchPriority $shipToOverride $slotToOverride

                        if ($result) {
                            if ($result.status -eq "duplicate") {
                                Write-Host " DUPE" -ForegroundColor DarkGray
                            } elseif ($result.status -eq "created") {
                                $color = if ($result.matchedLines -eq $result.totalLines) { "Green" } else { "Yellow" }
                                Write-Host " OK ($($result.matchedLines)/$($result.totalLines))" -ForegroundColor $color
                                Write-Log "Created $typeLabel order #$($result.orderId): $($result.matchedLines)/$($result.totalLines) | $($parsed.From) | $($parsed.Subject)"
                            } else {
                                Write-Host " $($result.status)" -ForegroundColor Cyan
                            }
                        } else {
                            Write-Host " FAILED" -ForegroundColor Red
                            $sectionSuccess = $false
                        }
                    }

                    if ($sectionSuccess) {
                        Write-Log "Processed $($sectionGroups.Count) sections ($sectionType mode) from: $($parsed.Subject)"
                        Mark-AsProcessed $ProcessedIds $entryId
                        $cycleProcessed++
                    }
                    continue
                }

                # === BILL SPLITTING: Check for bill markers in product rows ===
                $billMarkers = @($parsed.ProductRows | Where-Object { $_.ProductName -eq "__BILL_MARKER__" })

                if ($billMarkers.Count -gt 0) {
                    # Split product rows into bill groups
                    $billGroups = @()
                    $currentGroup = @{ BillNumber = 0; Rows = @() }

                    foreach ($row in $parsed.ProductRows) {
                        if ($row.ProductName -eq "__BILL_MARKER__") {
                            if ($currentGroup.Rows.Count -gt 0) {
                                $billGroups += $currentGroup
                            }
                            $currentGroup = @{ BillNumber = [int]$row.Quantity; Rows = @() }
                        } else {
                            $currentGroup.Rows += $row
                        }
                    }
                    if ($currentGroup.Rows.Count -gt 0) {
                        $billGroups += $currentGroup
                    }

                    # POST each bill as a separate order
                    $billSuccess = $true
                    foreach ($bg in $billGroups) {
                        if ($bg.BillNumber -eq 0) { continue }
                        $billEntryId = "${entryId}__Bill$($bg.BillNumber)"
                        $billBillRemarks = Build-BillRemarks $subjectSignals "Bill $($bg.BillNumber)" $parsed.Remarks
                        $billParsed = @{
                            From             = $parsed.From
                            ReceiveDate      = $parsed.ReceiveDate
                            ReceiveTime      = $parsed.ReceiveTime
                            Subject          = $parsed.Subject
                            DeliveryRemarks  = $parsed.DeliveryRemarks
                            Remarks          = "Bill $($bg.BillNumber)"
                            BillRemarks      = $billBillRemarks
                            ProductRows      = $bg.Rows
                            RemarkRows       = $parsed.RemarkRows
                        }

                        $lineCount = @($bg.Rows).Count
                        Write-Host "[$(Get-Date -Format 'HH:mm:ss')] [POST] $($parsed.From) | $($parsed.Subject) | Bill $($bg.BillNumber) ($lineCount lines)..." -NoNewline

                        $result = Send-ToApi $billParsed $billEntryId $dispatchStatus $dispatchPriority $shipToOverride $slotToOverride

                        if ($result) {
                            if ($result.status -eq "duplicate") {
                                Write-Host " DUPE" -ForegroundColor DarkGray
                            } elseif ($result.status -eq "created") {
                                $color = if ($result.matchedLines -eq $result.totalLines) { "Green" } else { "Yellow" }
                                Write-Host " OK ($($result.matchedLines)/$($result.totalLines))" -ForegroundColor $color
                                Write-Log "Created Bill $($bg.BillNumber) order #$($result.orderId): $($result.matchedLines)/$($result.totalLines) | $($parsed.From) | $($parsed.Subject)"
                            } else {
                                Write-Host " $($result.status)" -ForegroundColor Cyan
                            }
                        } else {
                            Write-Host " FAILED" -ForegroundColor Red
                            $billSuccess = $false
                        }
                    }

                    if ($billSuccess) {
                        Write-Log "Processed $($billGroups.Count) bills from: $($parsed.Subject)"
                        Mark-AsProcessed $ProcessedIds $entryId
                        $cycleProcessed++
                    }
                    continue
                }

                # POST to OrbitOMS API (single order - no bills)
                $lineCount = @($parsed.ProductRows).Count
                $remarkCount = @($parsed.RemarkRows).Count
                $remarkTag = if ($remarkCount -gt 0) { ", $remarkCount remarks" } else { "" }
                Write-Host "[$(Get-Date -Format 'HH:mm:ss')] [POST] $($parsed.From) | $($parsed.Subject) | $lineCount lines$remarkTag..." -NoNewline

                $result = Send-ToApi $parsed $entryId $dispatchStatus $dispatchPriority $shipToOverride $slotToOverride

                if ($result) {
                    if ($result.status -eq "duplicate") {
                        Write-Host " DUPE (order #$($result.orderId))" -ForegroundColor DarkGray
                        Write-Log "Duplicate: $($parsed.Subject) -> order #$($result.orderId)"
                    }
                    elseif ($result.status -eq "created") {
                        $color = if ($result.matchedLines -eq $result.totalLines) { "Green" } else { "Yellow" }
                        $statusTag = if ($dispatchStatus -eq "Hold") { " [HOLD]" } elseif ($dispatchPriority -eq "Urgent") { " [URGENT]" } else { "" }
                        Write-Host " OK ($($result.matchedLines)/$($result.totalLines) matched)$statusTag" -ForegroundColor $color
                        Write-Log "Created order #$($result.orderId): $($result.matchedLines)/$($result.totalLines) matched | $dispatchStatus/$dispatchPriority | $($parsed.From) | $($parsed.Subject)"
                    }
                    else {
                        Write-Host " $($result.status)" -ForegroundColor Cyan
                        Write-Log "API response: $($result | ConvertTo-Json -Compress)"
                    }
                } else {
                    Write-Host " FAILED" -ForegroundColor Red
                    continue
                }

                Mark-AsProcessed $ProcessedIds $entryId
                $cycleProcessed++

            } catch {
                $errSubj = "(unknown subject)"
                try { $errSubj = $mail.Subject } catch { }
                Write-Log "Error processing email: $_ | Subject: $errSubj - marking processed" "ERROR"
                Write-Host "[$(Get-Date -Format 'HH:mm:ss')] [ERROR] $errSubj - $_" -ForegroundColor Red
                try { Mark-AsProcessed $ProcessedIds $mail.EntryID } catch { }
            }
        }

        # Save processed IDs
        if ($cycleProcessed -gt 0) {
            $ProcessedIds = Save-ProcessedIds $ProcessedIds
            Write-Log "Cycle complete: $cycleProcessed emails processed"
        }

    } catch {
        Write-Log "Main loop error: $_ - retrying" "ERROR"
        Write-Host "[$(Get-Date -Format 'HH:mm:ss')] ERROR: $_ - retrying..." -ForegroundColor Red
        try {
            $Outlook = Connect-Outlook
            if ($Outlook) { $OrderFolder = Get-OrderFolder $Outlook }
        } catch {
            Write-Log "Reconnection failed: $_" "ERROR"
        }
    }

    Start-Sleep -Seconds $CheckInterval
}

#endregion
