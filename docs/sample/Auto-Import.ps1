# ============================================================
#  Auto-Import.ps1 -- v2.0
#  Full automated OBD import pipeline for OrbitOMS
#
#  Goal: Zero OBDs missed, minimum cycle time, self-healing.
#
#  Pipeline order (per cycle):
#    Phase 1  - Cleanup + daily reset
#    Phase 2  - Login (cached session reused, lazy re-login on expiry)
#    Phase 3  - Yesterday recovery (first-of-day, retries until success)
#    Phase 4  - Spec prime (only when needed)
#    Phase 5  - Pending upload retry (from previous cycle)
#    Phase 6  - Tally-based pagination for today
#    Phase 7  - Download missing OBDs
#    Phase 8  - Retry failed OBDs from prior runs
#    Phase 9  - Header download (3 retry, fallback to existing)
#    Phase 10 - Merge into combined Excel
#    Phase 11 - Upload to OrbitOMS (3 retry, then pending-upload.txt)
#    Phase 12 - Cycle summary (terminal + log)
#
#  Run via Windows Task Scheduler (every 10 min recommended).
#  Time-of-day logic lives in Task Scheduler, not here.
# ============================================================

#region CONFIG

$ToolRoot        = "$env:USERPROFILE\OneDrive\VS Code\OBD-Import Tool v2"
$HeaderFolder    = "$ToolRoot\Header File"
$LineItemFolder  = "$ToolRoot\LineItem File"
$OutputFolder    = "$ToolRoot\Output"
$KeywordsFile    = "$ToolRoot\Master\tinting-keywords.txt"
$PackSizesFile   = "$ToolRoot\Master\pack-sizes.txt"
$KeyFile         = "$ToolRoot\import-key.txt"
$ConfigFile      = "$ToolRoot\breakwalls-config.txt"
$LogFolder       = "$ToolRoot\logs"

# State files (Master folder)
$DailyStateFile      = "$ToolRoot\Master\daily-state.txt"
$SessionFile         = "$ToolRoot\Master\session-cookie.txt"
$FailedObdsFile      = "$ToolRoot\Master\failed-obds.txt"
$YesterdayStateFile  = "$ToolRoot\Master\yesterday-recovery-state.txt"
$PendingUploadFile   = "$ToolRoot\Master\pending-upload.txt"
$LastSpecCallFile    = "$ToolRoot\Master\last-spec-call.txt"
$LastNoiseCallFile   = "$ToolRoot\Master\last-noise-call.txt"

# API + breakwalls
$ApiUrl             = "https://orbit-oms.vercel.app/api/import/obd?action=auto"
$KeyId              = "auto-import-v1"
$BaseUrl            = "https://an.breakwalls.biz"
$LoginPath          = "/deco-tracker/LoginV2/Login.aspx"
$ReportPath         = "/deco-tracker/Reports/105VCsI1rQ6u1QSEyGJ7I3Lc"
$ExportPath         = "/deco-tracker/export"
$DataPath           = "/deco-tracker/data"
$FormdataPath       = "/deco-tracker/formdata"
$SpecPath           = "/deco-tracker/spec"
$AppVersionFallback = "VmRhZP4kZj=="

# Time + date
$Today           = Get-Date -Format "yyyy-MM-dd"
$Yesterday       = (Get-Date).AddDays(-1).ToString("yyyy-MM-dd")
$KeepDays        = 2

# Session reuse: try cached cookie up to 4 hours old. Lazy re-login on expiry.
$CookieMaxAgeMin = 240

# Spec call cache: skip /spec if called within last 2 hours on cached session
$SpecCacheMinutes = 120

# Noise call (background human-like GET): every 30-60 min
$NoiseMinIntervalMin = 30
$NoiseMaxIntervalMin = 60

# Cycle summary tracking (populated through phases)
$Summary = [ordered]@{
    CycleStart               = Get-Date
    DateChecked              = $Today
    BreakwallsTotal          = "?"
    FolderCount              = 0
    Match                    = "?"
    DownloadedThis           = 0
    FailedThis               = 0
    YesterdayRan             = $false
    YesterdayBreakwallsTotal = 0
    YesterdayMissingBefore   = 0
    YesterdayDownloaded      = 0
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
$LogFile = "$LogFolder\import-log-$(Get-Date -Format 'yyyy-MM-dd').txt"

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

# Clean logs older than 30 days
Get-ChildItem -Path $LogFolder -Filter "import-log-*.txt" -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } |
    Remove-Item -Force -ErrorAction SilentlyContinue

#endregion


#region HELPERS

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

# Variable, content-aware delay (looks human)
function Get-RandomDelay {
    param([int]$Min = 3, [int]$Max = 8)
    $seconds = Get-Random -Minimum $Min -Maximum $Max
    Start-Sleep -Seconds $seconds
}

# AppVersion: use live value from login HTML if found, else fallback
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

function Get-CellValue {
    param($worksheet, [int]$row, [int]$col)
    $val = $worksheet.Cells[$row, $col].Value
    if ($null -eq $val) { return "" }
    return $val.ToString().Trim()
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

# Detect login-page content in a response (signals expired session)
function Test-IsLoginRedirect {
    param([string]$Content)
    if (-not $Content) { return $false }
    if ($Content -match 'LoginV2/Login\.aspx') { return $true }
    if ($Content -match 'name="__VIEWSTATE"' -and $Content -match 'inpUserName') { return $true }
    return $false
}

# Try to use cached session cookie
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

# Fresh login with up to 3 retries
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

            # Try to extract a live AppVersion from the page (best-effort)
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

            # Save session cookie
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

# Spec prime — only when needed
function Invoke-SpecPrime {
    param($Session, [string]$Reason = "default")

    # Skip if cached spec call is recent (only for default reason)
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

        # Cache successful spec call timestamp
        (Get-Date -Format "yyyy-MM-dd HH:mm:ss") | Set-Content $LastSpecCallFile
        $kb = [Math]::Round($specResponse.Content.Length / 1024, 1)
        Write-Log "SPEC - Primed OK ($kb KB)"
        return $true
    } catch {
        Write-Log "SPEC - Failed: $_" "Yellow"
        return $false
    }
}

# Fetch one OBD list page with retries + lazy re-login
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

            # Login redirect check
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

# Try to read a total count from a /data response in a robust way
function Get-TotalCount {
    param($PageResult)
    if (-not $PageResult) { return -1 }

    # Best-effort field probe (we don't know the exact field name yet)
    $candidates = @('total_count', 'totalCount', 'total', 'totalRecords', 'recordsFiltered', 'recordsTotal', 'count', 'last_row')
    foreach ($f in $candidates) {
        if ($PageResult.PSObject.Properties[$f]) {
            $v = $PageResult.$f
            if ($v -is [int] -or $v -is [long]) { return [int]$v }
            if ($v -match '^\d+$') { return [int]$v }
        }
    }

    # Fallback: signal unknown — caller should use estimated/lower-bound logic
    return -1
}

# Download one OBD with one retry + lazy re-login
function Get-ObdFile {
    param([string]$ObdNumber, [string]$DestFolder, $Session, [hashtable]$Config)

    $obdFile = "$DestFolder\$ObdNumber.xlsx"

    $maxAttempts = 2
    for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {

        $submitBody = [ordered]@{
            action      = "FormSubmitData"
            button      = "Download"
            componentId = "c01105VCsI1rQ6u1QSEyGJ7I3Lc"
            formName    = "View OBD Details"
            reportId    = "Reports/105VCsI1rQ6u1QSEyGJ7I3Lc"
            uniqueKVP   = [ordered]@{ PickListId = $ObdNumber }
            formdata    = [ordered]@{ picklistid = $ObdNumber }
        } | ConvertTo-Json -Depth 5

        try {
            $submitResponse = Invoke-WebRequest `
                -Uri ($BaseUrl + $FormdataPath) `
                -Method POST `
                -Body $submitBody `
                -ContentType "application/json" `
                -Headers (Get-BrowserHeaders) `
                -WebSession $Session `
                -UseBasicParsing `
                -ErrorAction Stop

            if (Test-IsLoginRedirect $submitResponse.Content) {
                Write-Log "OBD $ObdNumber - session expired, re-login" "Yellow"
                if (Test-Path $SessionFile) { Remove-Item $SessionFile -Force }
                $relogin = Invoke-FreshLogin -Session $Session -Config $Config
                if (-not $relogin) { return $false }
                Invoke-SpecPrime -Session $Session -Reason "post-relogin" | Out-Null
                continue
            }

            $submitResult = $submitResponse.Content | ConvertFrom-Json
            if (-not $submitResult.success -or -not $submitResult.downloadFile) {
                Write-Log "OBD ERROR - $ObdNumber - unexpected response" "Yellow"
                if ($attempt -lt $maxAttempts) { Start-Sleep -Seconds 5 }
                continue
            }

            Invoke-WebRequest `
                -Uri ($BaseUrl + "/deco-tracker/" + $submitResult.downloadFile) `
                -Method GET `
                -WebSession $Session `
                -OutFile $obdFile `
                -UseBasicParsing `
                -ErrorAction Stop

            $obdSize = (Get-Item $obdFile).Length
            if ($obdSize -lt 1000) {
                Write-Log "OBD ERROR - $ObdNumber - file too small ($obdSize bytes)" "Yellow"
                Remove-Item $obdFile -Force -ErrorAction SilentlyContinue
                if ($attempt -lt $maxAttempts) { Start-Sleep -Seconds 5 }
                continue
            }

            Write-Log "OBD OK - $ObdNumber ($([Math]::Round($obdSize / 1024, 1)) KB)" "Green"
            return $true

        } catch {
            Write-Log "OBD ERROR - $ObdNumber attempt $attempt - $_" "Yellow"
            if ($attempt -lt $maxAttempts) { Start-Sleep -Seconds 5 }
        }
    }

    return $false
}

# Download header file for a given date with 3 retries; fallback to existing on disk
function Get-HeaderFile {
    param([string]$Date, $Session, [hashtable]$Config)

    $TargetFolder = "$HeaderFolder\$Date"
    if (-not (Test-Path $TargetFolder)) {
        New-Item -ItemType Directory -Path $TargetFolder | Out-Null
    }
    $TargetFile = "$TargetFolder\LogisticsTracker $Date.xlsx"

    $maxAttempts = 3
    for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {

        $exportBody = [ordered]@{
            reportId   = "Reports/105VCsI1rQ6u1QSEyGJ7I3Lc"
            button     = "Export"
            export     = $true
            components = @(
                [ordered]@{
                    componentId = "c01105VCsI1rQ6u1QSEyGJ7I3Lc"
                    filters     = @()
                    params      = @(
                        [ordered]@{ field = "picklistdate"; value = $Date }
                        [ordered]@{ field = "transporter";  value = "Select Transporter" }
                        [ordered]@{ field = "formName";     value = "" }
                    )
                }
            )
        } | ConvertTo-Json -Depth 5

        try {
            $exportResponse = Invoke-WebRequest `
                -Uri ($BaseUrl + $ExportPath) `
                -Method POST `
                -Body $exportBody `
                -ContentType "application/json" `
                -Headers (Get-BrowserHeaders) `
                -WebSession $Session `
                -UseBasicParsing `
                -ErrorAction Stop

            if (Test-IsLoginRedirect $exportResponse.Content) {
                Write-Log "HEADER - session expired on export call" "Yellow"
                if (Test-Path $SessionFile) { Remove-Item $SessionFile -Force }
                $relogin = Invoke-FreshLogin -Session $Session -Config $Config
                if (-not $relogin) { return $null }
                Invoke-SpecPrime -Session $Session -Reason "post-relogin" | Out-Null
                continue
            }

            $exportResult = $exportResponse.Content | ConvertFrom-Json
            if (-not $exportResult.success -or -not $exportResult.downloadFile) {
                Write-Log "HEADER - export attempt $attempt unexpected response" "Yellow"
                if ($attempt -lt $maxAttempts) { Start-Sleep -Seconds (10 * $attempt) }
                continue
            }

            Get-RandomDelay -Min 2 -Max 4

            Invoke-WebRequest `
                -Uri ($BaseUrl + "/deco-tracker/" + $exportResult.downloadFile) `
                -Method GET `
                -WebSession $Session `
                -OutFile $TargetFile `
                -UseBasicParsing `
                -ErrorAction Stop

            $sz = (Get-Item $TargetFile).Length
            if ($sz -lt 1000) {
                Write-Log "HEADER - file too small ($sz bytes) on attempt $attempt" "Yellow"
                Remove-Item $TargetFile -Force -ErrorAction SilentlyContinue
                if ($attempt -lt $maxAttempts) { Start-Sleep -Seconds (10 * $attempt) }
                continue
            }

            Write-Log "HEADER - Downloaded ($([Math]::Round($sz / 1024, 1)) KB)" "Green"
            return $TargetFile

        } catch {
            Write-Log "HEADER - attempt $attempt failed: $_" "Yellow"
            if ($attempt -lt $maxAttempts) { Start-Sleep -Seconds (10 * $attempt) }
        }
    }

    # Fallback: reuse existing header on disk if present
    if (Test-Path $TargetFile) {
        $sz = (Get-Item $TargetFile).Length
        if ($sz -gt 1000) {
            Write-Log "HEADER - All attempts failed, REUSING existing on-disk header for $Date ($([Math]::Round($sz / 1024, 1)) KB)" "Yellow"
            return $TargetFile
        }
    }

    Write-Log "HEADER - All attempts failed and no fallback available for $Date" "Red"
    return $null
}

# Build combined Excel from line files + header file for a given date
function Build-CombinedExcel {
    param([string]$Date, [string]$HeaderFilePath)

    $LineFolder = "$LineItemFolder\$Date"
    if (-not (Test-Path $LineFolder)) {
        Write-Log "MERGE - Line folder missing for $Date" "Red"
        return $null
    }

    $obdFiles = Get-ChildItem -Path $LineFolder -Filter "*.xlsx" -File -ErrorAction SilentlyContinue
    if ($obdFiles.Count -eq 0) {
        Write-Log "MERGE - No line files in $Date folder, nothing to merge"
        return $null
    }

    $lineFileObdNumbers = $obdFiles | ForEach-Object { $_.BaseName }
    Write-Log "MERGE - $($obdFiles.Count) line files in $Date folder"

    $srcExcel = $null
    try {
        $srcExcel = Open-ExcelPackage -Path $HeaderFilePath
    } catch {
        Write-Log "MERGE - Failed to open header file: $_" "Red"
        return $null
    }

    $srcSheet = $srcExcel.Workbook.Worksheets["LogisticsTrackerWareHouse"]
    if ($null -eq $srcSheet) {
        Write-Log "MERGE - Sheet 'LogisticsTrackerWareHouse' not found in header" "Red"
        Close-ExcelPackage $srcExcel -NoSave
        return $null
    }

    $colCount   = $srcSheet.Dimension.End.Column
    $rowCount   = $srcSheet.Dimension.End.Row
    $colNames   = @()
    $headerData = @()

    $textColumns = @('OBD Number','ShipToCustomerId','Bill To Customer Id','OBD Update','SONum','ShipToPincode','SMU Code')
    $dateColumns = @('OBD Email Date','InvoiceDate','Dispatch Date','ExpDeliveryDate','ActDeliveryDate','Challan Submission Date (Div 74)','API Act Delivery Date','API Last Status Updated At')

    for ($c = 1; $c -le $colCount; $c++) {
        $name = $srcSheet.Cells[1, $c].Value
        $colNames += if ($null -eq $name -or $name.ToString().Trim() -eq "") { "Col$c" } else { $name.ToString().Trim() }
    }

    for ($r = 2; $r -le $rowCount; $r++) {
        $obdNumCell = $srcSheet.Cells[$r, 1].Value
        if ($null -eq $obdNumCell) { continue }
        $obdNum = $obdNumCell.ToString().Trim()
        if ($lineFileObdNumbers -notcontains $obdNum) { continue }

        $obj = [ordered]@{}
        for ($c = 1; $c -le $colCount; $c++) {
            $cellVal = $srcSheet.Cells[$r, $c].Value
            $colName = $colNames[$c - 1]
            if ($null -ne $cellVal) {
                if ($dateColumns -contains $colName) {
                    if ($cellVal -is [datetime]) { $cellVal = $cellVal.ToString("yyyy-MM-dd") }
                    elseif ($cellVal -is [double] -or $cellVal -is [int]) {
                        try { $cellVal = [datetime]::FromOADate([double]$cellVal).ToString("yyyy-MM-dd") }
                        catch { $cellVal = $cellVal.ToString() }
                    }
                } elseif ($textColumns -contains $colName) {
                    $cellVal = $cellVal.ToString().Trim()
                }
            }
            $obj[$colName] = $cellVal
        }
        $headerData += [PSCustomObject]$obj
    }
    Close-ExcelPackage $srcExcel -NoSave

    Write-Log "MERGE - Header filtered to $($headerData.Count) OBDs"

    $rawRows = [System.Collections.Generic.List[PSCustomObject]]::new()

    foreach ($file in $obdFiles) {
        try {
            $excel = Open-ExcelPackage -Path $file.FullName
            $ws    = $excel.Workbook.Worksheets[1]
            $OBDNo = Get-CellValue $ws 3 2
            if (-not $OBDNo) { Close-ExcelPackage $excel -NoSave; continue }
            $SMU = Get-CellValue $ws 5 6

            $r = 18; $maxRow = $ws.Dimension.End.Row
            while ($r -le $maxRow) {
                $lineId = Get-CellValue $ws $r 1
                if (-not $lineId) { break }
                $qtyRaw = Get-NumericOnly (Get-CellValue $ws $r 10)
                $volRaw = Get-NumericOnly (Get-CellValue $ws $r 11)
                $rawRows.Add([PSCustomObject][ordered]@{
                    obd_number      = $OBDNo
                    smu             = $SMU
                    sku_codes       = Get-CellValue $ws $r 2
                    sku_description = Get-CellValue $ws $r 5
                    unit_qty        = if ($qtyRaw -ne "") { [decimal]$qtyRaw } else { [decimal]0 }
                    volume_line     = if ($volRaw -ne "") { [decimal]$volRaw } else { [decimal]0 }
                })
                $r++
            }
            Close-ExcelPackage $excel -NoSave
        } catch {
            Write-Log "MERGE - Error processing $($file.Name): $_" "Yellow"
        }
    }

    # Per-line transformation -- preserve every raw row exactly as the SAP file delivered it.
    # Same-SKU duplicate rows on one OBD must NOT be merged. Article + Tinting are calculated per line.
    $lineItems = $rawRows | ForEach-Object {
        $artInfo = Get-ArticleInfo $_.volume_line.ToString() $_.unit_qty.ToString()
        [PSCustomObject][ordered]@{
            obd_number      = $_.obd_number
            smu             = $_.smu
            sku_codes       = $_.sku_codes
            sku_description = $_.sku_description
            unit_qty        = $_.unit_qty
            volume_line     = $_.volume_line
            Tinting         = Get-Tinting $_.sku_description $_.smu
            article         = $artInfo.Article
            article_tag     = $artInfo.Tag
        }
    }

    $OutputFile = "$OutputFolder\Combined_OBD_$Date.xlsx"
    if (Test-Path $OutputFile) { Remove-Item $OutputFile -Force }

    $headerData | Export-Excel -Path $OutputFile `
        -WorksheetName "LogisticsTrackerWareHouse" `
        -AutoSize -FreezeTopRow -AutoFilter `
        -TableName "HeaderData" -TableStyle Light8 `
        -NoNumberConversion "OBD Number","ShipToCustomerId","Bill To Customer Id","OBD Update","SONum","ShipToPincode","SMU Code" `
        -ClearSheet

    if ($lineItems.Count -gt 0) {
        $lineItems | Export-Excel -Path $OutputFile `
            -WorksheetName "LineItems" `
            -AutoSize -AutoFilter -FreezeTopRow `
            -TableName "LineItemsData" -TableStyle Light8 `
            -ClearSheet
    }

    Write-Log "MERGE - $($headerData.Count) headers, $($rawRows.Count) raw lines -> Combined_OBD_$Date.xlsx" "Green"
    return $OutputFile
}

# Upload combined Excel to OrbitOMS with up to 3 retries
function Send-CombinedToOrbitOMS {
    param([string]$FilePath, [string]$Secret)

    if (-not (Test-Path $FilePath)) {
        Write-Log "UPLOAD - File missing: $FilePath" "Red"
        return @{ Success = $false; Status = "missing-file" }
    }

    $KeyBytes  = [System.Text.Encoding]::UTF8.GetBytes($Secret)
    $MsgBytes  = [System.Text.Encoding]::UTF8.GetBytes("auto-import-v1")
    $Hmac      = New-Object System.Security.Cryptography.HMACSHA256
    $Hmac.Key  = $KeyBytes
    $SigBytes  = $Hmac.ComputeHash($MsgBytes)
    $Signature = ($SigBytes | ForEach-Object { $_.ToString("x2") }) -join ""

    $fileBytes   = [System.IO.File]::ReadAllBytes($FilePath)
    $fileName    = [System.IO.Path]::GetFileName($FilePath)
    $boundary    = [System.Guid]::NewGuid().ToString("N")
    $contentType = "multipart/form-data; boundary=$boundary"

    $bodyLines  = [System.Collections.Generic.List[byte[]]]::new()
    $partHeader = "--$boundary`r`nContent-Disposition: form-data; name=`"combinedFile`"; filename=`"$fileName`"`r`nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`r`n`r`n"
    $bodyLines.Add([System.Text.Encoding]::UTF8.GetBytes($partHeader))
    $bodyLines.Add($fileBytes)
    $bodyLines.Add([System.Text.Encoding]::UTF8.GetBytes("`r`n--$boundary--`r`n"))

    $totalSize = ($bodyLines | Measure-Object -Property Length -Sum).Sum
    $body      = New-Object byte[] $totalSize
    $offset    = 0
    foreach ($part in $bodyLines) {
        [System.Buffer]::BlockCopy($part, 0, $body, $offset, $part.Length)
        $offset += $part.Length
    }

    $uploadHeaders = @{
        "x-import-key-id"    = $KeyId
        "x-import-signature" = $Signature
    }

    $maxAttempts = 3
    for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
        try {
            $resp = Invoke-WebRequest `
                -Uri $ApiUrl `
                -Method POST `
                -ContentType $contentType `
                -Body $body `
                -Headers $uploadHeaders `
                -UseBasicParsing `
                -TimeoutSec 60 `
                -ErrorAction Stop

            $parsed = $resp.Content | ConvertFrom-Json
            Write-Log "UPLOAD - SUCCESS batchRef=$($parsed.batchRef) imported=$($parsed.ordersCreated) skipped=$($parsed.skippedDuplicates) errors=$($parsed.errors)" "Green"
            return @{
                Success    = $true
                Status     = "success"
                Imported   = [int]$parsed.ordersCreated
                Skipped    = [int]$parsed.skippedDuplicates
                Errors     = [int]$parsed.errors
                BatchRef   = $parsed.batchRef
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
            Write-Log "UPLOAD attempt $attempt failed: $errMsg" "Yellow"
            if ($attempt -lt $maxAttempts) { Start-Sleep -Seconds (10 * $attempt) }
        }
    }

    Write-Log "UPLOAD - All $maxAttempts attempts failed for $FilePath" "Red"
    return @{ Success = $false; Status = "all-attempts-failed" }
}

# Append/update pending-upload list (one file path per line, with date)
function Add-PendingUpload {
    param([string]$FilePath, [string]$Date)
    $entry = "$Date|$FilePath"
    $existing = @()
    if (Test-Path $PendingUploadFile) {
        $existing = Get-Content $PendingUploadFile | Where-Object { $_.Trim() -ne "" }
    }
    if ($existing -notcontains $entry) {
        $existing += $entry
    }
    $existing | Set-Content $PendingUploadFile
}

function Remove-PendingUpload {
    param([string]$FilePath)
    if (-not (Test-Path $PendingUploadFile)) { return }
    $existing = @(Get-Content $PendingUploadFile | Where-Object { $_.Trim() -ne "" -and -not $_.EndsWith("|$FilePath") })
    if ($existing.Count -eq 0) {
        Remove-Item $PendingUploadFile -Force -ErrorAction SilentlyContinue
    } else {
        $existing | Set-Content $PendingUploadFile
    }
}

# Tally file helpers
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

# Yesterday recovery state helpers
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

#endregion


#region MAIN PIPELINE

Write-Log ""
Write-Section "RUN STARTED  $Today" "Cyan"

# ============================================================
#  PHASE 1 - CLEANUP + DAILY RESET
# ============================================================

$isFirstRunToday = $false
$rolledOverFrom = $Yesterday
if (Test-Path $DailyStateFile) {
    $lastRunDate = (Get-Content $DailyStateFile -First 1).Trim()
    if ($lastRunDate -ne $Today) {
        $isFirstRunToday = $true
        $rolledOverFrom = $lastRunDate
    }
} else {
    $isFirstRunToday = $true
}

if ($isFirstRunToday) {
    Write-Log "PHASE 1 - First run of new day. Date rolled from $rolledOverFrom to $Today" "Cyan"
    if (Test-Path $FailedObdsFile)    { Remove-Item $FailedObdsFile -Force }
    if (Test-Path $PendingUploadFile) { Remove-Item $PendingUploadFile -Force }
    if (Test-Path $LastSpecCallFile)  { Remove-Item $LastSpecCallFile -Force }
    # Note: do NOT wipe session-cookie.txt; lazy re-login handles it.

    # Flag yesterday for recovery (rolledOverFrom handles weekend gaps too)
    Write-YesterdayState -Status "pending" -Date $rolledOverFrom -Attempts 0
    Write-Log "PHASE 1 - Yesterday recovery flagged for $rolledOverFrom"

    # Update daily state
    $Today | Set-Content $DailyStateFile
}

# Cleanup folders older than KeepDays
$cutoffDate = (Get-Date).AddDays(-$KeepDays).Date

foreach ($baseFolder in @($HeaderFolder, $LineItemFolder)) {
    Get-ChildItem -Path $baseFolder -Directory -ErrorAction SilentlyContinue |
        Where-Object {
            $folderDate = $null
            try { $folderDate = [datetime]::ParseExact($_.Name, "yyyy-MM-dd", $null) } catch { $folderDate = $null }
            if ($folderDate) { $folderDate -lt $cutoffDate } else { $false }
        } |
        ForEach-Object {
            Remove-Item $_.FullName -Recurse -Force -ErrorAction SilentlyContinue
            Write-Log "CLEANUP - Deleted folder: $($_.Name)"
        }
}

Get-ChildItem -Path $OutputFolder -Filter "Combined_OBD_*.xlsx" -ErrorAction SilentlyContinue |
    Where-Object {
        $fileDate = $null
        try {
            $datePart = $_.BaseName -replace "Combined_OBD_", ""
            $fileDate = [datetime]::ParseExact($datePart, "yyyy-MM-dd", $null)
        } catch { $fileDate = $null }
        if ($fileDate) { $fileDate -lt $cutoffDate } else { $false }
    } |
    ForEach-Object {
        Remove-Item $_.FullName -Force -ErrorAction SilentlyContinue
        Write-Log "CLEANUP - Deleted output: $($_.Name)"
    }

# Cleanup tally files older than KeepDays
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


# ============================================================
#  Bootstrapping: load config + dependencies
# ============================================================

if (-not (Test-Path $ConfigFile)) {
    Write-Log "FATAL - breakwalls-config.txt not found" "Red"
    exit 1
}
$config = @{}
Get-Content $ConfigFile | ForEach-Object {
    $line = $_.Trim()
    if ($line -eq "" -or $line.StartsWith("#")) { return }
    $parts = $line -split "=", 2
    if ($parts.Count -eq 2) { $config[$parts[0].Trim()] = $parts[1].Trim() }
}
if (-not $config["USERNAME"] -or -not $config["PASSWORD"]) {
    Write-Log "FATAL - USERNAME or PASSWORD missing from breakwalls-config.txt" "Red"
    exit 1
}

if (-not (Test-Path $KeyFile)) {
    Write-Log "FATAL - import-key.txt not found" "Red"
    exit 1
}
$Secret = (Get-Content $KeyFile -Raw).Trim()
if (-not $Secret) {
    Write-Log "FATAL - import-key.txt is empty" "Red"
    exit 1
}

if (-not (Get-Module -ListAvailable -Name ImportExcel)) {
    Write-Log "FATAL - ImportExcel module not found. Install: Install-Module ImportExcel -Scope CurrentUser -Force" "Red"
    exit 1
}
Import-Module ImportExcel -ErrorAction Stop

if (-not (Test-Path $KeywordsFile)) {
    Write-Log "FATAL - tinting-keywords.txt not found" "Red"
    exit 1
}
$tintingKeywords = Get-Content $KeywordsFile |
    Where-Object { $_.Trim() -ne "" -and -not $_.StartsWith("#") } |
    ForEach-Object { $_.Trim().ToUpper() }

if (-not (Test-Path $PackSizesFile)) {
    Write-Log "FATAL - pack-sizes.txt not found" "Red"
    exit 1
}
$drumSizes      = @()
$bagSizes       = @()
$cartonMap      = @{}
$currentSection = ""
foreach ($line in (Get-Content $PackSizesFile)) {
    $line = $line.Trim()
    if ($line -eq "" -or $line.StartsWith("#")) { continue }
    if ($line -match '^\[(.+)\]$') { $currentSection = $Matches[1].ToUpper(); continue }
    switch ($currentSection) {
        "DRUM"   { $drumSizes += [decimal]$line }
        "BAG"    { $bagSizes  += [decimal]$line }
        "CARTON" {
            $parts = $line -split "=", 2
            if ($parts.Count -eq 2) { $cartonMap[[decimal]$parts[0]] = [int]$parts[1] }
        }
    }
}


# ============================================================
#  PHASE 2 - LOGIN
# ============================================================

Write-Log "PHASE 2 - Login"

$sessInit = Initialize-Session
$Session = $sessInit.Session
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
    # After fresh login, follow up with a GET to the report page (looks human)
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

$yState = Read-YesterdayState
if ($yState -and $yState.Status -eq "pending") {

    $recoveryDate = $yState.Date
    Write-Log "PHASE 3 - Yesterday recovery for $recoveryDate (attempt $($yState.Attempts + 1))" "Cyan"

    Write-YesterdayState -Status "pending" -Date $recoveryDate -Attempts ($yState.Attempts + 1)
    $Summary.YesterdayRan = $true

    # Spec prime for the past date (mandatory — switches server context)
    Invoke-SpecPrime -Session $Session -Reason "yesterday-recovery" | Out-Null
    Get-RandomDelay -Min 2 -Max 5

    $yPage1 = Get-OBDListPage -PageNum 1 -Date $recoveryDate -Session $Session -Config $config
    if ($yPage1) {
        $yLastPage = [int]$yPage1.last_page
        $yPage1Obds = @($yPage1.data | ForEach-Object { $_.PickListId.ToString() })
        $allYesterdayObds = [System.Collections.Generic.List[string]]::new()
        foreach ($o in $yPage1Obds) { $allYesterdayObds.Add($o) }

        # Diagnostic on first deploy: show available response keys
        $keyList = ($yPage1.PSObject.Properties.Name -join ', ')
        Write-Log "DIAG - Yesterday page 1 response keys: $keyList"

        if ($yLastPage -gt 1) {
            # Random page order for pages 2+ (looks human)
            $pageOrder = 2..$yLastPage | Get-Random -Count ($yLastPage - 1)
            foreach ($p in $pageOrder) {
                Get-RandomDelay -Min 1 -Max 3
                $pr = Get-OBDListPage -PageNum $p -Date $recoveryDate -Session $Session -Config $config
                if ($pr -and $pr.data) {
                    $pageObds = @($pr.data | ForEach-Object { $_.PickListId.ToString() })
                    foreach ($o in $pageObds) { $allYesterdayObds.Add($o) }
                    Write-Log "Y-RECOVERY - Page $p/$yLastPage : $($pageObds.Count) OBDs"
                } else {
                    Write-Log "Y-RECOVERY - Page $p failed all retries (will catch next cycle)" "Yellow"
                }
            }

            # Refetch page 1 to catch additions during pagination
            Get-RandomDelay -Min 1 -Max 3
            $yPage1Refetch = Get-OBDListPage -PageNum 1 -Date $recoveryDate -Session $Session -Config $config
            if ($yPage1Refetch) {
                $newOnPage1 = @($yPage1Refetch.data | ForEach-Object { $_.PickListId.ToString() })
                foreach ($o in $newOnPage1) {
                    if (-not $allYesterdayObds.Contains($o)) {
                        $allYesterdayObds.Add($o)
                        Write-Log "Y-RECOVERY - New OBD on page 1 refetch: $o"
                    }
                }
            }
        }

        # Dedup
        $allYesterdayObds = @($allYesterdayObds | Select-Object -Unique)
        $Summary.YesterdayBreakwallsTotal = $allYesterdayObds.Count

        # Compare against folder
        $yLineFolder = "$LineItemFolder\$recoveryDate"
        if (-not (Test-Path $yLineFolder)) { New-Item -ItemType Directory -Path $yLineFolder | Out-Null }
        $yExisting = @(Get-ChildItem $yLineFolder -Filter "*.xlsx" -File -ErrorAction SilentlyContinue | ForEach-Object { $_.BaseName })
        $yMissing = @($allYesterdayObds | Where-Object { $yExisting -notcontains $_ })

        $Summary.YesterdayMissingBefore = $yMissing.Count
        Write-Log "Y-RECOVERY - Breakwalls: $($allYesterdayObds.Count), Folder: $($yExisting.Count), Missing: $($yMissing.Count)"

        $yDownloaded = 0
        $yFailed = [System.Collections.Generic.List[string]]::new()
        foreach ($obd in $yMissing) {
            Get-RandomDelay -Min 1 -Max 3
            $ok = Get-ObdFile -ObdNumber $obd -DestFolder $yLineFolder -Session $Session -Config $config
            if ($ok) { $yDownloaded++ } else { $yFailed.Add($obd) }
        }

        $Summary.YesterdayDownloaded = $yDownloaded
        $Summary.YesterdayFailed = $yFailed.Count
        Write-Log "Y-RECOVERY - Downloaded: $yDownloaded, Failed: $($yFailed.Count)"

        $yLineCount = (Get-ChildItem $yLineFolder -Filter "*.xlsx" -File -ErrorAction SilentlyContinue).Count
        if ($yLineCount -gt 0) {
            $yHeader = Get-HeaderFile -Date $recoveryDate -Session $Session -Config $config
            if ($yHeader) {
                $yCombined = Build-CombinedExcel -Date $recoveryDate -HeaderFilePath $yHeader
                if ($yCombined) {
                    $upRes = Send-CombinedToOrbitOMS -FilePath $yCombined -Secret $Secret
                    if ($upRes.Success) {
                        $Summary.YesterdayUpload = "imported=$($upRes.Imported) skipped=$($upRes.Skipped)"
                        # Mark done only if folder count matches breakwalls list (no still-missing OBDs)
                        if ($yFailed.Count -eq 0 -and $allYesterdayObds.Count -le $yLineCount) {
                            Write-YesterdayState -Status "done" -Date $recoveryDate -Attempts ($yState.Attempts + 1)
                            Write-Log "Y-RECOVERY - DONE for $recoveryDate" "Green"
                        } else {
                            Write-Log "Y-RECOVERY - Partial (still $($yFailed.Count) failed). Will retry next cycle." "Yellow"
                        }
                    } else {
                        $Summary.YesterdayUpload = "FAILED"
                        Add-PendingUpload -FilePath $yCombined -Date $recoveryDate
                        Write-Log "Y-RECOVERY - Upload failed, parked in pending-upload.txt" "Yellow"
                    }
                }
            }
        } else {
            Write-Log "Y-RECOVERY - Nothing in folder yet. Will retry next cycle." "Yellow"
        }
    } else {
        Write-Log "Y-RECOVERY - Page 1 fetch failed for $recoveryDate. Will retry next cycle." "Yellow"
    }

    Get-RandomDelay -Min 3 -Max 7
}


# ============================================================
#  PHASE 4 - SPEC PRIME (today)
# ============================================================

# After yesterday recovery we always re-prime for today (server context switched)
$specReason = if ($Summary.YesterdayRan) { "post-yesterday" } else { "default" }
Invoke-SpecPrime -Session $Session -Reason $specReason | Out-Null


# ============================================================
#  PHASE 5 - PENDING UPLOAD RETRY
# ============================================================

if (Test-Path $PendingUploadFile) {
    Write-Log "PHASE 5 - Retrying pending uploads"
    $pending = @(Get-Content $PendingUploadFile | Where-Object { $_.Trim() -ne "" })
    foreach ($entry in $pending) {
        $parts = $entry -split '\|', 2
        if ($parts.Count -ne 2) { continue }
        $pendDate = $parts[0]
        $pendFile = $parts[1]
        if (-not (Test-Path $pendFile)) {
            Write-Log "PHASE 5 - Pending file missing: $pendFile, removing from list" "Yellow"
            Remove-PendingUpload -FilePath $pendFile
            continue
        }
        $r = Send-CombinedToOrbitOMS -FilePath $pendFile -Secret $Secret
        if ($r.Success) {
            Remove-PendingUpload -FilePath $pendFile
            Write-Log "PHASE 5 - Pending upload for $pendDate cleared" "Green"
        } else {
            Write-Log "PHASE 5 - Pending upload for $pendDate still failing" "Yellow"
        }
    }
}


# ============================================================
#  PHASE 6 - TODAY: TALLY-BASED PAGINATION
# ============================================================

Write-Log "PHASE 6 - Today's tally check"

$TodayLineFolder = "$LineItemFolder\$Today"
if (-not (Test-Path $TodayLineFolder)) {
    New-Item -ItemType Directory -Path $TodayLineFolder | Out-Null
}
$existingFiles = @(Get-ChildItem $TodayLineFolder -Filter "*.xlsx" -File -ErrorAction SilentlyContinue | ForEach-Object { $_.BaseName })

# Page 1
Get-RandomDelay -Min 2 -Max 5
$page1 = Get-OBDListPage -PageNum 1 -Date $Today -Session $Session -Config $config
if (-not $page1) {
    Write-Log "PHASE 6 - Page 1 unreachable. Cannot tally today. Next cycle will retry." "Red"
    $Summary.PaginationMode = "page1-failed"
    $Summary.BreakwallsTotal = "?"
    $Summary.FolderCount = $existingFiles.Count
    $Summary.Match = "?"
} else {
    $keyList = ($page1.PSObject.Properties.Name -join ', ')
    Write-Log "DIAG - Today page 1 response keys: $keyList"

    $lastPage = [int]$page1.last_page
    $page1Obds = @($page1.data | ForEach-Object { $_.PickListId.ToString() })
    $totalCountRaw = Get-TotalCount -PageResult $page1
    $totalCount = if ($totalCountRaw -ge 0) { $totalCountRaw } else { -1 }

    $prevTally = Read-Tally -Date $Today

    $needFullPagination = $true
    if ($prevTally -and $prevTally.Status -eq "ok") {
        $countSame = ($prevTally.TotalCount -ge 0 -and $totalCount -ge 0 -and $prevTally.TotalCount -eq $totalCount)
        $diffObj = Compare-Object $page1Obds $prevTally.Page1Obds -SyncWindow 0
        $page1Same = ($page1Obds.Count -eq $prevTally.Page1Obds.Count) -and (-not $diffObj)
        if ($countSame -and $page1Same) {
            $needFullPagination = $false
            Write-Log "PHASE 6 - Tally unchanged ($totalCount OBDs, page 1 identical). Skipping pagination." "Green"
            $Summary.PaginationMode = "skipped (tally unchanged)"
        }
    }

    $allObds = [System.Collections.Generic.List[string]]::new()
    foreach ($o in $page1Obds) { $allObds.Add($o) }

    if ($needFullPagination) {
        $Summary.PaginationMode = "full ($lastPage pages)"
        Write-Log "PHASE 6 - Fetching all $lastPage pages (random order on pages 2+)"

        if ($lastPage -gt 1) {
            $pageOrder = 2..$lastPage | Get-Random -Count ($lastPage - 1)
            foreach ($p in $pageOrder) {
                Get-RandomDelay -Min 1 -Max 3
                $pr = Get-OBDListPage -PageNum $p -Date $Today -Session $Session -Config $config
                if ($pr -and $pr.data) {
                    $pageObds = @($pr.data | ForEach-Object { $_.PickListId.ToString() })
                    foreach ($o in $pageObds) { $allObds.Add($o) }
                    Write-Log "PHASE 6 - Page $p/$lastPage : $($pageObds.Count) OBDs"
                } else {
                    Write-Log "PHASE 6 - Page $p failed all retries" "Yellow"
                    Save-Tally -Date $Today -TotalCount $totalCount -Page1Obds $page1Obds -Status "incomplete"
                    $Summary.Errors.Add("Page $p fetch failed")
                }
            }

            # Refetch page 1 to catch new OBDs that arrived during pagination
            Get-RandomDelay -Min 1 -Max 3
            $page1Refetch = Get-OBDListPage -PageNum 1 -Date $Today -Session $Session -Config $config
            if ($page1Refetch) {
                $newOnPage1 = @($page1Refetch.data | ForEach-Object { $_.PickListId.ToString() })
                foreach ($o in $newOnPage1) {
                    if (-not $allObds.Contains($o)) {
                        $allObds.Add($o)
                        Write-Log "PHASE 6 - New OBD via page 1 refetch: $o"
                    }
                }
                $page1Obds = $newOnPage1
                $newTotal = Get-TotalCount -PageResult $page1Refetch
                if ($newTotal -ge 0) { $totalCount = $newTotal }
            }
        }

        $allObds = @($allObds | Select-Object -Unique)
        Save-Tally -Date $Today -TotalCount $totalCount -Page1Obds $page1Obds -Status "ok"
    }

    $Summary.BreakwallsTotal = if ($totalCount -ge 0) { $totalCount } else { "$($allObds.Count) (estimated)" }


    # ============================================================
    #  PHASE 7 - DOWNLOAD MISSING OBDs
    # ============================================================

    $missing = @($allObds | Where-Object { $existingFiles -notcontains $_ })
    Write-Log "PHASE 7 - Breakwalls list: $($allObds.Count), Folder: $($existingFiles.Count), Missing: $($missing.Count)"

    $todayDownloaded = 0
    $todayFailed = [System.Collections.Generic.List[string]]::new()

    foreach ($obd in $missing) {
        Get-RandomDelay -Min 1 -Max 3
        $ok = Get-ObdFile -ObdNumber $obd -DestFolder $TodayLineFolder -Session $Session -Config $config
        if ($ok) { $todayDownloaded++ } else { $todayFailed.Add($obd) }
    }

    if ($todayFailed.Count -gt 0) {
        $existingFailed = @()
        if (Test-Path $FailedObdsFile) {
            $existingFailed = Get-Content $FailedObdsFile | Where-Object { $_.Trim() -ne "" }
        }
        ($existingFailed + $todayFailed) | Select-Object -Unique | Set-Content $FailedObdsFile
    }

    $Summary.DownloadedThis = $todayDownloaded
    $Summary.FailedThis = $todayFailed.Count


    # ============================================================
    #  PHASE 8 - RETRY FAILED OBDs FROM PRIOR RUNS
    # ============================================================

    $retriedCount = 0
    if (Test-Path $FailedObdsFile) {
        $failedObds = @(Get-Content $FailedObdsFile | Where-Object { $_.Trim() -ne "" })
        $toRetry = @($failedObds | Where-Object { $todayFailed -notcontains $_ })
        if ($toRetry.Count -gt 0) {
            Write-Log "PHASE 8 - Retrying $($toRetry.Count) prior-failed OBDs"
            $stillFailed = [System.Collections.Generic.List[string]]::new()
            foreach ($obdNumber in $toRetry) {
                $obdFile = "$TodayLineFolder\$obdNumber.xlsx"
                if (Test-Path $obdFile) {
                    Write-Log "RETRY SKIP - $obdNumber already exists"
                    continue
                }
                Get-RandomDelay -Min 1 -Max 3
                $ok = Get-ObdFile -ObdNumber $obdNumber -DestFolder $TodayLineFolder -Session $Session -Config $config
                if ($ok) { $retriedCount++ } else { $stillFailed.Add($obdNumber) }
            }
            $combined = @($stillFailed) + @($todayFailed) | Select-Object -Unique
            if ($combined.Count -gt 0) {
                $combined | Set-Content $FailedObdsFile
            } else {
                Remove-Item $FailedObdsFile -Force -ErrorAction SilentlyContinue
            }
        }
    }


    # ============================================================
    #  PHASE 9-11 - HEADER, MERGE, UPLOAD (only if any new files)
    # ============================================================

    $totalNew = $todayDownloaded + $retriedCount
    if ($totalNew -gt 0) {
        Write-Log "PHASE 9 - Header download (new files = $totalNew)"
        $headerPath = Get-HeaderFile -Date $Today -Session $Session -Config $config

        if ($headerPath) {
            Write-Log "PHASE 10 - Merge"
            $combinedPath = Build-CombinedExcel -Date $Today -HeaderFilePath $headerPath

            if ($combinedPath) {
                Write-Log "PHASE 11 - Upload"
                $upRes = Send-CombinedToOrbitOMS -FilePath $combinedPath -Secret $Secret
                if ($upRes.Success) {
                    $Summary.UploadStatus = "SUCCESS"
                    $Summary.UploadImported = $upRes.Imported
                    $Summary.UploadSkipped = $upRes.Skipped
                    $Summary.UploadErrors = $upRes.Errors
                } else {
                    $Summary.UploadStatus = "FAILED -> pending-upload.txt"
                    Add-PendingUpload -FilePath $combinedPath -Date $Today
                    $Summary.PendingUpload = $true
                }
            } else {
                $Summary.UploadStatus = "merge-failed"
            }
        } else {
            $Summary.UploadStatus = "header-unavailable"
        }
    } else {
        Write-Log "PHASE 9-11 - No new files this cycle, skipping header/merge/upload"
        $Summary.UploadStatus = "n/a (no new files)"
    }

    # Build Match flag for summary
    $finalFolderCount = (Get-ChildItem $TodayLineFolder -Filter "*.xlsx" -File -ErrorAction SilentlyContinue).Count
    $Summary.FolderCount = $finalFolderCount
    if ($totalCount -ge 0) {
        $Summary.Match = if ($finalFolderCount -ge $totalCount) { "YES" } else { "NO ($($totalCount - $finalFolderCount) gap)" }
    } else {
        # No total available; use list count as proxy
        $listCount = $allObds.Count
        $Summary.Match = if ($finalFolderCount -ge $listCount) { "YES (~$listCount)" } else { "NO ($($listCount - $finalFolderCount) gap)" }
    }
}


# ============================================================
#  PHASE 12 - BACKGROUND HUMAN-NOISE GET
# ============================================================

$shouldNoise = $false
if (-not (Test-Path $LastNoiseCallFile)) {
    $shouldNoise = $true
} else {
    $lastNoiseRaw = (Get-Content $LastNoiseCallFile -ErrorAction SilentlyContinue).Trim()
    $lastNoise = $null
    try { $lastNoise = [datetime]::ParseExact($lastNoiseRaw, "yyyy-MM-dd HH:mm:ss", $null) } catch { $lastNoise = $null }
    if ($lastNoise) {
        $sinceMin = ((Get-Date) - $lastNoise).TotalMinutes
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
        Write-Log "PHASE 12 - Background page GET (looks human)"
    } catch {
        Write-Log "PHASE 12 - Background GET failed (non-fatal): $_" "Yellow"
    }
}


# ============================================================
#  CYCLE SUMMARY
# ============================================================

$cycleEnd = Get-Date
$cycleSecs = [Math]::Round(($cycleEnd - $Summary.CycleStart).TotalSeconds, 1)

# Color based on outcome
$summaryColor = "Green"
if ($Summary.PendingUpload -or $Summary.Errors.Count -gt 0 -or $Summary.FailedThis -gt 0 -or ($Summary.YesterdayRan -and $Summary.YesterdayFailed -gt 0)) {
    $summaryColor = "Red"
} elseif ($Summary.Match -eq "?" -or $Summary.UploadStatus -eq "header-unavailable") {
    $summaryColor = "Yellow"
}

Write-Section "CYCLE SUMMARY  $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" $summaryColor

$matchColor = if ($Summary.Match -like "YES*") { "Green" } elseif ($Summary.Match -like "NO*") { "Red" } else { "Yellow" }

Write-Host (" Date checked       : {0} (today)" -f $Today)
Write-Host (" Session            : {0}" -f $Summary.SessionAction)
Write-Host (" Pagination         : {0}" -f $Summary.PaginationMode)
Write-Host (" Breakwalls total   : {0}" -f $Summary.BreakwallsTotal)
Write-Host (" Folder has         : {0} files" -f $Summary.FolderCount)
Write-Host (" Match              : " -NoNewline); Write-Host $Summary.Match -ForegroundColor $matchColor
Write-Host (" Downloaded (cycle) : {0}" -f $Summary.DownloadedThis)
$failColor = if ($Summary.FailedThis -gt 0) { "Red" } else { "Gray" }
Write-Host (" Failed (retry next): " -NoNewline); Write-Host $Summary.FailedThis -ForegroundColor $failColor
Write-Host (" Upload             : {0}" -f $Summary.UploadStatus)
if ($Summary.UploadStatus -eq "SUCCESS") {
    Write-Host ("                      imported={0} skipped={1} errors={2}" -f $Summary.UploadImported, $Summary.UploadSkipped, $Summary.UploadErrors)
}
if ($Summary.PendingUpload) {
    Write-Host (" Pending upload     : YES (next cycle will retry)") -ForegroundColor Red
}

if ($Summary.YesterdayRan) {
    Write-Host ""
    Write-Host (" Yesterday recovery :") -ForegroundColor Cyan
    Write-Host ("   Breakwalls total : {0}" -f $Summary.YesterdayBreakwallsTotal)
    Write-Host ("   Missing before   : {0}" -f $Summary.YesterdayMissingBefore)
    Write-Host ("   Downloaded       : {0}" -f $Summary.YesterdayDownloaded)
    Write-Host ("   Failed           : {0}" -f $Summary.YesterdayFailed)
    Write-Host ("   Upload           : {0}" -f $Summary.YesterdayUpload)
    $yState2 = Read-YesterdayState
    if ($yState2) {
        $yColor = if ($yState2.Status -eq "done") { "Green" } else { "Yellow" }
        Write-Host ("   Status           : " -NoNewline); Write-Host $yState2.Status -ForegroundColor $yColor
    }
}

if ($Summary.Errors.Count -gt 0) {
    Write-Host ""
    Write-Host (" Errors this cycle  :") -ForegroundColor Red
    foreach ($e in $Summary.Errors) { Write-Host "   - $e" -ForegroundColor Red }
}

Write-Host (" Cycle duration     : {0} sec" -f $cycleSecs)

# Mirror summary into log file
Add-Content -Path $LogFile -Value "----- CYCLE SUMMARY -----"
Add-Content -Path $LogFile -Value "Date: $Today | Breakwalls: $($Summary.BreakwallsTotal) | Folder: $($Summary.FolderCount) | Match: $($Summary.Match) | Downloaded: $($Summary.DownloadedThis) | Failed: $($Summary.FailedThis) | Upload: $($Summary.UploadStatus) | Cycle: ${cycleSecs}s"
if ($Summary.YesterdayRan) {
    Add-Content -Path $LogFile -Value "Yesterday: total=$($Summary.YesterdayBreakwallsTotal) missing=$($Summary.YesterdayMissingBefore) downloaded=$($Summary.YesterdayDownloaded) failed=$($Summary.YesterdayFailed) upload=$($Summary.YesterdayUpload)"
}

Write-Section "RUN COMPLETE" $summaryColor

#endregion
