# ============================================================
#  Auto-Import-v2.ps1 -- v1.0
#  Pure-JSON auto-import pipeline for OrbitOMS
#
#  Replaces per-OBD xlsx file downloads (v1) with in-memory
#  FormGetData JSON calls.  No Excel files created.  A
#  pre-check skips OBDs already present in OrbitOMS.
#
#  v1 (Auto-Import.ps1) continues to run independently on its
#  own Task Scheduler entry and is NOT modified by this script.
#
#  Pipeline order (per cycle):
#    Phase 1  - Cleanup + daily reset
#    Phase 2  - Login (cached session reused, lazy re-login)
#    Phase 3  - Yesterday recovery (first-of-day)
#    Phase 4  - Spec prime
#    Phase 5  - Pending JSON upload retry
#    Phase 6  - /data pagination for today (full header rows)
#    Phase 6b - Pre-check: drop OBDs already in OrbitOMS
#    Phase 7  - FormGetData per new OBD (in-memory)
#    Phase 8  - Retry FormGetData failures from prior runs
#    Phase 9  - Build payload + POST ?action=auto-json
#    Phase 9.5- Patch headers for existing OBDs (?action=patch-headers)
#    Phase 10 - Human-noise background GET
#    Phase 11 - Cycle summary
#
#  PowerShell 5.1.  Run via Task Scheduler (every 10 min).
# ============================================================

param(
    [switch]$SkipYesterday,
    [switch]$DryRun,
    [string]$TargetDate = ""
)

#region CONFIG

$ToolRoot          = "F:\VS Code\OBD-Import Tool v2"
$OutputFolder      = "$ToolRoot\Output"
$PendingJsonFolder = "$ToolRoot\Output\pending-json"
$KeywordsFile      = "$ToolRoot\Master\tinting-keywords.txt"
$PackSizesFile     = "$ToolRoot\Master\pack-sizes.txt"
$KeyFileJson       = "$ToolRoot\import-key-json.txt"    # v2 HMAC secret
$ConfigFile        = "$ToolRoot\breakwalls-config.txt"
$LogFolder         = "$ToolRoot\logs"

# State files (Master folder)
$DailyStateFile      = "$ToolRoot\Master\daily-state.txt"
$SessionFile         = "$ToolRoot\Master\session-cookie.txt"
$FailedJsonObdsFile  = "$ToolRoot\Master\failed-obds-json.txt"
$YesterdayStateFile  = "$ToolRoot\Master\yesterday-recovery-state.txt"
$PendingJsonFile     = "$ToolRoot\Master\pending-upload-json.txt"
$LastSpecCallFile    = "$ToolRoot\Master\last-spec-call.txt"
$LastNoiseCallFile   = "$ToolRoot\Master\last-noise-call.txt"

# v2 API endpoints
$ApiUrlCheck    = "https://www.orbitoms.in/api/import/obd?action=check"
$ApiUrlAutoJson     = "https://www.orbitoms.in/api/import/obd?action=auto-json"
$ApiUrlPatchHeaders = "https://www.orbitoms.in/api/import/obd?action=patch-headers"
$KeyIdJson          = "auto-import-json-v1"

# Breakwalls
$BaseUrl            = "https://an.breakwalls.biz"
$LoginPath          = "/deco-tracker/LoginV2/Login.aspx"
$ReportPath         = "/deco-tracker/Reports/105VCsI1rQ6u1QSEyGJ7I3Lc"
$DataPath           = "/deco-tracker/data"
$FormdataPath       = "/deco-tracker/formdata"
$SpecPath           = "/deco-tracker/spec"
$AppVersionFallback = "VmRhZP4kZj=="

# Time + date
$Today     = Get-Date -Format "yyyy-MM-dd"
$Yesterday = (Get-Date).AddDays(-1).ToString("yyyy-MM-dd")
$KeepDays  = 2

# Session reuse: try cached cookie up to 4 hours old
$CookieMaxAgeMin  = 240

# Spec call cache: skip /spec if called within last 2 hours
$SpecCacheMinutes = 120

# Noise call: every 30-60 min
$NoiseMinIntervalMin = 30
$NoiseMaxIntervalMin = 60

# Cycle summary tracking
$Summary = [ordered]@{
    CycleStart               = Get-Date
    DateChecked              = $Today
    BreakwallsTotal          = "?"
    PreCheckNew              = 0
    PreCheckExisting         = 0
    FetchedThis              = 0
    FailedThis               = 0
    YesterdayRan             = $false
    YesterdayBreakwallsTotal = 0
    YesterdayPreCheckNew     = 0
    YesterdayFetched         = 0
    YesterdayFailed          = 0
    YesterdayUpload          = "n/a"
    UploadStatus             = "n/a"
    UploadImported           = 0
    UploadSkipped            = 0
    UploadErrors             = 0
    PendingUpload            = $false
    SessionAction            = "?"
    PaginationMode           = "?"
    Errors                   = [System.Collections.Generic.List[string]]::new()
}

#endregion


#region LOGGING

if (-not (Test-Path $LogFolder)) { New-Item -ItemType Directory -Path $LogFolder | Out-Null }
$LogFile = "$LogFolder\import-v2-log-$(Get-Date -Format 'yyyy-MM-dd').txt"

# (verbatim from v1)
function Write-Log {
    param([string]$Message, [string]$Color = "Gray")
    $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Message"
    Add-Content -Path $LogFile -Value $line
    if ($Color -eq "Gray") {
        Write-Host $line
    } else {
        Write-Host $line -ForegroundColor $Color
    }
}

# (verbatim from v1)
function Write-Section {
    param([string]$Title, [string]$Color = "Cyan")
    $line1 = "============================================================"
    $line2 = " $Title"
    Add-Content -Path $LogFile -Value $line1
    Add-Content -Path $LogFile -Value $line2
    Add-Content -Path $LogFile -Value $line1
    Write-Host $line1 -ForegroundColor $Color
    Write-Host $line2 -ForegroundColor $Color
    Write-Host $line1 -ForegroundColor $Color
}

# Clean v2 logs older than 30 days
Get-ChildItem -Path $LogFolder -Filter "import-v2-log-*.txt" -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } |
    Remove-Item -Force -ErrorAction SilentlyContinue

#endregion


#region HELPERS  (verbatim copies from v1 unless noted)

function Get-HiddenField([string]$Html, [string]$FieldName) {
    $p1 = 'id="' + $FieldName + '"[^>]*value="([^"]*)"'
    $p2 = 'name="' + $FieldName + '"[^>]*value="([^"]*)"'
    $p3 = 'value="([^"]*)"[^>]*id="' + $FieldName + '"'
    $p4 = 'value="([^"]*)"[^>]*name="' + $FieldName + '"'
    foreach ($p in @($p1, $p2, $p3, $p4)) {
        if ($Html -match $p) { return $Matches[1] }
    }
    return $null
}

function Get-RandomDelay {
    param([int]$Min = 3, [int]$Max = 8)
    $seconds = Get-Random -Minimum $Min -Maximum $Max
    Start-Sleep -Seconds $seconds
}

$Script:CurrentAppVersion = $AppVersionFallback

function Get-BrowserHeaders {
    return @{
        "Accept"             = "application/json"
        "AppVersion"         = $Script:CurrentAppVersion
        "Origin"             = $BaseUrl
        "Referer"            = "$BaseUrl$ReportPath"
        "sec-ch-ua"          = '"Chromium";v="134", "Not:A-Brand";v="24", "Google Chrome";v="134"'
        "sec-ch-ua-mobile"   = "?0"
        "sec-ch-ua-platform" = '"Windows"'
        "Sec-Fetch-Dest"     = "empty"
        "Sec-Fetch-Mode"     = "cors"
        "Sec-Fetch-Site"     = "same-origin"
        "X-Requested-With"   = "XMLHttpRequest"
    }
}

function Get-NumericOnly {
    param([string]$val)
    $cleaned = ($val -replace '[^\d.]', '').Trim()
    if ($cleaned -eq "") { return "" }
    return $cleaned
}

function Get-Tinting {
    param([string]$skuDesc, [string]$smu)
    if ($smu -ne "Decorative Projects" -and $smu -ne "Retail Offtake") { return "FALSE" }
    $upper = $skuDesc.ToUpper()
    foreach ($kw in $tintingKeywords) {
        if ($upper.Contains($kw)) { return "TRUE" }
    }
    return "FALSE"
}

function Get-ArticleInfo {
    param([string]$volumeRaw, [string]$unitRaw)
    $volStr  = ($volumeRaw -replace '[^\d.]', '').Trim()
    $unitStr = ($unitRaw   -replace '[^\d.]', '').Trim()
    if ($volStr -eq "" -or $unitStr -eq "" -or [decimal]$unitStr -eq 0) {
        return @{ Article = ""; Tag = "" }
    }
    $volume   = [decimal]$volStr
    $unit     = [int]$unitStr
    $packSize = [Math]::Round($volume / $unit, 4)

    if ($drumSizes -contains $packSize) {
        return @{ Article = "$unit"; Tag = "$unit Drum" }
    }
    if ($bagSizes -contains $packSize) {
        return @{ Article = "$unit"; Tag = "$unit Bag" }
    }
    if ($cartonMap.ContainsKey($packSize)) {
        $unitsPerCarton = $cartonMap[$packSize]
        $fullCartons    = [Math]::Floor($unit / $unitsPerCarton)
        $looseTins      = $unit % $unitsPerCarton
        $articleCount   = $fullCartons + $looseTins
        $tagParts = @()
        if ($fullCartons -gt 0) { $tagParts += "$fullCartons Carton" }
        if ($looseTins   -gt 0) { $tagParts += "$looseTins Tin" }
        if ($tagParts.Count -eq 0) { $tagParts += "0 Tin" }
        return @{ Article = "$articleCount"; Tag = ($tagParts -join " ") }
    }
    return @{ Article = ""; Tag = "" }
}

function Test-IsLoginRedirect {
    param([string]$Content)
    if (-not $Content) { return $false }
    if ($Content -match 'LoginV2/Login\.aspx') { return $true }
    if ($Content -match 'name="__VIEWSTATE"' -and $Content -match 'inpUserName') { return $true }
    return $false
}

function Initialize-Session {
    $sess = New-Object Microsoft.PowerShell.Commands.WebRequestSession
    $sess.UserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36"

    if (Test-Path $SessionFile) {
        $sessionLines = Get-Content $SessionFile -ErrorAction SilentlyContinue
        if ($sessionLines.Count -ge 2) {
            $cachedCookieValue = $sessionLines[0].Trim()
            $cachedTimestamp   = $sessionLines[1].Trim()

            $savedAt = $null
            try {
                $savedAt = [datetime]::ParseExact($cachedTimestamp, "yyyy-MM-dd HH:mm:ss", $null)
            } catch {
                $savedAt = $null
            }

            if ($savedAt) {
                # FIX: parentheses required around (Get-Date) for subtraction
                $ageMin = ((Get-Date) - $savedAt).TotalMinutes
                if ($ageMin -lt $CookieMaxAgeMin -and $cachedCookieValue) {
                    $bwuCookie = New-Object System.Net.Cookie(".BWU", $cachedCookieValue, "/", "an.breakwalls.biz")
                    $sess.Cookies.Add($bwuCookie)
                    Write-Log "LOGIN - Reusing cached session (age: $([Math]::Round($ageMin, 1)) min)" "Green"
                    $Summary.SessionAction = "reused"
                    return @{ Session = $sess; Cached = $true }
                } else {
                    Write-Log "LOGIN - Cached session too old ($([Math]::Round($ageMin, 1)) min), will login fresh"
                }
            } else {
                Write-Log "LOGIN - Could not parse cached timestamp, will login fresh"
            }
        }
    }

    return @{ Session = $sess; Cached = $false }
}

function Invoke-FreshLogin {
    param($Session, [hashtable]$Config)

    $maxAttempts = 3
    for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {

        try {
            $loginPage = Invoke-WebRequest `
                -Uri ($BaseUrl + $LoginPath) `
                -Method GET `
                -WebSession $Session `
                -UseBasicParsing `
                -ErrorAction Stop

            $html = $loginPage.Content

            if ($html -match 'AppVersion["'']?\s*[:=]\s*["'']([^"'']+)["'']') {
                $Script:CurrentAppVersion = $Matches[1]
                Write-Log "LOGIN - Refreshed AppVersion: $($Script:CurrentAppVersion)"
            }

            $viewState          = Get-HiddenField $html "__VIEWSTATE"
            $viewStateGenerator = Get-HiddenField $html "__VIEWSTATEGENERATOR"
            $viewStateEncrypted = Get-HiddenField $html "__VIEWSTATEENCRYPTED"
            $eventValidation    = Get-HiddenField $html "__EVENTVALIDATION"

            if (-not $viewState) {
                Write-Log "LOGIN attempt $attempt - VIEWSTATE missing" "Yellow"
                if ($attempt -lt $maxAttempts) { Start-Sleep -Seconds (10 * $attempt) }
                continue
            }

            Get-RandomDelay -Min 2 -Max 5

            $loginBody = @{
                "__VIEWSTATE"          = $viewState
                "__VIEWSTATEGENERATOR" = $viewStateGenerator
                "__VIEWSTATEENCRYPTED" = if ($viewStateEncrypted) { $viewStateEncrypted } else { "" }
                "__EVENTVALIDATION"    = $eventValidation
                "ctl00`$ContentPlaceHolderCardBody`$inpUserName" = $Config["USERNAME"]
                "ctl00`$ContentPlaceHolderCardBody`$inpPassword" = $Config["PASSWORD"]
            }

            $loginResponse = Invoke-WebRequest `
                -Uri ($BaseUrl + $LoginPath) `
                -Method POST `
                -Body $loginBody `
                -WebSession $Session `
                -UseBasicParsing `
                -MaximumRedirection 5 `
                -ErrorAction Stop

            $bwuCookie = $Session.Cookies.GetCookies($BaseUrl) | Where-Object { $_.Name -eq ".BWU" }
            if (-not $bwuCookie) {
                Write-Log "LOGIN attempt $attempt - .BWU cookie not received" "Yellow"
                if ($attempt -lt $maxAttempts) { Start-Sleep -Seconds (10 * $attempt) }
                continue
            }

            @(
                $bwuCookie.Value,
                (Get-Date -Format "yyyy-MM-dd HH:mm:ss")
            ) | Set-Content $SessionFile

            Write-Log "LOGIN - Authenticated successfully (attempt $attempt), session cached" "Green"
            $Summary.SessionAction = "fresh"
            return $true

        } catch {
            Write-Log "LOGIN attempt $attempt failed: $_" "Yellow"
            if ($attempt -lt $maxAttempts) { Start-Sleep -Seconds (10 * $attempt) }
        }
    }

    Write-Log "LOGIN - All $maxAttempts attempts failed" "Red"
    return $false
}

function Invoke-SpecPrime {
    param($Session, [string]$Reason = "default")

    if ((Test-Path $LastSpecCallFile) -and ($Reason -eq "default")) {
        $lastSpecRaw = (Get-Content $LastSpecCallFile -ErrorAction SilentlyContinue).Trim()
        $lastSpec = $null
        try { $lastSpec = [datetime]::ParseExact($lastSpecRaw, "yyyy-MM-dd HH:mm:ss", $null) } catch { $lastSpec = $null }
        if ($lastSpec) {
            $ageMin = ((Get-Date) - $lastSpec).TotalMinutes
            if ($ageMin -lt $SpecCacheMinutes) {
                Write-Log "SPEC - Cached spec is $([Math]::Round($ageMin,1)) min old, skipping"
                return $true
            }
        }
    }

    Write-Log "SPEC - Priming ($Reason)"

    $specBody = [ordered]@{ reportId = "Reports/105VCsI1rQ6u1QSEyGJ7I3Lc" } | ConvertTo-Json -Depth 3

    try {
        $specResponse = Invoke-WebRequest `
            -Uri ($BaseUrl + $SpecPath) `
            -Method POST `
            -Body $specBody `
            -ContentType "application/json" `
            -Headers (Get-BrowserHeaders) `
            -WebSession $Session `
            -UseBasicParsing `
            -ErrorAction Stop

        (Get-Date -Format "yyyy-MM-dd HH:mm:ss") | Set-Content $LastSpecCallFile
        $kb = [Math]::Round($specResponse.Content.Length / 1024, 1)
        Write-Log "SPEC - Primed OK ($kb KB)"
        return $true
    } catch {
        Write-Log "SPEC - Failed: $_" "Yellow"
        return $false
    }
}

function Get-OBDListPage {
    param([int]$PageNum, [string]$Date, $Session, [hashtable]$Config)

    $maxAttempts = 3
    for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {

        $bodyJson = [ordered]@{
            reportId    = "Reports/105VCsI1rQ6u1QSEyGJ7I3Lc"
            componentId = "c01105VCsI1rQ6u1QSEyGJ7I3Lc"
            filters     = @()
            page        = $PageNum
            size        = 20
            sorters     = @()
            params      = @(
                [ordered]@{ field = "picklistdate"; value = $Date }
                [ordered]@{ field = "transporter";  value = "Select Transporter" }
                [ordered]@{ field = "formName";     value = "" }
            )
        } | ConvertTo-Json -Depth 5

        try {
            $response = Invoke-WebRequest `
                -Uri ($BaseUrl + $DataPath) `
                -Method POST `
                -Body $bodyJson `
                -ContentType "application/json" `
                -Headers (Get-BrowserHeaders) `
                -WebSession $Session `
                -UseBasicParsing `
                -ErrorAction Stop

            if (Test-IsLoginRedirect $response.Content) {
                Write-Log "OBD LIST - Session expired during page $PageNum, re-login" "Yellow"
                if (Test-Path $SessionFile) { Remove-Item $SessionFile -Force }
                $relogin = Invoke-FreshLogin -Session $Session -Config $Config
                if (-not $relogin) { return $null }
                Invoke-SpecPrime -Session $Session -Reason "post-relogin" | Out-Null
                continue
            }

            $parsed = $response.Content | ConvertFrom-Json
            if (-not $parsed.success) {
                Write-Log "OBD LIST - Page $PageNum returned success=false (attempt $attempt)" "Yellow"
                if ($attempt -lt $maxAttempts) { Start-Sleep -Seconds (5 * $attempt) }
                continue
            }
            return $parsed

        } catch {
            Write-Log "OBD LIST - Page $PageNum attempt $attempt failed: $_" "Yellow"
            if ($attempt -lt $maxAttempts) { Start-Sleep -Seconds (5 * $attempt) }
        }
    }

    return $null
}

function Get-TotalCount {
    param($PageResult)
    if (-not $PageResult) { return -1 }

    $candidates = @('total_count', 'totalCount', 'total', 'totalRecords', 'recordsFiltered', 'recordsTotal', 'count', 'last_row')
    foreach ($f in $candidates) {
        if ($PageResult.PSObject.Properties[$f]) {
            $v = $PageResult.$f
            if ($v -is [int] -or $v -is [long]) { return [int]$v }
            if ($v -match '^\d+$') { return [int]$v }
        }
    }

    return -1
}

function Get-TallyFilePath {
    param([string]$Date)
    return "$ToolRoot\Master\obd-tally-$Date.txt"
}

function Read-Tally {
    param([string]$Date)
    $f = Get-TallyFilePath $Date
    if (-not (Test-Path $f)) { return $null }
    $lines = Get-Content $f -ErrorAction SilentlyContinue
    $tally = @{ TotalCount = -1; Page1Obds = @(); LastUpdated = $null; Status = "unknown" }
    foreach ($l in $lines) {
        if ($l -match '^\s*total_count\s*:\s*(.+)$') { $tally.TotalCount = [int]$Matches[1].Trim() }
        elseif ($l -match '^\s*page1_obds\s*:\s*(.+)$') {
            $csv = $Matches[1].Trim()
            if ($csv) { $tally.Page1Obds = $csv -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ } }
        }
        elseif ($l -match '^\s*last_updated\s*:\s*(.+)$') { $tally.LastUpdated = $Matches[1].Trim() }
        elseif ($l -match '^\s*status\s*:\s*(.+)$') { $tally.Status = $Matches[1].Trim() }
    }
    return $tally
}

function Save-Tally {
    param([string]$Date, [int]$TotalCount, [string[]]$Page1Obds, [string]$Status = "ok")
    $f = Get-TallyFilePath $Date
    $page1csv = ($Page1Obds -join ',')
    @(
        "total_count: $TotalCount"
        "page1_obds: $page1csv"
        "last_updated: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
        "status: $Status"
    ) | Set-Content $f
}

function Read-YesterdayState {
    if (-not (Test-Path $YesterdayStateFile)) { return $null }
    $lines = Get-Content $YesterdayStateFile -ErrorAction SilentlyContinue
    $state = @{ Status = "unknown"; Date = $null; Attempts = 0; LastAttempt = $null }
    foreach ($l in $lines) {
        if ($l -match '^\s*status\s*:\s*(.+)$') { $state.Status = $Matches[1].Trim() }
        elseif ($l -match '^\s*date\s*:\s*(.+)$') { $state.Date = $Matches[1].Trim() }
        elseif ($l -match '^\s*attempts\s*:\s*(\d+)$') { $state.Attempts = [int]$Matches[1] }
        elseif ($l -match '^\s*last_attempt\s*:\s*(.+)$') { $state.LastAttempt = $Matches[1].Trim() }
    }
    return $state
}

function Write-YesterdayState {
    param([string]$Status, [string]$Date, [int]$Attempts)
    @(
        "status: $Status"
        "date: $Date"
        "attempts: $Attempts"
        "last_attempt: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
    ) | Set-Content $YesterdayStateFile
}

#endregion HELPERS


#region NEW FUNCTIONS (v2 only)

# Compute v2 HMAC over the literal key-id string (PS 5.1 safe)
function Get-V2Signature {
    $hmac      = New-Object System.Security.Cryptography.HMACSHA256
    $hmac.Key  = [System.Text.Encoding]::UTF8.GetBytes($SecretJson)
    $sigBytes  = $hmac.ComputeHash([System.Text.Encoding]::UTF8.GetBytes("auto-import-json-v1"))
    return ($sigBytes | ForEach-Object { $_.ToString("x2") }) -join ""
}

# Build v2 auth headers (fresh signature each call)
function Get-V2ApiHeaders {
    return @{
        "x-import-key-id"    = $KeyIdJson
        "x-import-signature" = Get-V2Signature
    }
}

# Normalise a date field from /data JSON to yyyy-MM-dd string or $null
function Format-DateField {
    param($val)
    if ($null -eq $val) { return $null }
    $s = $val.ToString().Trim()
    if ($s -eq "") { return $null }
    # Already ISO format
    if ($s -match '^(\d{4}-\d{2}-\d{2})') { return $Matches[1] }
    # OA date number (Excel serial)
    try {
        $d = [datetime]::FromOADate([double]$s)
        return $d.ToString("yyyy-MM-dd")
    } catch {}
    return $s
}

# Translate one /data listing row into a RawHeaderRow PSCustomObject.
# Key strings must match exactly what route.ts reads via hr["..."].
function Build-HeaderRow {
    param($dataRow)
    return [PSCustomObject][ordered]@{
        "OBD Number"            = if ($dataRow.PickListId)          { $dataRow.PickListId.ToString().Trim() }          else { $null }
        "SONum"                 = if ($dataRow.SONum)               { $dataRow.SONum.ToString().Trim() }               else { $null }
        "SMU"                   = if ($dataRow.SMU)                 { $dataRow.SMU.ToString().Trim() }                 else { $null }
        "SMU Code"              = if ($dataRow.SMUCode)             { $dataRow.SMUCode.ToString().Trim() }             else { $null }
        "MaterialType"          = if ($dataRow.MaterialType)        { $dataRow.MaterialType.ToString().Trim() }        else { $null }
        "NatureOfTransaction"   = if ($dataRow.NatureOfTransaction) { $dataRow.NatureOfTransaction.ToString().Trim() } else { $null }
        "Warehouse"             = if ($dataRow.SiteId)              { $dataRow.SiteId.ToString().Trim() }              else { $null }
        "OBD Email Date"        = Format-DateField $dataRow.PickListEmailDate
        "OBD Email Time"        = if ($dataRow.PickListEmailTime)   { $dataRow.PickListEmailTime.ToString().Trim() }   else { $null }
        "Status"                = if ($dataRow.PendingStatus)       { $dataRow.PendingStatus.ToString().Trim() }       else { $null }
        "UnitQty"               = $dataRow.UnitQty
        "Volume"                = $dataRow.Volume
        "GrossWeight"           = $dataRow.GrossWeight
        "Bill To Customer Id"   = if ($dataRow.SoldToCustomerId)    { $dataRow.SoldToCustomerId.ToString().Trim() }    else { $null }
        "Bill To Customer Name" = if ($dataRow.SoldCustomerName)    { $dataRow.SoldCustomerName.ToString().Trim() }    else { $null }
        "ShipToCustomerId"      = if ($dataRow.ShipToCustomerId)    { $dataRow.ShipToCustomerId.ToString().Trim() }    else { $null }
        "Ship To Customer Name" = if ($dataRow.ShipCustomerName)    { $dataRow.ShipCustomerName.ToString().Trim() }    else { $null }
        "InvoiceNo"             = if ($dataRow.InvoiceNo)           { $dataRow.InvoiceNo.ToString().Trim() }           else { $null }
        "InvoiceDate"           = Format-DateField $dataRow.InvoiceDate
    }
}

# Translate one FormGetData line item into a RawLineRow PSCustomObject.
# Key strings must match exactly what route.ts reads via lr["..."].
# Deviation from v1: line_id is the real Lineid (v1 always sent 0).
function Build-LineRow {
    param([string]$obd, $line, [string]$hdrSmu)
    $skuDesc = if ($line.SKUDesc)  { $line.SKUDesc.ToString().Trim()  } else { "" }
    $skuCode = if ($line.SKUCode)  { $line.SKUCode.ToString().Trim()  } else { "" }
    $lineId  = 0
    if ($null -ne $line.Lineid) { try { $lineId = [int]$line.Lineid } catch { $lineId = 0 } }

    $unitQtyNum = [decimal]0
    if ($null -ne $line.UnitQty) { try { $unitQtyNum = [decimal]$line.UnitQty } catch {} }
    $volumeNum  = [decimal]0
    if ($null -ne $line.Volume)  { try { $volumeNum  = [decimal]$line.Volume  } catch {} }

    $artInfo = Get-ArticleInfo $volumeNum.ToString() $unitQtyNum.ToString()

    return [PSCustomObject][ordered]@{
        "obd_number"      = $obd
        "sku_codes"       = $skuCode
        "sku_description" = $skuDesc
        "line_id"         = $lineId
        "unit_qty"        = $unitQtyNum
        "volume_line"     = $volumeNum
        "Tinting"         = Get-Tinting $skuDesc $hdrSmu
        "article"         = $artInfo.Article
        "article_tag"     = $artInfo.Tag
        "batch_code"      = $null
    }
}

# POST ?action=check — return HashSet of OBD numbers already in OrbitOMS.
# Returns $null on HTTP failure (caller treats all as new).
function Invoke-PreCheck {
    param([string[]]$obdNumbers, $Session)

    if ($obdNumbers.Count -eq 0) { return [System.Collections.Generic.HashSet[string]]::new() }

    $body    = @{ obdNumbers = $obdNumbers } | ConvertTo-Json -Depth 3 -Compress
    $headers = Get-V2ApiHeaders

    try {
        $resp = Invoke-WebRequest `
            -Uri $ApiUrlCheck `
            -Method POST `
            -Body $body `
            -ContentType "application/json" `
            -Headers $headers `
            -UseBasicParsing `
            -TimeoutSec 30 `
            -ErrorAction Stop

        $parsed = $resp.Content | ConvertFrom-Json
        $result = [System.Collections.Generic.HashSet[string]]::new()
        if ($parsed.existing) {
            foreach ($e in $parsed.existing) { $result.Add($e.ToString()) | Out-Null }
        }
        Write-Log "PRE-CHECK - $($obdNumbers.Count) sent, $($result.Count) already in OrbitOMS" "Cyan"
        return $result

    } catch {
        Write-Log "PRE-CHECK - HTTP call failed: $_  Treating all as new." "Yellow"
        return $null
    }
}

# POST FormGetData for one OBD — returns line-item array or $null on failure.
# 1 retry; lazy re-login on session expiry.
function Get-ObdJsonData {
    param([string]$ObdNumber, $Session, [hashtable]$Config)

    $maxAttempts = 2
    for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {

        $body = [ordered]@{
            action        = "FormGetData"
            reportId      = "Reports/105VCsI1rQ6u1QSEyGJ7I3Lc"
            columnClicked = "PickListId"
            componentId   = "c01105VCsI1rQ6u1QSEyGJ7I3Lc"
            formName      = "View OBD Details"
            uniqueKVP     = [ordered]@{ PickListId = $ObdNumber }
        } | ConvertTo-Json -Depth 5

        try {
            $resp = Invoke-WebRequest `
                -Uri ($BaseUrl + $FormdataPath) `
                -Method POST `
                -Body $body `
                -ContentType "application/json" `
                -Headers (Get-BrowserHeaders) `
                -WebSession $Session `
                -UseBasicParsing `
                -TimeoutSec 30 `
                -ErrorAction Stop

            if (Test-IsLoginRedirect $resp.Content) {
                Write-Log "FORMGET $ObdNumber attempt $attempt - session expired, re-login" "Yellow"
                if (Test-Path $SessionFile) { Remove-Item $SessionFile -Force }
                $relogin = Invoke-FreshLogin -Session $Session -Config $Config
                if (-not $relogin) { return $null }
                Invoke-SpecPrime -Session $Session -Reason "post-relogin" | Out-Null
                if ($attempt -lt $maxAttempts) { continue } else { return $null }
            }

            $parsed = $resp.Content | ConvertFrom-Json
            if ($parsed.data -and $parsed.data.data) {
                return $parsed.data.data
            }
            Write-Log "FORMGET $ObdNumber attempt $attempt - unexpected response shape (no data.data)" "Yellow"
            if ($attempt -lt $maxAttempts) { Start-Sleep -Seconds 5 }

        } catch {
            Write-Log "FORMGET $ObdNumber attempt $attempt failed: $_" "Yellow"
            if ($attempt -lt $maxAttempts) { Start-Sleep -Seconds (5 * $attempt) }
        }
    }

    return $null
}

# POST ?action=auto-json with up to 3 retries.
function Send-JsonPayloadToOrbitOMS {
    param([hashtable]$Payload)

    $body    = $Payload | ConvertTo-Json -Depth 5 -Compress
    $headers = Get-V2ApiHeaders

    $maxAttempts = 3
    for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
        try {
            $resp = Invoke-WebRequest `
                -Uri $ApiUrlAutoJson `
                -Method POST `
                -Body $body `
                -ContentType "application/json" `
                -Headers $headers `
                -UseBasicParsing `
                -TimeoutSec 120 `
                -ErrorAction Stop

            $parsed = $resp.Content | ConvertFrom-Json
            Write-Log "UPLOAD-JSON - SUCCESS batchRef=$($parsed.batchRef) imported=$($parsed.ordersCreated) skipped=$($parsed.skippedDuplicates) errors=$($parsed.errors)" "Green"
            return @{
                Success  = $true
                Imported = [int]$parsed.ordersCreated
                Skipped  = [int]$parsed.skippedDuplicates
                Errors   = [int]$parsed.errors
                BatchRef = $parsed.batchRef
            }
        } catch {
            $errMsg = $_.Exception.Message
            if ($_.Exception.Response) {
                try {
                    $reader  = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
                    $errBody = $reader.ReadToEnd()
                    $errMsg  = "$errMsg | $errBody"
                } catch {}
            }
            Write-Log "UPLOAD-JSON attempt $attempt failed: $errMsg" "Yellow"
            if ($attempt -lt $maxAttempts) { Start-Sleep -Seconds (10 * $attempt) }
        }
    }

    Write-Log "UPLOAD-JSON - All $maxAttempts attempts failed" "Red"
    return @{ Success = $false }
}

# Translate a pre-built header PSCustomObject into the 6-field hashtable
# expected by ?action=patch-headers.
function Build-PatchHeaderRow {
    param($hdr)
    return @{
        "OBD Number"     = $hdr."OBD Number"
        "InvoiceNo"      = $hdr.InvoiceNo
        "InvoiceDate"    = $hdr.InvoiceDate
        "OBD Email Date" = $hdr."OBD Email Date"
        "OBD Email Time" = $hdr."OBD Email Time"
        "SONum"          = $hdr.SONum
    }
}

# POST ?action=patch-headers -- fills stale invoice fields + fixes
# orderDateTime/slot for existing SAP-first OBDs.  3 retries.
function Send-PatchHeadersToOrbitOMS {
    param([array]$PatchHeaders, [bool]$IsDryRun = $false)

    $body    = (@{ dryRun = $IsDryRun; patchHeaders = $PatchHeaders } | ConvertTo-Json -Depth 5 -Compress)
    $headers = Get-V2ApiHeaders

    $maxAttempts = 3
    for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
        try {
            $resp = Invoke-WebRequest `
                -Uri $ApiUrlPatchHeaders `
                -Method POST `
                -Body $body `
                -ContentType "application/json" `
                -Headers $headers `
                -UseBasicParsing `
                -TimeoutSec 60 `
                -ErrorAction Stop

            $parsed = $resp.Content | ConvertFrom-Json
            $c = $parsed.counts
            Write-Log "PATCH-HDR - OK received=$($c.received) invoiceFilled=$($c.invoiceFilled) timeFixed=$($c.timeFixed) slotFixed=$($c.slotFixed) mailOwnedSkipped=$($c.mailOwnedSkipped) noChange=$($c.noChange)" "Green"
            return $true
        } catch {
            $errMsg = $_.Exception.Message
            if ($_.Exception.Response) {
                try {
                    $reader  = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
                    $errBody = $reader.ReadToEnd()
                    $errMsg  = "$errMsg | $errBody"
                } catch {}
            }
            Write-Log "PATCH-HDR attempt $attempt failed: $errMsg" "Yellow"
            if ($attempt -lt $maxAttempts) { Start-Sleep -Seconds (10 * $attempt) }
        }
    }

    Write-Log "PATCH-HDR - All $maxAttempts attempts failed" "Red"
    return $false
}

# Persist a failed payload JSON to disk for next-cycle retry.
function Add-PendingJsonUpload {
    param([hashtable]$Payload, [string]$Date)

    if (-not (Test-Path $OutputFolder))     { New-Item -ItemType Directory -Path $OutputFolder     | Out-Null }
    if (-not (Test-Path $PendingJsonFolder)) { New-Item -ItemType Directory -Path $PendingJsonFolder | Out-Null }

    $guid     = [System.Guid]::NewGuid().ToString("N").Substring(0, 8)
    $jsonPath = "$PendingJsonFolder\$Date-$guid.json"
    $Payload | ConvertTo-Json -Depth 5 | Set-Content $jsonPath -Encoding UTF8
    Write-Log "PENDING-JSON - Saved payload to $jsonPath" "Yellow"

    $entry    = "$Date|$jsonPath"
    $existing = @()
    if (Test-Path $PendingJsonFile) {
        $existing = @(Get-Content $PendingJsonFile | Where-Object { $_.Trim() -ne "" })
    }
    if ($existing -notcontains $entry) { $existing += $entry }
    $existing | Set-Content $PendingJsonFile
}

function Remove-PendingJsonUpload {
    param([string]$JsonPath)
    if (Test-Path $JsonPath) { Remove-Item $JsonPath -Force -ErrorAction SilentlyContinue }
    if (-not (Test-Path $PendingJsonFile)) { return }
    $existing = @(Get-Content $PendingJsonFile | Where-Object { $_.Trim() -ne "" -and -not $_.EndsWith("|$JsonPath") })
    if ($existing.Count -eq 0) {
        Remove-Item $PendingJsonFile -Force -ErrorAction SilentlyContinue
    } else {
        $existing | Set-Content $PendingJsonFile
    }
}

#endregion NEW FUNCTIONS


#region MAIN PIPELINE

Write-Log ""
Write-Section "RUN STARTED  $Today  [v2 pure-json]" "Cyan"


# ============================================================
#  PHASE 1 - CLEANUP + DAILY RESET
# ============================================================

$isFirstRunToday = $false
$rolledOverFrom  = $Yesterday
if (Test-Path $DailyStateFile) {
    $lastRunDate = (Get-Content $DailyStateFile -First 1).Trim()
    if ($lastRunDate -ne $Today) {
        $isFirstRunToday = $true
        $rolledOverFrom  = $lastRunDate
    }
} else {
    $isFirstRunToday = $true
}

if ($isFirstRunToday) {
    Write-Log "PHASE 1 - First run of new day. Date rolled from $rolledOverFrom to $Today" "Cyan"
    if (Test-Path $FailedJsonObdsFile) { Remove-Item $FailedJsonObdsFile -Force }
    if (Test-Path $LastSpecCallFile)   { Remove-Item $LastSpecCallFile   -Force }
    # Note: do NOT wipe session-cookie.txt; lazy re-login handles it.

    Write-YesterdayState -Status "pending" -Date $rolledOverFrom -Attempts 0
    Write-Log "PHASE 1 - Yesterday recovery flagged for $rolledOverFrom"

    $Today | Set-Content $DailyStateFile
}

# Cleanup tally files older than KeepDays
$cutoffDate = (Get-Date).AddDays(-$KeepDays).Date
Get-ChildItem -Path "$ToolRoot\Master" -Filter "obd-tally-*.txt" -ErrorAction SilentlyContinue |
    Where-Object {
        $fileDate = $null
        try {
            $datePart = $_.BaseName -replace "obd-tally-", ""
            $fileDate = [datetime]::ParseExact($datePart, "yyyy-MM-dd", $null)
        } catch { $fileDate = $null }
        if ($fileDate) { $fileDate -lt $cutoffDate } else { $false }
    } |
    ForEach-Object {
        Remove-Item $_.FullName -Force -ErrorAction SilentlyContinue
        Write-Log "CLEANUP - Deleted tally: $($_.Name)"
    }

# Cleanup old pending-json files
if (Test-Path $PendingJsonFolder) {
    Get-ChildItem -Path $PendingJsonFolder -Filter "*.json" -ErrorAction SilentlyContinue |
        Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$KeepDays) } |
        ForEach-Object {
            Remove-Item $_.FullName -Force -ErrorAction SilentlyContinue
            Write-Log "CLEANUP - Deleted old pending-json: $($_.Name)"
        }
}


# ============================================================
#  BOOTSTRAPPING: config + key + keywords + pack sizes
# ============================================================

if (-not (Test-Path $ConfigFile)) {
    Write-Log "FATAL - breakwalls-config.txt not found" "Red"; exit 1
}
$config = @{}
Get-Content $ConfigFile | ForEach-Object {
    $line = $_.Trim()
    if ($line -eq "" -or $line.StartsWith("#")) { return }
    $parts = $line -split "=", 2
    if ($parts.Count -eq 2) { $config[$parts[0].Trim()] = $parts[1].Trim() }
}
if (-not $config["USERNAME"] -or -not $config["PASSWORD"]) {
    Write-Log "FATAL - USERNAME or PASSWORD missing from breakwalls-config.txt" "Red"; exit 1
}

if (-not (Test-Path $KeyFileJson)) {
    Write-Log "FATAL - import-key-json.txt not found at $KeyFileJson" "Red"; exit 1
}
$SecretJson = (Get-Content $KeyFileJson -Raw).Trim()
if (-not $SecretJson) {
    Write-Log "FATAL - import-key-json.txt is empty" "Red"; exit 1
}

if (-not (Test-Path $KeywordsFile)) {
    Write-Log "FATAL - tinting-keywords.txt not found" "Red"; exit 1
}
$tintingKeywords = @(Get-Content $KeywordsFile |
    Where-Object { $_.Trim() -ne "" -and -not $_.StartsWith("#") } |
    ForEach-Object { $_.Trim().ToUpper() })

if (-not (Test-Path $PackSizesFile)) {
    Write-Log "FATAL - pack-sizes.txt not found" "Red"; exit 1
}
$drumSizes      = @()
$bagSizes       = @()
$cartonMap      = @{}
$currentSection = ""
foreach ($rawLine in (Get-Content $PackSizesFile)) {
    $rawLine = $rawLine.Trim()
    if ($rawLine -eq "" -or $rawLine.StartsWith("#")) { continue }
    if ($rawLine -match '^\[(.+)\]$') { $currentSection = $Matches[1].ToUpper(); continue }
    switch ($currentSection) {
        "DRUM"   { $drumSizes += [decimal]$rawLine }
        "BAG"    { $bagSizes  += [decimal]$rawLine }
        "CARTON" {
            $p = $rawLine -split "=", 2
            if ($p.Count -eq 2) { $cartonMap[[decimal]$p[0]] = [int]$p[1] }
        }
    }
}


# ============================================================
#  PHASE 2 - LOGIN
# ============================================================

Write-Log "PHASE 2 - Login"

$sessInit          = Initialize-Session
$Session           = $sessInit.Session
$usedCachedSession = $sessInit.Cached

if (-not $usedCachedSession) {
    $loginOk = Invoke-FreshLogin -Session $Session -Config $config
    if (-not $loginOk) {
        Write-Log "FATAL - Login failed. Will retry next cycle." "Red"
        Write-Section "CYCLE SUMMARY  $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" "Red"
        Write-Host " Status            : LOGIN FAILED -- next cycle will retry" -ForegroundColor Red
        Write-Section "RUN COMPLETE" "Red"
        exit 0
    }
    try {
        Invoke-WebRequest `
            -Uri ($BaseUrl + $ReportPath) `
            -Method GET `
            -WebSession $Session `
            -UseBasicParsing `
            -ErrorAction Stop | Out-Null
    } catch {
        Write-Log "WARNING - Could not load report page after login: $_" "Yellow"
    }
    Get-RandomDelay -Min 2 -Max 5
}


# ============================================================
#  PHASE 3 - YESTERDAY RECOVERY (if pending)
# ============================================================

if ($SkipYesterday) {
    Write-Log "[flag] SkipYesterday - yesterday recovery skipped; today only."
} elseif ($TargetDate -ne "") {
    Write-Log "[flag] TargetDate=$TargetDate - yesterday recovery skipped; processing target date only."
} else {

$yState = Read-YesterdayState
if ($yState -and $yState.Status -eq "pending") {

    $recoveryDate = $yState.Date
    Write-Log "PHASE 3 - Yesterday recovery for $recoveryDate (attempt $($yState.Attempts + 1))" "Cyan"
    Write-YesterdayState -Status "pending" -Date $recoveryDate -Attempts ($yState.Attempts + 1)
    $Summary.YesterdayRan = $true

    Invoke-SpecPrime -Session $Session -Reason "yesterday-recovery" | Out-Null
    Get-RandomDelay -Min 2 -Max 5

    $yPage1 = Get-OBDListPage -PageNum 1 -Date $recoveryDate -Session $Session -Config $config
    if ($yPage1 -and $yPage1.data) {

        $keyList = ($yPage1.PSObject.Properties.Name -join ', ')
        Write-Log "DIAG - Yesterday page 1 response keys: $keyList"

        $yLastPage      = [int]$yPage1.last_page
        $yAllObds       = [System.Collections.Generic.List[string]]::new()
        $yHeaderRowsMap = @{}

        foreach ($row in $yPage1.data) {
            $obdNum = if ($row.PickListId) { $row.PickListId.ToString().Trim() } else { $null }
            if ($obdNum) {
                $yAllObds.Add($obdNum)
                $yHeaderRowsMap[$obdNum] = Build-HeaderRow $row
            }
        }

        if ($yLastPage -gt 1) {
            $pageOrder = 2..$yLastPage | Get-Random -Count ($yLastPage - 1)
            foreach ($p in $pageOrder) {
                Get-RandomDelay -Min 1 -Max 3
                $pr = Get-OBDListPage -PageNum $p -Date $recoveryDate -Session $Session -Config $config
                if ($pr -and $pr.data) {
                    foreach ($row in $pr.data) {
                        $obdNum = if ($row.PickListId) { $row.PickListId.ToString().Trim() } else { $null }
                        if ($obdNum -and -not $yAllObds.Contains($obdNum)) {
                            $yAllObds.Add($obdNum)
                            $yHeaderRowsMap[$obdNum] = Build-HeaderRow $row
                        }
                    }
                    Write-Log "Y-RECOVERY - Page $p/$yLastPage : $($pr.data.Count) OBDs"
                } else {
                    Write-Log "Y-RECOVERY - Page $p failed all retries" "Yellow"
                }
            }
            Get-RandomDelay -Min 1 -Max 3
            $yRefetch = Get-OBDListPage -PageNum 1 -Date $recoveryDate -Session $Session -Config $config
            if ($yRefetch -and $yRefetch.data) {
                foreach ($row in $yRefetch.data) {
                    $obdNum = if ($row.PickListId) { $row.PickListId.ToString().Trim() } else { $null }
                    if ($obdNum -and -not $yAllObds.Contains($obdNum)) {
                        $yAllObds.Add($obdNum)
                        $yHeaderRowsMap[$obdNum] = Build-HeaderRow $row
                        Write-Log "Y-RECOVERY - New OBD on page 1 refetch: $obdNum"
                    }
                }
            }
        }

        $yAllObdsArr = @($yAllObds | Select-Object -Unique)
        $Summary.YesterdayBreakwallsTotal = $yAllObdsArr.Count
        Write-Log "Y-RECOVERY - Breakwalls total for $($recoveryDate): $($yAllObdsArr.Count)"

        Get-RandomDelay -Min 1 -Max 3
        $yExistingSet = Invoke-PreCheck -obdNumbers $yAllObdsArr -Session $Session
        if ($null -eq $yExistingSet) {
            $yNewObds = $yAllObdsArr
            Write-Log "Y-RECOVERY - Pre-check failed, treating all as new" "Yellow"
        } else {
            $yNewObds = @($yAllObdsArr | Where-Object { -not $yExistingSet.Contains($_) })
        }
        $Summary.YesterdayPreCheckNew = $yNewObds.Count
        Write-Log "Y-RECOVERY - $($yNewObds.Count) new OBDs to fetch for $recoveryDate"

        $yHdrOut    = [System.Collections.Generic.List[PSCustomObject]]::new()
        $yLinesOut  = [System.Collections.Generic.List[PSCustomObject]]::new()
        $yFetched   = 0
        $yFailed    = [System.Collections.Generic.List[string]]::new()

        foreach ($obd in $yNewObds) {
            Get-RandomDelay -Min 1 -Max 3
            $hdr = $yHeaderRowsMap[$obd]
            $smu = if ($hdr -and $hdr.SMU) { $hdr.SMU.ToString() } else { "" }

            $lines = Get-ObdJsonData -ObdNumber $obd -Session $Session -Config $config
            if ($null -ne $lines) {
                $yHdrOut.Add($hdr)
                foreach ($ln in $lines) { $yLinesOut.Add((Build-LineRow -obd $obd -line $ln -hdrSmu $smu)) }
                $yFetched++
            } else {
                $yFailed.Add($obd)
                Write-Log "Y-RECOVERY - FormGetData failed for $obd" "Yellow"
            }
        }

        $Summary.YesterdayFetched = $yFetched
        $Summary.YesterdayFailed  = $yFailed.Count

        if ($yHdrOut.Count -gt 0) {
            $yPayload = @{ headerRows = @($yHdrOut); lineRows = @($yLinesOut) }
            Get-RandomDelay -Min 1 -Max 3
            if ($DryRun) {
                Write-Log "[DRY RUN] would import yesterday-recovery for $recoveryDate - skipped" "Cyan"
                $Summary.YesterdayUpload = "DRY RUN (not posted)"
            } else {
                $yUp = Send-JsonPayloadToOrbitOMS -Payload $yPayload
                if ($yUp.Success) {
                    $Summary.YesterdayUpload = "imported=$($yUp.Imported) skipped=$($yUp.Skipped)"
                    if ($yFailed.Count -eq 0) {
                        Write-YesterdayState -Status "done" -Date $recoveryDate -Attempts ($yState.Attempts + 1)
                        Write-Log "Y-RECOVERY - DONE for $recoveryDate" "Green"
                    } else {
                        Write-YesterdayState -Status "partial" -Date $recoveryDate -Attempts ($yState.Attempts + 1)
                        Write-Log "Y-RECOVERY - Partial ($($yFailed.Count) FormGetData failed, not re-queued)" "Yellow"
                    }
                } else {
                    $Summary.YesterdayUpload = "FAILED"
                    Add-PendingJsonUpload -Payload $yPayload -Date $recoveryDate
                    Write-Log "Y-RECOVERY - Upload failed, parked in pending-upload-json.txt" "Yellow"
                    Write-YesterdayState -Status "pending" -Date $recoveryDate -Attempts ($yState.Attempts + 1)
                }
            }
        } else {
            $Summary.YesterdayUpload = "n/a (0 new)"
            Write-YesterdayState -Status "done" -Date $recoveryDate -Attempts ($yState.Attempts + 1)
            Write-Log "Y-RECOVERY - No new OBDs for $recoveryDate, marking done" "Green"
        }

    } else {
        Write-Log "Y-RECOVERY - Page 1 fetch failed for $recoveryDate. Will retry next cycle." "Yellow"
    }

    Get-RandomDelay -Min 3 -Max 7
}

}   # end -not SkipYesterday


# ============================================================
#  PHASE 4 - SPEC PRIME (today)
# ============================================================

$specReason = if ($Summary.YesterdayRan) { "post-yesterday" } else { "default" }
Invoke-SpecPrime -Session $Session -Reason $specReason | Out-Null


# ============================================================
#  PHASE 5 - PENDING JSON UPLOAD RETRY
# ============================================================

if (Test-Path $PendingJsonFile) {
    Write-Log "PHASE 5 - Retrying pending JSON uploads"
    $pending = @(Get-Content $PendingJsonFile | Where-Object { $_.Trim() -ne "" })
    foreach ($entry in $pending) {
        $parts = $entry -split '\|', 2
        if ($parts.Count -ne 2) { continue }
        $pendDate     = $parts[0]
        $pendJsonPath = $parts[1]
        if (-not (Test-Path $pendJsonPath)) {
            Write-Log "PHASE 5 - Pending JSON file missing: $pendJsonPath, removing entry" "Yellow"
            Remove-PendingJsonUpload -JsonPath $pendJsonPath
            continue
        }
        # Re-POST the saved JSON bytes directly (avoids double parse/serialize)
        $pendBody = Get-Content $pendJsonPath -Raw -Encoding UTF8
        $headers  = Get-V2ApiHeaders
        if ($DryRun) {
            Write-Log "[DRY RUN] would POST pending payload for $pendDate to ?action=auto-json" "Cyan"
        } else {
            $retryOk  = $false
            $maxR     = 3
            for ($r = 1; $r -le $maxR; $r++) {
                try {
                    $resp = Invoke-WebRequest `
                        -Uri $ApiUrlAutoJson `
                        -Method POST `
                        -Body $pendBody `
                        -ContentType "application/json" `
                        -Headers $headers `
                        -UseBasicParsing `
                        -TimeoutSec 120 `
                        -ErrorAction Stop
                    $parsed = $resp.Content | ConvertFrom-Json
                    Write-Log "PHASE 5 - Pending $pendDate cleared: batchRef=$($parsed.batchRef) imported=$($parsed.ordersCreated)" "Green"
                    Remove-PendingJsonUpload -JsonPath $pendJsonPath
                    $retryOk = $true
                    break
                } catch {
                    Write-Log "PHASE 5 - Retry $r for $pendDate failed: $_" "Yellow"
                    if ($r -lt $maxR) { Start-Sleep -Seconds (10 * $r) }
                }
            }
            if (-not $retryOk) {
                Write-Log "PHASE 5 - $pendDate still failing, keeping in queue" "Yellow"
            }
        }
    }
}


# ============================================================
#  PHASE 6 - /data PAGINATION (full header rows)
# ============================================================

$EffectiveDate = if ($TargetDate -ne "") { $TargetDate } else { $Today }
Write-Log "PHASE 6 - Processing date: $EffectiveDate"

$headerRowsByObd = @{}
$allObds         = [System.Collections.Generic.List[string]]::new()

Get-RandomDelay -Min 2 -Max 5
$page1 = Get-OBDListPage -PageNum 1 -Date $EffectiveDate -Session $Session -Config $config

if (-not ($page1 -and $page1.data)) {
    Write-Log "PHASE 6 - Page 1 unreachable. Cannot continue. Next cycle will retry." "Red"
    $Summary.PaginationMode  = "page1-failed"
    $Summary.BreakwallsTotal = "?"
    $Summary.Errors.Add("Phase 6 page 1 failed")
} else {

    $keyList = ($page1.PSObject.Properties.Name -join ', ')
    Write-Log "DIAG - Today page 1 response keys: $keyList"

    $lastPage      = [int]$page1.last_page
    $page1Obds     = [System.Collections.Generic.List[string]]::new()
    $totalCount    = Get-TotalCount -PageResult $page1

    foreach ($row in $page1.data) {
        $obdNum = if ($row.PickListId) { $row.PickListId.ToString().Trim() } else { $null }
        if ($obdNum) {
            $page1Obds.Add($obdNum)
            $allObds.Add($obdNum)
            $headerRowsByObd[$obdNum] = Build-HeaderRow $row
        }
    }

    if ($lastPage -gt 1) {
        $Summary.PaginationMode = "full ($lastPage pages)"
        Write-Log "PHASE 6 - Fetching pages 2..$lastPage"

        $pageOrder = 2..$lastPage | Get-Random -Count ($lastPage - 1)
        foreach ($p in $pageOrder) {
            Get-RandomDelay -Min 1 -Max 3
            $pr = Get-OBDListPage -PageNum $p -Date $EffectiveDate -Session $Session -Config $config
            if ($pr -and $pr.data) {
                foreach ($row in $pr.data) {
                    $obdNum = if ($row.PickListId) { $row.PickListId.ToString().Trim() } else { $null }
                    if ($obdNum -and -not $allObds.Contains($obdNum)) {
                        $allObds.Add($obdNum)
                        $headerRowsByObd[$obdNum] = Build-HeaderRow $row
                    }
                }
                Write-Log "PHASE 6 - Page $p/$lastPage : $($pr.data.Count) OBDs"
            } else {
                Write-Log "PHASE 6 - Page $p failed all retries" "Yellow"
                $Summary.Errors.Add("Phase 6 page $p failed")
            }
        }

        # Refetch page 1 to catch OBDs added during pagination
        Get-RandomDelay -Min 1 -Max 3
        $refetch = Get-OBDListPage -PageNum 1 -Date $EffectiveDate -Session $Session -Config $config
        if ($refetch -and $refetch.data) {
            foreach ($row in $refetch.data) {
                $obdNum = if ($row.PickListId) { $row.PickListId.ToString().Trim() } else { $null }
                if ($obdNum -and -not $allObds.Contains($obdNum)) {
                    $allObds.Add($obdNum)
                    $headerRowsByObd[$obdNum] = Build-HeaderRow $row
                    Write-Log "PHASE 6 - New OBD via page 1 refetch: $obdNum"
                }
            }
            $page1Obds.Clear()
            foreach ($row in $refetch.data) {
                $obdNum = if ($row.PickListId) { $row.PickListId.ToString().Trim() } else { $null }
                if ($obdNum) { $page1Obds.Add($obdNum) }
            }
            $newTotal = Get-TotalCount -PageResult $refetch
            if ($newTotal -ge 0) { $totalCount = $newTotal }
        }
    } else {
        $Summary.PaginationMode = "single-page"
    }

    $allObdsArr = @($allObds | Select-Object -Unique)
    Save-Tally -Date $EffectiveDate -TotalCount $totalCount -Page1Obds @($page1Obds) -Status "ok"
    $Summary.BreakwallsTotal = if ($totalCount -ge 0) { $totalCount } else { "$($allObdsArr.Count) (estimated)" }
    Write-Log "PHASE 6 - $($allObdsArr.Count) OBDs collected ($($headerRowsByObd.Count) header rows built)"


    # ============================================================
    #  PHASE 6b - PRE-CHECK
    # ============================================================

    Write-Log "PHASE 6b - Pre-check against OrbitOMS"
    Get-RandomDelay -Min 1 -Max 3
    $existingSet = Invoke-PreCheck -obdNumbers $allObdsArr -Session $Session
    if ($null -eq $existingSet) {
        $newObds = $allObdsArr
        Write-Log "PHASE 6b - Pre-check failed, treating all $($allObdsArr.Count) as new" "Yellow"
    } else {
        $newObds = @($allObdsArr | Where-Object { -not $existingSet.Contains($_) })
    }
    $Summary.PreCheckNew      = $newObds.Count
    $Summary.PreCheckExisting = $allObdsArr.Count - $newObds.Count
    Write-Log "PHASE 6b - $($Summary.PreCheckNew) new, $($Summary.PreCheckExisting) already in OrbitOMS"


    # ============================================================
    #  PHASE 7 - FORMGETDATA PER NEW OBD
    # ============================================================

    $todayHdrRows   = [System.Collections.Generic.List[PSCustomObject]]::new()
    $todayLineRows  = [System.Collections.Generic.List[PSCustomObject]]::new()
    $fetchedObdSet  = [System.Collections.Generic.HashSet[string]]::new()
    $todayFailed    = [System.Collections.Generic.List[string]]::new()

    Write-Log "PHASE 7 - FormGetData for $($newObds.Count) new OBDs"

    foreach ($obd in $newObds) {
        Get-RandomDelay -Min 1 -Max 3
        $hdr = $headerRowsByObd[$obd]
        $smu = if ($hdr -and $hdr.SMU) { $hdr.SMU.ToString() } else { "" }

        $lines = Get-ObdJsonData -ObdNumber $obd -Session $Session -Config $config
        if ($null -ne $lines) {
            $todayHdrRows.Add($hdr)
            foreach ($ln in $lines) { $todayLineRows.Add((Build-LineRow -obd $obd -line $ln -hdrSmu $smu)) }
            $fetchedObdSet.Add($obd) | Out-Null
            Write-Log "FORMGET $obd - OK ($(@($lines).Count) lines)"
        } else {
            $todayFailed.Add($obd)
            Write-Log "FORMGET $obd - FAILED (queued for retry)" "Yellow"
        }
    }

    # Persist failed OBDs for retry next cycle
    if ($todayFailed.Count -gt 0) {
        $existingFailed = @()
        if (Test-Path $FailedJsonObdsFile) {
            $existingFailed = @(Get-Content $FailedJsonObdsFile | Where-Object { $_.Trim() -ne "" })
        }
        @($existingFailed + @($todayFailed) | Select-Object -Unique) | Set-Content $FailedJsonObdsFile
    }

    $Summary.FetchedThis = $fetchedObdSet.Count
    $Summary.FailedThis  = $todayFailed.Count


    # ============================================================
    #  PHASE 8 - RETRY FAILED OBDs FROM PRIOR RUNS
    # ============================================================

    $retriedCount = 0
    if (Test-Path $FailedJsonObdsFile) {
        $priorFailed = @(Get-Content $FailedJsonObdsFile | Where-Object { $_.Trim() -ne "" })
        # Only retry OBDs in today's Breakwalls list that we haven't fetched yet
        $toRetry = @($priorFailed | Where-Object {
            $allObdsArr -contains $_ -and
            -not $fetchedObdSet.Contains($_) -and
            $todayFailed -notcontains $_
        })

        if ($toRetry.Count -gt 0) {
            Write-Log "PHASE 8 - Retrying $($toRetry.Count) prior-failed OBDs"
            $stillFailed = [System.Collections.Generic.List[string]]::new()
            foreach ($obd in $toRetry) {
                Get-RandomDelay -Min 1 -Max 3
                $hdr = $headerRowsByObd[$obd]
                if ($null -eq $hdr) {
                    Write-Log "RETRY $obd - no header row, skipping" "Yellow"
                    $stillFailed.Add($obd)
                    continue
                }
                $smu   = if ($hdr.SMU) { $hdr.SMU.ToString() } else { "" }
                $lines = Get-ObdJsonData -ObdNumber $obd -Session $Session -Config $config
                if ($null -ne $lines) {
                    $todayHdrRows.Add($hdr)
                    foreach ($ln in $lines) { $todayLineRows.Add((Build-LineRow -obd $obd -line $ln -hdrSmu $smu)) }
                    $fetchedObdSet.Add($obd) | Out-Null
                    $retriedCount++
                    Write-Log "RETRY $obd - OK ($($lines.Count) lines)" "Green"
                } else {
                    $stillFailed.Add($obd)
                    Write-Log "RETRY $obd - still failing" "Yellow"
                }
            }

            # Rewrite failed-obds-json.txt: keep still-failing + today's new failures
            $combined = @(@($stillFailed) + @($todayFailed) | Select-Object -Unique)
            if ($combined.Count -gt 0) {
                $combined | Set-Content $FailedJsonObdsFile
            } else {
                Remove-Item $FailedJsonObdsFile -Force -ErrorAction SilentlyContinue
            }
        }
    }

    $Summary.FetchedThis = $fetchedObdSet.Count   # updated with retried successes


    # ============================================================
    #  PHASE 9 - BUILD PAYLOAD + POST ?action=auto-json
    # ============================================================

    if ($fetchedObdSet.Count -gt 0) {
        Write-Log "PHASE 9 - Building payload ($($todayHdrRows.Count) header rows, $($todayLineRows.Count) line rows)"

        $payload = @{
            headerRows = @($todayHdrRows)
            lineRows   = @($todayLineRows)
        }

        if ($DryRun) {
            $dryRunFolder = "$OutputFolder\dryrun"
            if (-not (Test-Path $dryRunFolder)) { New-Item -ItemType Directory -Path $dryRunFolder | Out-Null }
            $dryRunTs   = Get-Date -Format "HHmmss"
            $dryRunFile = "$dryRunFolder\$EffectiveDate-$dryRunTs.json"
            $payload | ConvertTo-Json -Depth 5 | Set-Content $dryRunFile -Encoding UTF8
            Write-Log "[DRY RUN] would POST $($todayHdrRows.Count) header rows + $($todayLineRows.Count) line rows to ?action=auto-json" "Cyan"
            Write-Log "[DRY RUN] payload written to $dryRunFile" "Cyan"
            $Summary.UploadStatus = "DRY RUN (not posted)"
        } else {
            Get-RandomDelay -Min 1 -Max 3
            $upRes = Send-JsonPayloadToOrbitOMS -Payload $payload
            if ($upRes.Success) {
                $Summary.UploadStatus   = "SUCCESS"
                $Summary.UploadImported = $upRes.Imported
                $Summary.UploadSkipped  = $upRes.Skipped
                $Summary.UploadErrors   = $upRes.Errors
            } else {
                $Summary.UploadStatus  = "FAILED -> pending-upload-json.txt"
                $Summary.PendingUpload = $true
                Add-PendingJsonUpload -Payload $payload -Date $EffectiveDate
            }
        }
    } else {
        Write-Log "PHASE 9 - No new OBDs fetched this cycle, skipping upload"
        $Summary.UploadStatus = "n/a (no new OBDs)"
    }


    # ============================================================
    #  PHASE 9.5 - PATCH HEADERS FOR EXISTING OBDs
    # ============================================================

    if ($null -ne $existingSet -and $existingSet.Count -gt 0) {
        $existingObds = @($allObdsArr | Where-Object { $existingSet.Contains($_) })
        Write-Log "PHASE 9.5 - Patch headers for $($existingObds.Count) existing OBDs"

        $patchRows = @($existingObds | ForEach-Object { Build-PatchHeaderRow $headerRowsByObd[$_] })

        Get-RandomDelay -Min 1 -Max 3
        Send-PatchHeadersToOrbitOMS -PatchHeaders $patchRows -IsDryRun ([bool]$DryRun) | Out-Null
    } else {
        Write-Log "PHASE 9.5 - No existing OBDs to patch (pre-check failed or 0 existing)"
    }

}   # end Phase 6 outer block


# ============================================================
#  PHASE 10 - HUMAN-NOISE BACKGROUND GET
# ============================================================

$shouldNoise = $false
if (-not (Test-Path $LastNoiseCallFile)) {
    $shouldNoise = $true
} else {
    $lastNoiseRaw = (Get-Content $LastNoiseCallFile -ErrorAction SilentlyContinue).Trim()
    $lastNoise    = $null
    try { $lastNoise = [datetime]::ParseExact($lastNoiseRaw, "yyyy-MM-dd HH:mm:ss", $null) } catch { $lastNoise = $null }
    if ($lastNoise) {
        $sinceMin  = ((Get-Date) - $lastNoise).TotalMinutes
        $threshold = Get-Random -Minimum $NoiseMinIntervalMin -Maximum $NoiseMaxIntervalMin
        if ($sinceMin -ge $threshold) { $shouldNoise = $true }
    } else {
        $shouldNoise = $true
    }
}
if ($shouldNoise) {
    try {
        Invoke-WebRequest `
            -Uri ($BaseUrl + $ReportPath) `
            -Method GET `
            -WebSession $Session `
            -UseBasicParsing `
            -ErrorAction Stop | Out-Null
        (Get-Date -Format "yyyy-MM-dd HH:mm:ss") | Set-Content $LastNoiseCallFile
        Write-Log "PHASE 10 - Background page GET (looks human)"
    } catch {
        Write-Log "PHASE 10 - Background GET failed (non-fatal): $_" "Yellow"
    }
}


# ============================================================
#  PHASE 11 - CYCLE SUMMARY
# ============================================================

$cycleEnd  = Get-Date
$cycleSecs = [Math]::Round(($cycleEnd - $Summary.CycleStart).TotalSeconds, 1)

$summaryColor = "Green"
if ($Summary.PendingUpload -or $Summary.Errors.Count -gt 0 -or $Summary.FailedThis -gt 0 -or ($Summary.YesterdayRan -and $Summary.YesterdayFailed -gt 0)) {
    $summaryColor = "Red"
} elseif ($Summary.BreakwallsTotal -eq "?" -or $Summary.UploadStatus -eq "n/a (no new OBDs)") {
    $summaryColor = "Yellow"
}

Write-Section "CYCLE SUMMARY  $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" $summaryColor

Write-Host (" Date checked       : {0}" -f $Today)
Write-Host (" Session            : {0}" -f $Summary.SessionAction)
Write-Host (" Pagination         : {0}" -f $Summary.PaginationMode)
Write-Host (" Breakwalls total   : {0}" -f $Summary.BreakwallsTotal)
Write-Host (" Pre-check new      : {0}" -f $Summary.PreCheckNew)
Write-Host (" Pre-check existing : {0}" -f $Summary.PreCheckExisting)
Write-Host (" Fetched (cycle)    : {0}" -f $Summary.FetchedThis)
$failColor = if ($Summary.FailedThis -gt 0) { "Red" } else { "Gray" }
Write-Host " Failed (retry next): " -NoNewline; Write-Host $Summary.FailedThis -ForegroundColor $failColor
Write-Host (" Upload             : {0}" -f $Summary.UploadStatus)
if ($Summary.UploadStatus -eq "SUCCESS") {
    Write-Host ("                      imported={0} skipped={1} errors={2}" -f $Summary.UploadImported, $Summary.UploadSkipped, $Summary.UploadErrors)
}
if ($Summary.PendingUpload) {
    Write-Host " Pending upload     : YES (next cycle will retry)" -ForegroundColor Red
}

if ($Summary.YesterdayRan) {
    Write-Host ""
    Write-Host " Yesterday recovery :" -ForegroundColor Cyan
    Write-Host ("   Breakwalls total : {0}" -f $Summary.YesterdayBreakwallsTotal)
    Write-Host ("   Pre-check new    : {0}" -f $Summary.YesterdayPreCheckNew)
    Write-Host ("   Fetched          : {0}" -f $Summary.YesterdayFetched)
    Write-Host ("   Failed           : {0}" -f $Summary.YesterdayFailed)
    Write-Host ("   Upload           : {0}" -f $Summary.YesterdayUpload)
    $yState2 = Read-YesterdayState
    if ($yState2) {
        $yColor = if ($yState2.Status -eq "done") { "Green" } else { "Yellow" }
        Write-Host "   Status           : " -NoNewline; Write-Host $yState2.Status -ForegroundColor $yColor
    }
}

if ($Summary.Errors.Count -gt 0) {
    Write-Host ""
    Write-Host " Errors this cycle  :" -ForegroundColor Red
    foreach ($e in $Summary.Errors) { Write-Host "   - $e" -ForegroundColor Red }
}

Write-Host (" Cycle duration     : {0} sec" -f $cycleSecs)

Add-Content -Path $LogFile -Value "----- CYCLE SUMMARY -----"
Add-Content -Path $LogFile -Value "Date: $Today | Breakwalls: $($Summary.BreakwallsTotal) | New: $($Summary.PreCheckNew) | Fetched: $($Summary.FetchedThis) | Failed: $($Summary.FailedThis) | Upload: $($Summary.UploadStatus) | Cycle: ${cycleSecs}s"
if ($Summary.YesterdayRan) {
    Add-Content -Path $LogFile -Value "Yesterday: total=$($Summary.YesterdayBreakwallsTotal) new=$($Summary.YesterdayPreCheckNew) fetched=$($Summary.YesterdayFetched) failed=$($Summary.YesterdayFailed) upload=$($Summary.YesterdayUpload)"
}

Write-Section "RUN COMPLETE" $summaryColor

#endregion MAIN PIPELINE
