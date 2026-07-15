# ============================================================
#  test-app-parser.ps1  (v7.2 offline validator)
#  Loads Parse-MailOrders-V7.ps1 function definitions WITHOUT
#  running STARTUP (Outlook) or MAIN LOOP, then validates the
#  App-format routing + header block + dispatch + remarks + Bill N.
#  Live parser is READ-ONLY. Nothing here touches Outlook or the API.
# ============================================================

$ErrorActionPreference = "Stop"

# ── STEP 1: load parser functions WITHOUT running it ──────────
$parserPath = "C:\Users\HP\OneDrive\VS Code\orbit-oms\docs\Parser\Parse-MailOrders-V7.ps1"
$src = Get-Content $parserPath -Raw

$idx = $src.IndexOf("#region STARTUP")
if ($idx -lt 0) { throw "Could not find '#region STARTUP' in parser — aborting." }
$head = $src.Substring(0, $idx)   # CONFIG + all functions + top-level vars; drops STARTUP + MAIN LOOP

$tempDir = Join-Path $env:TEMP "_app_parser_test"
if (-not (Test-Path $tempDir)) { New-Item -ItemType Directory -Path $tempDir | Out-Null }

$funcsFile = Join-Path $tempDir "_parser_funcs.ps1"
Set-Content -Path $funcsFile -Value $head -Encoding UTF8

# Dummy config.txt so the CONFIG region doesn't call exit
$configLines = @(
    "ApiBaseUrl=http://localhost",
    "HmacSecret=test",
    "BaseDir=$tempDir",
    "OutlookAccount=test",
    "CheckInterval=10"
)
Set-Content -Path (Join-Path $tempDir "config.txt") -Value $configLines -Encoding UTF8

# Dot-source: CONFIG reads dummy config + every function is defined; STARTUP/MAIN LOOP are gone
. $funcsFile

# Test globals
$script:CarryProduct = ""; $script:CarryBase = ""; $script:BaseKW=@(); $script:ProdKW=@()
$IgnoreRemarks = @()
$ClassificationKeywords = @{ ProductKeywords=@(); BaseKeywords=@(); CustomerKeywords=@(); AreaKeywords=@() }

# ── STEP 2: fake mail builder ─────────────────────────────────
function New-FakeMail($body, $subject) {
    $att = New-Object psobject; $att | Add-Member NoteProperty Count 0
    $m = New-Object psobject
    $m | Add-Member NoteProperty Body $body
    $m | Add-Member NoteProperty Subject $subject
    $m | Add-Member NoteProperty SenderName "Test"
    $m | Add-Member NoteProperty ReceivedTime (Get-Date)
    $m | Add-Member NoteProperty Attachments $att
    $m | Add-Member NoteProperty EntryID "TEST"
    return $m
}

# ── STEP 3: samples (single-quoted here-strings, verbatim) ────
$bodyA = @'
From: Ravi Patel <ravi.patel@akzonobel.com>
Sent: Friday, 19 June 2026 05:44:41
To: Surat Depot <surat.depot@akzonobel.com>
Subject: Order — MOHAN COLOUR CO 102425

BEWARE! This is an external email. Think before you click!

Bill To: MOHAN COLOUR CO (102425)
Dispatch: Urgent
Ship To: LAKHANI PAINTS (109845)
Note: Pls share DPL

GLOSS BRILLIANT WHITE 100ML*24, 200ML*12, 500ML*12, 1L*6, 4L*4, 10L*1, 20L*1
'@

$bodyB = @'
From: Ravi Patel <ravi.patel@akzonobel.com>
Sent: Friday, 19 June 2026 05:50:00
To: Surat Depot <surat.depot@akzonobel.com>
Subject: Order — NIJNAAM PUMP AND HAREWARE 3322447

Bill To: NIJNAAM PUMP AND HAREWARE (3322447)
Dispatch: Call to Dealer

Bill 1
WS MAX BRILLIANT WHITE 1L*6, 4L*4, 10L*1, 20L*1

Bill 2
DAMP PROTECT BASECOAT 1L*6, 4L*4, 10L*1, 20L*1

Bill 3
CEMENT PRIMER SB 10L*10, 20L*10
'@

$bodyC = @'
From: Ravi Patel <ravi.patel@akzonobel.com>
Sent: Friday, 19 June 2026 06:00:00
To: Surat Depot <surat.depot@akzonobel.com>
Subject: Order — AMBIKA COLOUR WORLD 3041092

Bill To: AMBIKA COLOUR WORLD (3041092)
Remark: Cross Billing from Dahisar
Note: Pls send stickers

UNIVERSAL STAINER YELLOW OXIDE 50ML*20, 100ML*20, 200ML*10
ACOTONE NO1 1L*6
'@

$bodyD = @'
From: (JSW) Ravi Patel <ravi.patel@akzonobel.com>
Sent: Tuesday, 16 June 2026 13:16:01
To: Surat Depot <surat.depot@akzonobel.com>
Subject: Order for Mohan Colour Co

Bill 1
Supercover Brilliant White- 10*3, 4*8, 1*18
Ws Brilliant White- 1*9, 4*2

Bill 2
VT 92- 1*6
Smartchoice Interior- 1*6, 4*4, 10*1, 20*1
'@

$bodyE = @'
From: Ravi Patel <ravipatel.dulux@gmail.com>
Sent: Friday, 19 June 2026 05:44:41
To: Surat Depot <surat.depot@akzonobel.com>
Subject: Order for Mohan Colour Co

Delivery- Aadil Colours

Ws Floor Plus 93- 20*1
Zinc Yellow Primer- 20*2
ST Primer- 20*2
'@

# --- F: new app format — "n. {product} - {pack}*{qty}, ..." line items ---
$bodyF = @'
From: Ravi Patel <ravi.patel@akzonobel.com>
Sent: Friday, 19 June 2026 06:30:00
To: Surat Depot <surat.depot@akzonobel.com>
Subject: Order — MOHAN COLOUR CO 102425

Bill To: MOHAN COLOUR CO (102425)
Ship To: DEV COLOURS (277842)
Dispatch: Urgent

1. GLOSS BRILLIANT WHITE - 100ML*24, 200ML*12, 500ML*12, 1L*6
2. 1K PU GLOSS Clear - 500ML*12, 1L*6
3. MACHINE TINTER YOX - 1L*6
4. MACHINE TINTER LFY - 1L*6
'@

# --- G: name-lock proof — verbatim names incl. tricky bare-code base "93" ---
$bodyG = @'
From: Ravi Patel <ravi.patel@akzonobel.com>
Sent: Friday, 19 June 2026 07:00:00
To: Surat Depot <surat.depot@akzonobel.com>
Subject: Order — TEST NAME LOCK 999999

Bill To: TEST NAME LOCK (999999)

1. WS MAX 94 BASE - 1L*6, 4L*4
2. SUPERCOVER 93 - 20L*1
3. 1K PU GLOSS Clear - 500ML*12
'@

# --- H: v7.3 app-only piece-pack peel — "1 pc*12" TOOLS packs from /po ---
$bodyH = @'
From: Harsh Patel <harsh.patel@akzonobel.com>
Sent: Wednesday, 15 July 2026 09:23:00
To: Surat Depot <surat.depot@akzonobel.com>
Subject: Order - AMBIKA ENTERPRISE 3296171

Bill To: AMBIKA ENTERPRISE (3296171)
1. Signature Brush Double 3 - 1 pc*12
2. Signature Brush Double 5 - 1 pc*12
3. Smart Brush Double 4 All India - 1 pc*12
4. Super Brush Double 4 All India - 1 pc*12
5. Smart Unifiber Int Roller 4 - 1 pc*25
6. Signature Epoxy Int Roller 4 - 1 pc*25
 
Regards
Harsh Patel
'@

$samples = @(
    @{ Name="A"; Body=$bodyA; Subject="Order — MOHAN COLOUR CO 102425" },
    @{ Name="B"; Body=$bodyB; Subject="Order — NIJNAAM PUMP AND HAREWARE 3322447" },
    @{ Name="C"; Body=$bodyC; Subject="Order — AMBIKA COLOUR WORLD 3041092" },
    @{ Name="D"; Body=$bodyD; Subject="Order for Mohan Colour Co" },
    @{ Name="E"; Body=$bodyE; Subject="Order for Mohan Colour Co" },
    @{ Name="F"; Body=$bodyF; Subject="Order — MOHAN COLOUR CO 102425" },
    @{ Name="G"; Body=$bodyG; Subject="Order — TEST NAME LOCK 999999" },
    @{ Name="H"; Body=$bodyH; Subject="Order - AMBIKA ENTERPRISE 3296171" }
)

# ── STEP 4: run, print, assert ────────────────────────────────
$script:pass = 0
$script:fail = 0
function Assert($id, $cond) {
    if ($cond) { Write-Host "  $id PASS" -ForegroundColor Green; $script:pass++ }
    else       { Write-Host "  $id FAIL" -ForegroundColor Red;   $script:fail++ }
}

# Parse each sample, keep results keyed by name
$results = @{}

foreach ($s in $samples) {
    $mail = New-FakeMail $s.Body $s.Subject

    $isApp = $false
    try { $isApp = Test-IsAppFormat $mail } catch { $isApp = $false }
    $routed = if ($isApp) { "APP" } else { "HUMAN" }

    if ($isApp) {
        $parsed = Parse-AppBody $mail $IgnoreRemarks $ClassificationKeywords
    } else {
        $parsed = Parse-EmailBody $mail $IgnoreRemarks $ClassificationKeywords
    }

    $billMarkers = @($parsed.ProductRows | Where-Object { $_.ProductName -eq "__BILL_MARKER__" })
    $billCount   = $billMarkers.Count
    $prodCount   = @($parsed.ProductRows).Count

    $results[$s.Name] = @{ Routed=$routed; IsApp=$isApp; Parsed=$parsed; BillCount=$billCount }

    Write-Host ""
    Write-Host "===== Sample $($s.Name) ·  Routed: $routed =====" -ForegroundColor Cyan
    Write-Host "  BodyCustomerName   : $($parsed.BodyCustomerName)"
    Write-Host "  BodyCustomerCode   : $($parsed.BodyCustomerCode)"
    Write-Host "  DeliveryRemarks    : $($parsed.DeliveryRemarks)"
    Write-Host "  AppShipToOverride  : $($parsed.AppShipToOverride)"
    Write-Host "  AppDispatchStatus  : $($parsed.AppDispatchStatus)"
    Write-Host "  AppDispatchPriority: $($parsed.AppDispatchPriority)"
    Write-Host "  Remarks            : $($parsed.Remarks)"
    if ($parsed.RemarkRows -and @($parsed.RemarkRows).Count -gt 0) {
        foreach ($r in $parsed.RemarkRows) {
            Write-Host "  RemarkRow          : ($($r.RemarkType) | $($r.RawText))"
        }
    } else {
        Write-Host "  RemarkRow          : (none)"
    }
    foreach ($pr in $parsed.ProductRows) {
        Write-Host "  ProductRow         : ($($pr.ProductName) | $($pr.PackCode) | $($pr.Quantity))"
    }
    Write-Host "  __BILL_MARKER__ ct : $billCount"
    Write-Host "  product-row count  : $prodCount"
}

# Helper: does any RemarkRow rawText contain a substring?
function Any-RemarkRawContains($parsed, $needle) {
    if (-not $parsed.RemarkRows) { return $false }
    foreach ($r in $parsed.RemarkRows) {
        if ([string]$r.RawText -and ([string]$r.RawText).ToLower().Contains($needle.ToLower())) { return $true }
    }
    return $false
}
function Any-RemarkTypeEquals($parsed, $type) {
    if (-not $parsed.RemarkRows) { return $false }
    foreach ($r in $parsed.RemarkRows) {
        if ([string]$r.RemarkType -eq $type) { return $true }
    }
    return $false
}

Write-Host ""
Write-Host "===== ASSERTIONS =====" -ForegroundColor Yellow

$A = $results["A"].Parsed
Assert "A1 Routed=APP"                  ($results["A"].Routed -eq "APP")
Assert "A2 BodyCustomerCode=102425"     ($A.BodyCustomerCode -eq "102425")
Assert "A3 AppShipToOverride=`$true"     ($A.AppShipToOverride -eq $true)
Assert "A4 AppDispatchPriority=Urgent"  ($A.AppDispatchPriority -eq "Urgent")
Assert "A5 DeliveryRemarks has 109845"  ([string]$A.DeliveryRemarks).Contains("109845")

$B = $results["B"].Parsed
Assert "B1 Routed=APP"                  ($results["B"].Routed -eq "APP")
Assert "B2 AppDispatchStatus=Hold"      ($B.AppDispatchStatus -eq "Hold")
Assert "B3 RemarkRow has 'Dealer'"      (Any-RemarkRawContains $B "Dealer")
Assert "B4 __BILL_MARKER__ count=3"     ($results["B"].BillCount -eq 3)

$C = $results["C"].Parsed
Assert "C1 Routed=APP"                  ($results["C"].Routed -eq "APP")
Assert "C2 BodyCustomerCode=3041092"    ($C.BodyCustomerCode -eq "3041092")
Assert "C3 RemarkRow RemarkType=cross"  (Any-RemarkTypeEquals $C "cross")

Assert "D1 Routed=HUMAN"                ($results["D"].Routed -eq "HUMAN")

Assert "E1 Routed=HUMAN"                ($results["E"].Routed -eq "HUMAN")

$F = $results["F"].Parsed
Assert "F1 Routed=APP"                  ($results["F"].Routed -eq "APP")
Assert "F2 BodyCustomerCode=102425"     ($F.BodyCustomerCode -eq "102425")
Assert "F3 AppShipToOverride=`$true"     ($F.AppShipToOverride -eq $true)
Assert "F4 DeliveryRemarks has 277842"  ([string]$F.DeliveryRemarks).Contains("277842")
Assert "F5 AppDispatchPriority=Urgent"  ($F.AppDispatchPriority -eq "Urgent")
Assert "F6 __BILL_MARKER__ count=0"     ($results["F"].BillCount -eq 0)
Assert "F7 product-row count >= 4"      (@($F.ProductRows).Count -ge 4)

# ── G: app name-lock ──────────────────────────────────────────
$G = $results["G"].Parsed
$gProd = @($G.ProductRows | Where-Object { $_.ProductName -ne "__BILL_MARKER__" })
$gAllowed = @("WS MAX 94 BASE", "SUPERCOVER 93", "1K PU GLOSS Clear")
$g1 = ($gProd.Count -gt 0)
foreach ($pr in $gProd) { if ($gAllowed -notcontains [string]$pr.ProductName) { $g1 = $false } }

# G2: each expected (name, pack, qty) tuple is present among the rows
function Has-Row($rows, $name, $pack, $qty) {
    foreach ($r in $rows) {
        if (([string]$r.ProductName -eq $name) -and ([string]$r.PackCode -eq $pack) -and ([string]$r.Quantity -eq $qty)) { return $true }
    }
    return $false
}
$g2 = (Has-Row $gProd "WS MAX 94 BASE" "1" "6") -and
      (Has-Row $gProd "WS MAX 94 BASE" "4" "4") -and
      (Has-Row $gProd "SUPERCOVER 93" "20" "1") -and
      (Has-Row $gProd "1K PU GLOSS Clear" "500" "12")

Assert "G1 names verbatim (3 allowed)"   $g1
Assert "G2 pack rows correct"            $g2
Assert "G3 __BILL_MARKER__ count=0"      ($results["G"].BillCount -eq 0)

# ── H: v7.3 app-only piece-pack peel — "1 pc*12" TOOLS packs ─────
$H = $results["H"].Parsed
$hProd = @($H.ProductRows | Where-Object { $_.ProductName -ne "__BILL_MARKER__" })

Assert "H1 Routed=APP"                  ($results["H"].Routed -eq "APP")
Assert "H2 BodyCustomerName=AMBIKA ENTERPRISE" ($H.BodyCustomerName -eq "AMBIKA ENTERPRISE")
Assert "H2 BodyCustomerCode=3296171"    ($H.BodyCustomerCode -eq "3296171")
Assert "H3 ProductRows.Count=6"         ($hProd.Count -eq 6)
Assert "H4 RemarkRows.Count=0"          (@($H.RemarkRows).Count -eq 0)
Assert "H5 row1 name/pack/qty"          (Has-Row $hProd "Signature Brush Double 3" "1" "12")
Assert "H6 row5 name/pack/qty"          (Has-Row $hProd "Smart Unifiber Int Roller 4" "1" "25")
$hNoBillTo = $true
foreach ($pr in $hProd) { if (([string]$pr.ProductName).ToUpper().Contains("BILL TO")) { $hNoBillTo = $false } }
Assert "H7 no row contains 'Bill To'"   $hNoBillTo

Write-Host ""
Write-Host "TOTAL: $($script:pass) passed / $($script:fail) failed" -ForegroundColor $(if ($script:fail -eq 0) { "Green" } else { "Red" })
