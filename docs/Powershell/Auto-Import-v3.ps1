# ============================================================
#  Auto-Import-v3.ps1 -- v3.0 "fast lane"
#  Pure-JSON auto-import pipeline for OrbitOMS
#
#  v3 replaces the fixed 10-minute full cycle with a mode-based
#  design. Task Scheduler fires this script EVERY 1 MINUTE; the
#  script decides for itself what (if anything) to do:
#
#    MODE by time of day (IST, depot clock):
#      before 10:00  SLEEP (except one MORNING SWEEP on first
#                    run of the day: yesterday catch-up)
#      10:00-13:15   BUSY    - glance every minute
#      13:15-14:30   RELAX   - glance+invoice every ~10 min
#      14:30-18:00   BUSY    - glance every minute
#      18:00-20:00   RELAX   - glance+invoice every ~10 min
#      20:00-24:00   PATROL  - glance every ~30 min
#      00:00-10:00   SLEEP
#
#    GLANCE  = fetch page 1 of today's list, read total count,
#              compare vs OrbitOMS (?action=day-obds). Missing
#              OBDs -> locate (page 1 first, deeper if needed)
#              -> FormGetData -> import. Volume=0 rows import
#              header-only immediately (no detail fetch).
#    INVOICE PASS = one filtered /data ask (pendingstatus =
#              "Pending Dispatch") -> rows carry InvoiceNo ->
#              patch-headers for any OrbitOMS blanks.
#              Runs every 15th busy glance + every RELAX visit.
#    DEEP SWEEP   = full all-pages reconcile of today.
#              Runs once ~13:30 and once ~18:30.
#    MORNING SWEEP= yesterday catch-up (recovery + filtered
#              invoice chase). Once, on first run of the day.
#
#  -Practice : full real READS from Breakwalls, but NO writes
#              to OrbitOMS. Logs "WOULD import/patch ..." so a
#              practice day's diary can be judged against the
#              old robot's real imports.
#
#  Single-instance: a lock file skips this fire if a previous
#  run is still working (belt; Task Scheduler IgnoreNew is
#  braces).
#
#  PowerShell 5.1.  Run via Task Scheduler (every 1 min).
# ============================================================

param(
    [switch]$SkipYesterday,
    [switch]$DryRun,
    [switch]$Practice,
    [switch]$ForceMode,          # with -Mode: override the clock (testing)
    [string]$Mode = "",          # glance | invoice | deepsweep | morning
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
$ApiUrlPatchHeaders    = "https://www.orbitoms.in/api/import/obd?action=patch-headers"
$ApiUrlPendingInvoices = "https://www.orbitoms.in/api/import/obd?action=pending-invoices"
$ApiUrlDayObds         = "https://www.orbitoms.in/api/import/obd?action=day-obds"
$KeyIdJson             = "auto-import-json-v1"

# ---- v3 schedule (24h depot clock) ----
$BusyWindows   = @(
    @{ Start = "10:00"; End = "13:15" },
    @{ Start = "14:30"; End = "18:00" }
)
$RelaxWindows  = @(
    @{ Start = "13:15"; End = "14:30" },
    @{ Start = "18:00"; End = "20:00" }
)
$PatrolWindow  = @{ Start = "20:00"; End = "23:59" }
$DayStartHour  = 10      # no Breakwalls contact before this (morning sweep excepted)
$RelaxGapMin       = 10  # minutes between RELAX visits
$PatrolGapMin      = 30  # minutes between PATROL visits
$InvoiceEveryNth   = 15  # busy: invoice pass rides every 15th glance
$DeepSweepTimes    = @("13:30", "18:30")   # earliest fire time each
$DeepSweepGraceMin = 45  # sweep may fire up to this many min after its slot

# ---- v3 state files ----
$LockFile           = "$ToolRoot\Master\v3-run.lock"
$LockMaxAgeMin      = 25          # a lock older than this is stale (crashed run)
$ModeStateFile      = "$ToolRoot\Master\v3-mode-state.txt"
$KnownDeltaFile     = "$ToolRoot\Master\v3-known-delta.txt"

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
$KeepDays        = 2
$GoLiveDate      = "2026-06-22"   # earliest date the invoice chase may look back to
$ChaseWindowDays = 3
$MaxRecoveryDays = 3              # Phase 3 catches up at most this many days back

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
    Mode                     = "?"
    PaginationMode           = "?"
    Errors                   = [System.Collections.Generic.List[string]]::new()
}

#endregion


#region LOGGING

if (-not (Test-Path $LogFolder)) { New-Item -ItemType Directory -Path $LogFolder | Out-Null }
$LogFile = "$LogFolder\import-v3-log-$(Get-Date -Format 'yyyy-MM-dd').txt"

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

# Clean v2/v3 logs older than 30 days
Get-ChildItem -Path $LogFolder -Filter "import-v*-log-*.txt" -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } |
    Remove-Item -Force -ErrorAction SilentlyContinue

#endregion


#region V3 MODE ENGINE  (new)

# --- single-instance lock -----------------------------------
function Enter-RunLock {
    if (Test-Path $LockFile) {
        $age = ((Get-Date) - (Get-Item $LockFile).LastWriteTime).TotalMinutes
        if ($age -lt $LockMaxAgeMin) { return $false }     # someone's working
        Write-Log "LOCK - stale lock ($([math]::Round($age,0)) min old), taking over" "Yellow"
    }
    "pid=$PID started=$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" | Set-Content $LockFile
    return $true
}
function Exit-RunLock { Remove-Item $LockFile -Force -ErrorAction SilentlyContinue }

# --- mode state (what ran when, persisted between fires) ----
function Read-ModeState {
    $s = @{ Date=""; MorningDone=$false; GlanceCount=0; LastVisit=$null
            Sweep1Done=$false; Sweep2Done=$false }
    if (-not (Test-Path $ModeStateFile)) { return $s }
    foreach ($l in (Get-Content $ModeStateFile -ErrorAction SilentlyContinue)) {
        if     ($l -match '^date\s*:\s*(.+)$')          { $s.Date = $Matches[1].Trim() }
        elseif ($l -match '^morning_done\s*:\s*(.+)$')  { $s.MorningDone = ($Matches[1].Trim() -eq 'true') }
        elseif ($l -match '^glance_count\s*:\s*(\d+)$') { $s.GlanceCount = [int]$Matches[1] }
        elseif ($l -match '^last_visit\s*:\s*(.+)$')    { try { $s.LastVisit = [datetime]::ParseExact($Matches[1].Trim(),'yyyy-MM-dd HH:mm:ss',$null) } catch {} }
        elseif ($l -match '^sweep1_done\s*:\s*(.+)$')   { $s.Sweep1Done = ($Matches[1].Trim() -eq 'true') }
        elseif ($l -match '^sweep2_done\s*:\s*(.+)$')   { $s.Sweep2Done = ($Matches[1].Trim() -eq 'true') }
    }
    return $s
}
function Save-ModeState {
    param($S)
    @(
        "date: $($S.Date)"
        "morning_done: $(if ($S.MorningDone) {'true'} else {'false'})"
        "glance_count: $($S.GlanceCount)"
        "last_visit: $(if ($S.LastVisit) { $S.LastVisit.ToString('yyyy-MM-dd HH:mm:ss') } else { '' })"
        "sweep1_done: $(if ($S.Sweep1Done) {'true'} else {'false'})"
        "sweep2_done: $(if ($S.Sweep2Done) {'true'} else {'false'})"
    ) | Set-Content $ModeStateFile
}

function Test-InWindow {
    param([datetime]$Now, $Win)
    $t = $Now.ToString('HH:mm')
    return ($t -ge $Win.Start -and $t -lt $Win.End)
}

# --- the decision: what should THIS fire do? ----------------
# Returns: sleep | morning | glance | glance+invoice | deepsweep
#          plus a reason string for the log.
function Get-RunDecision {
    param($State)
    $now = Get-Date

    # Manual override for testing
    if ($ForceMode -and $Mode) { return @{ Do = $Mode; Why = "forced" } }

    # New day -> reset day flags; morning sweep owed
    if ($State.Date -ne $Today) {
        $State.Date = $Today; $State.MorningDone = $false; $State.GlanceCount = 0
        $State.LastVisit = $null; $State.Sweep1Done = $false; $State.Sweep2Done = $false
    }

    # Morning sweep: first fire of the day at/after 06:00
    # (a PC left on overnight must not sweep at 00:01 - invoices
    #  finalize through the early morning; 06:00+ catches them)
    if (-not $State.MorningDone) {
        if ($now.Hour -ge 6) { return @{ Do = "morning"; Why = "first run of day" } }
        return @{ Do = "sleep"; Why = "morning sweep waits for 06:00" }
    }

    # Before opening: nothing else allowed
    if ($now.Hour -lt $DayStartHour) { return @{ Do = "sleep"; Why = "before $DayStartHour:00" } }

    # Deep sweeps: earliest slot passed + not yet done + within grace
    for ($i = 0; $i -lt $DeepSweepTimes.Count; $i++) {
        $slot = [datetime]::ParseExact("$Today $($DeepSweepTimes[$i])", 'yyyy-MM-dd HH:mm', $null)
        $done = if ($i -eq 0) { $State.Sweep1Done } else { $State.Sweep2Done }
        if (-not $done -and $now -ge $slot -and $now -le $slot.AddMinutes($DeepSweepGraceMin)) {
            return @{ Do = "deepsweep"; Why = "slot $($DeepSweepTimes[$i])"; SweepIndex = $i }
        }
    }

    # Busy windows: glance every fire; every Nth carries the invoice pass
    foreach ($w in $BusyWindows) {
        if (Test-InWindow $now $w) {
            if ((($State.GlanceCount + 1) % $InvoiceEveryNth) -eq 0) {
                return @{ Do = "glance+invoice"; Why = "busy, nth glance" }
            }
            return @{ Do = "glance"; Why = "busy" }
        }
    }

    # Relax windows: combined visit if enough minutes passed
    foreach ($w in $RelaxWindows) {
        if (Test-InWindow $now $w) {
            $gap = if ($State.LastVisit) { ($now - $State.LastVisit).TotalMinutes } else { 999 }
            if ($gap -ge $RelaxGapMin) { return @{ Do = "glance+invoice"; Why = "relax visit" } }
            return @{ Do = "sleep"; Why = "relax, next visit in $([math]::Round($RelaxGapMin - $gap,0)) min" }
        }
    }

    # Patrol: slow evening watch
    if (Test-InWindow $now $PatrolWindow) {
        $gap = if ($State.LastVisit) { ($now - $State.LastVisit).TotalMinutes } else { 999 }
        if ($gap -ge $PatrolGapMin) { return @{ Do = "glance"; Why = "patrol visit" } }
        return @{ Do = "sleep"; Why = "patrol, next visit in $([math]::Round($PatrolGapMin - $gap,0)) min" }
    }

    return @{ Do = "sleep"; Why = "outside all windows" }
}

# --- practice-mode write guard ------------------------------
# Every OrbitOMS write funnels through this. In -Practice it
# logs the intent and swallows the call.
function Test-WriteAllowed {
    param([string]$WouldDo)
    if ($Practice) {
        Write-Log "PRACTICE - WOULD $WouldDo" "Magenta"
        return $false
    }
    return $true
}

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
    param([int]$PageNum, [string]$Date, $Session, [hashtable]$Config, [array]$ExtraParams = @())

    $maxAttempts = 3
    for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {

        $paramList = [System.Collections.Generic.List[object]]::new()
        $paramList.Add([ordered]@{ field = "picklistdate"; value = $Date })
        $paramList.Add([ordered]@{ field = "transporter";  value = "Select Transporter" })
        foreach ($ep in $ExtraParams) { $paramList.Add($ep) }
        $paramList.Add([ordered]@{ field = "formName";     value = "" })

        $bodyJson = [ordered]@{
            reportId    = "Reports/105VCsI1rQ6u1QSEyGJ7I3Lc"
            componentId = "c01105VCsI1rQ6u1QSEyGJ7I3Lc"
            filters     = @()
            page        = $PageNum
            size        = 20
            sorters     = @()
            params      = @($paramList)
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

    # Verified real source (log DIAG 2026-08): numrowsInfo =
    # "Showing records between 1 and 20 of total 148 records"
    if ($PageResult.PSObject.Properties['numrowsInfo']) {
        $s = [string]$PageResult.numrowsInfo
        if ($s -match 'of\s+total\s+(\d+)\s+record') { return [int]$Matches[1] }
        if ($s -match '(\d+)\s*$')                   { return [int]$Matches[1] }
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

# GET ?action=pending-invoices — returns array of OBD numbers with invoiceNo IS NULL
# in the given date range.  Returns @() on error.
function Get-PendingInvoiceObds {
    param([string]$FromDate, [string]$ToDate)

    $body    = (@{ fromDate = $FromDate; toDate = $ToDate } | ConvertTo-Json -Depth 3 -Compress)
    $headers = Get-V2ApiHeaders

    try {
        $resp = Invoke-WebRequest `
            -Uri $ApiUrlPendingInvoices `
            -Method POST `
            -Body $body `
            -ContentType "application/json" `
            -Headers $headers `
            -UseBasicParsing `
            -TimeoutSec 30 `
            -ErrorAction Stop

        $parsed = $resp.Content | ConvertFrom-Json
        $obds   = if ($parsed.obdNumbers) { @($parsed.obdNumbers) } else { @() }
        Write-Log "PENDING-INV - $($obds.Count) pending in $FromDate..$ToDate"
        return $obds
    } catch {
        Write-Log "PENDING-INV - fetch failed: $_, returning empty" "Yellow"
        return @()
    }
}

# Fetch a single OBD's header row from /data using the sonum filter.
# Returns a Build-HeaderRow PSCustomObject, or $null if not found / error.
# Uses script-level $Session, $BaseUrl, $DataPath, $Today.
# (v3: Get-ObdHeaderBySonum retired - replaced by the Pending Dispatch filtered ask)

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

# Full recovery pass for one date: page listing, pre-check, create new OBDs (DryRun-gated),
# patch existing OBDs from the same header rows (no FormGetData for existing).
# Returns $true on success; $false if page-1 fetch or create upload failed.
function Invoke-RecoveryDayPass {
    param([string]$Date)

    Write-Log "RECOVERY $Date - paging Breakwalls listing" "Cyan"

    $rPage1 = Get-OBDListPage -PageNum 1 -Date $Date -Session $Session -Config $config
    if (-not ($rPage1 -and $rPage1.data)) {
        Write-Log "RECOVERY $Date - Page 1 fetch failed, will retry next cycle" "Yellow"
        return $false
    }

    $keyList = ($rPage1.PSObject.Properties.Name -join ', ')
    Write-Log "DIAG - RECOVERY $Date page 1 keys: $keyList"

    $rLastPage      = [int]$rPage1.last_page
    $rAllObds       = [System.Collections.Generic.List[string]]::new()
    $rHeaderRowsMap = @{}

    foreach ($row in $rPage1.data) {
        $obdNum = if ($row.PickListId) { $row.PickListId.ToString().Trim() } else { $null }
        if ($obdNum) {
            $rAllObds.Add($obdNum)
            $rHeaderRowsMap[$obdNum] = Build-HeaderRow $row
        }
    }

    if ($rLastPage -gt 1) {
        $pageOrder = 2..$rLastPage | Get-Random -Count ($rLastPage - 1)
        foreach ($p in $pageOrder) {
            Get-RandomDelay -Min 1 -Max 3
            $pr = Get-OBDListPage -PageNum $p -Date $Date -Session $Session -Config $config
            if ($pr -and $pr.data) {
                foreach ($row in $pr.data) {
                    $obdNum = if ($row.PickListId) { $row.PickListId.ToString().Trim() } else { $null }
                    if ($obdNum -and -not $rAllObds.Contains($obdNum)) {
                        $rAllObds.Add($obdNum)
                        $rHeaderRowsMap[$obdNum] = Build-HeaderRow $row
                    }
                }
                Write-Log "RECOVERY $Date - Page $p/$rLastPage : $($pr.data.Count) OBDs"
            } else {
                Write-Log "RECOVERY $Date - Page $p failed all retries" "Yellow"
            }
        }
        Get-RandomDelay -Min 1 -Max 3
        $rRefetch = Get-OBDListPage -PageNum 1 -Date $Date -Session $Session -Config $config
        if ($rRefetch -and $rRefetch.data) {
            foreach ($row in $rRefetch.data) {
                $obdNum = if ($row.PickListId) { $row.PickListId.ToString().Trim() } else { $null }
                if ($obdNum -and -not $rAllObds.Contains($obdNum)) {
                    $rAllObds.Add($obdNum)
                    $rHeaderRowsMap[$obdNum] = Build-HeaderRow $row
                    Write-Log "RECOVERY $Date - New OBD on page 1 refetch: $obdNum"
                }
            }
        }
    }

    $rAllObdsArr = @($rAllObds | Select-Object -Unique)
    Write-Log "RECOVERY $Date - Breakwalls total: $($rAllObdsArr.Count)"

    Get-RandomDelay -Min 1 -Max 3
    $rExistingSet = Invoke-PreCheck -obdNumbers $rAllObdsArr -Session $Session
    if ($null -eq $rExistingSet) {
        $rNewObds = $rAllObdsArr
        Write-Log "RECOVERY $Date - Pre-check failed, treating all as new" "Yellow"
    } else {
        $rNewObds = @($rAllObdsArr | Where-Object { -not $rExistingSet.Contains($_) })
    }
    Write-Log "RECOVERY $Date - $($rNewObds.Count) new OBDs to create"

    # ---- CREATE new OBDs ----
    $rHdrOut   = [System.Collections.Generic.List[PSCustomObject]]::new()
    $rLinesOut = [System.Collections.Generic.List[PSCustomObject]]::new()
    $rFetched  = 0
    $rFailed   = [System.Collections.Generic.List[string]]::new()

    foreach ($obd in $rNewObds) {
        $hdr = $rHeaderRowsMap[$obd]
        $smu = if ($hdr -and $hdr.SMU) { $hdr.SMU.ToString() } else { "" }

        # Volume-zero rule: detail form will never fill; import header-only.
        $vol = 0; if ($hdr -and $hdr.Volume) { try { $vol = [decimal]$hdr.Volume } catch { $vol = 0 } }
        if ($hdr -and $vol -eq 0) {
            $rHdrOut.Add($hdr)
            $rFetched++
            Write-Log "RECOVERY $Date - $obd header-only (volume 0, manual SAP completes it later)" "Yellow"
            continue
        }

        Get-RandomDelay -Min 1 -Max 3
        $lines = Get-ObdJsonData -ObdNumber $obd -Session $Session -Config $config
        # A zero-line response is a FAILURE, not a success. @() is not $null, so
        # the old `$null -ne $lines` posted a header carrying no lines at all.
        # 5.1-safe count: a single non-collection object has no .Count of its own
        # (returns $null), and @($null).Count is 1 - so BOTH tests are required.
        if (($null -ne $lines) -and (@($lines).Count -gt 0)) {
            $rHdrOut.Add($hdr)
            foreach ($ln in $lines) { $rLinesOut.Add((Build-LineRow -obd $obd -line $ln -hdrSmu $smu)) }
            $rFetched++
        } else {
            $rFailed.Add($obd)
            if ($null -eq $lines) {
                Write-Log "RECOVERY $Date - FormGetData failed for $obd" "Yellow"
            } else {
                Write-Log "RECOVERY $Date - EMPTY for $obd - 0 lines returned, treating as failure" "Yellow"
            }
        }
    }

    $createSuccess = $true
    if ($rHdrOut.Count -gt 0) {
        $rPayload = @{ headerRows = @($rHdrOut); lineRows = @($rLinesOut) }
        Get-RandomDelay -Min 1 -Max 3
        if ($DryRun) {
            Write-Log "[DRY RUN] RECOVERY $Date - would create $($rHdrOut.Count) OBDs, skipped" "Cyan"
        } else {
            $rUp = Send-JsonPayloadToOrbitOMS -Payload $rPayload
            if (-not $rUp.Success) {
                Add-PendingJsonUpload -Payload $rPayload -Date $Date
                Write-Log "RECOVERY $Date - Create upload failed, parked in pending-upload-json.txt" "Yellow"
                $createSuccess = $false
            }
        }
    }

    # ---- PATCH existing OBDs (header rows already paged — no FormGetData) ----
    $patchCount = 0
    if ($null -ne $rExistingSet -and $rExistingSet.Count -gt 0) {
        $existingObdsForDay = @($rAllObdsArr | Where-Object { $rExistingSet.Contains($_) })
        $patchRows = @($existingObdsForDay | ForEach-Object { Build-PatchHeaderRow $rHeaderRowsMap[$_] })
        if ($patchRows.Count -gt 0) {
            Get-RandomDelay -Min 1 -Max 2
            Send-PatchHeadersToOrbitOMS -PatchHeaders $patchRows -IsDryRun ([bool]$DryRun) | Out-Null
            $patchCount = $patchRows.Count
        }
    }

    Write-Log "RECOVERY $Date - created=$rFetched patched=$patchCount"

    # Accumulate into script-level summary counters
    $script:Summary.YesterdayBreakwallsTotal += $rAllObdsArr.Count
    $script:Summary.YesterdayPreCheckNew     += $rNewObds.Count
    $script:Summary.YesterdayFetched         += $rFetched
    $script:Summary.YesterdayFailed          += $rFailed.Count

    return $createSuccess
}

#  ---- v3 core functions ------------------------------------

# Ask OrbitOMS: how many orders for this date + which OBD numbers.
# Returns @{ Count = int; Set = HashSet[string] } or $null on failure.
function Get-DayObds {
    param([string]$Date)
    $body    = @{ fromDate = $Date; toDate = $Date } | ConvertTo-Json -Compress
    $headers = Get-V2ApiHeaders
    try {
        $resp = Invoke-WebRequest `
            -Uri $ApiUrlDayObds `
            -Method POST `
            -Body $body `
            -ContentType "application/json" `
            -Headers $headers `
            -UseBasicParsing `
            -TimeoutSec 60 `
            -ErrorAction Stop
        $parsed = $resp.Content | ConvertFrom-Json
        if ($null -eq $parsed.count) { return $null }
        $set = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
        foreach ($o in @($parsed.obdNumbers)) { if ($o) { [void]$set.Add($o.ToString().Trim()) } }
        return @{ Count = [int]$parsed.count; Set = $set }
    } catch {
        Write-Log "DAY-OBDS - fetch failed: $_" "Yellow"
        return $null
    }
}

# Waiting throttle: OBDs whose lines aren't ready yet (Volume>0 but
# empty detail). Re-try FormGetData at most every 5 minutes, not
# every glance.
$WaitingObdsFile = "$ToolRoot\Master\v3-waiting-obds.txt"
function Test-WaitingThrottle {
    param([string]$Obd)
    if (-not (Test-Path $WaitingObdsFile)) { return $true }
    foreach ($l in (Get-Content $WaitingObdsFile -ErrorAction SilentlyContinue)) {
        $p = $l -split '\|', 2
        if ($p.Count -eq 2 -and $p[0] -eq $Obd) {
            try {
                $last = [datetime]::ParseExact($p[1], 'yyyy-MM-dd HH:mm:ss', $null)
                return (((Get-Date) - $last).TotalMinutes -ge 5)
            } catch { return $true }
        }
    }
    return $true
}
function Set-WaitingStamp {
    param([string]$Obd)
    $rows = @()
    if (Test-Path $WaitingObdsFile) {
        $rows = @(Get-Content $WaitingObdsFile -ErrorAction SilentlyContinue |
                  Where-Object { $_ -and -not $_.StartsWith("$Obd|") })
    }
    $rows += "$Obd|$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
    $rows | Set-Content $WaitingObdsFile
}

# Known-delta guard: a count mismatch we already walked every page
# for and could not resolve (e.g. soft-removed order counted by
# Breakwalls). Remember the signature; only re-walk when it changes.
function Get-KnownDelta {
    if (-not (Test-Path $KnownDeltaFile)) { return "" }
    return (Get-Content $KnownDeltaFile -First 1 -ErrorAction SilentlyContinue)
}
function Set-KnownDelta { param([string]$Sig) $Sig | Set-Content $KnownDeltaFile }

#  ---- THE GLANCE --------------------------------------------
#  One page-1 fetch. Compare totals. Locate + import anything
#  missing. Returns a result hashtable for the summary.
function Invoke-Glance {
    $res = @{ BwTotal = -1; OmsCount = -1; NewImported = 0; HeaderOnly = 0
              Waiting = 0; Failed = 0; Outcome = "?" }

    $p1 = Get-OBDListPage -PageNum 1 -Date $Today -Session $Session -Config $config
    if (-not ($p1 -and $null -ne $p1.data)) {
        Write-Log "GLANCE - page 1 unreachable, next fire retries" "Yellow"
        $res.Outcome = "page1-fail"; return $res
    }

    $bwTotal = Get-TotalCount -PageResult $p1
    if ($bwTotal -lt 0) { $bwTotal = @($p1.data).Count }   # worst case: page 1 size
    $res.BwTotal = $bwTotal

    $oms = Get-DayObds -Date $Today
    if ($null -eq $oms) {
        # Fallback: pre-check just page 1's OBDs (limited but functional)
        $p1Obds = @($p1.data | ForEach-Object { if ($_.PickListId) { $_.PickListId.ToString().Trim() } } | Where-Object { $_ })
        $ex = Invoke-PreCheck -obdNumbers $p1Obds -Session $Session
        if ($null -eq $ex) { Write-Log "GLANCE - day-obds AND pre-check failed, skipping" "Yellow"; $res.Outcome = "oms-fail"; return $res }
        $oms = @{ Count = -1; Set = $ex }
        Write-Log "GLANCE - day-obds unavailable, page-1 fallback in use" "Yellow"
    }
    $res.OmsCount = $oms.Count

    # Collect candidate missing rows from page 1
    $missingRows = @{}
    foreach ($row in $p1.data) {
        $obd = if ($row.PickListId) { $row.PickListId.ToString().Trim() } else { $null }
        if ($obd -and -not $oms.Set.Contains($obd)) { $missingRows[$obd] = $row }
    }

    $delta = if ($oms.Count -ge 0) { $bwTotal - $oms.Count } else { $missingRows.Count }

    if ($delta -le 0 -and $missingRows.Count -eq 0) {
        Write-Log "GLANCE - match (bw=$bwTotal oms=$($oms.Count))"
        Save-Tally -Date $Today -TotalCount $bwTotal -Page1Obds @($p1.data | ForEach-Object { $_.PickListId }) -Status "ok"
        if ($oms.Count -gt $bwTotal) { Write-Log "GLANCE - note: OMS holds $($oms.Count - $bwTotal) more than Breakwalls (removed on BW?)" "Yellow" }
        $res.Outcome = "match"; return $res
    }

    Write-Log "GLANCE - bw=$bwTotal oms=$($oms.Count) -> $delta missing" "Cyan"

    # Deeper pages only if page 1 didn't surface every missing OBD
    if ($oms.Count -ge 0 -and $missingRows.Count -lt $delta) {
        $lastPage = 1; try { $lastPage = [int]$p1.last_page } catch {}
        $sig = "$bwTotal|$($oms.Count)"
        if ($lastPage -gt 1) {
            if ((Get-KnownDelta) -eq $sig) {
                Write-Log "GLANCE - known unresolved delta ($sig), skipping page walk"
            } else {
                for ($p = 2; $p -le $lastPage; $p++) {
                    Get-RandomDelay -Min 1 -Max 2
                    $pr = Get-OBDListPage -PageNum $p -Date $Today -Session $Session -Config $config
                    if ($pr -and $pr.data) {
                        foreach ($row in $pr.data) {
                            $obd = if ($row.PickListId) { $row.PickListId.ToString().Trim() } else { $null }
                            if ($obd -and -not $oms.Set.Contains($obd) -and -not $missingRows.ContainsKey($obd)) {
                                $missingRows[$obd] = $row
                            }
                        }
                    }
                    if ($missingRows.Count -ge $delta) { break }
                }
                if ($missingRows.Count -lt $delta) {
                    Set-KnownDelta $sig
                    Write-Log "GLANCE - walked all $lastPage pages, $($delta - $missingRows.Count) unlocatable (soft-removed?) - marked known delta" "Yellow"
                } else {
                    Set-KnownDelta ""
                }
            }
        }
    }

    if ($missingRows.Count -eq 0) { $res.Outcome = "known-delta"; return $res }

    # Import the located missing OBDs
    $hdrOut   = [System.Collections.Generic.List[PSCustomObject]]::new()
    $linesOut = [System.Collections.Generic.List[PSCustomObject]]::new()

    foreach ($obd in @($missingRows.Keys)) {
        $row = $missingRows[$obd]
        $hdr = Build-HeaderRow $row
        $smu = if ($hdr.SMU) { $hdr.SMU.ToString() } else { "" }

        $vol = 0; if ($hdr.Volume) { try { $vol = [decimal]$hdr.Volume } catch { $vol = 0 } }
        if ($vol -eq 0) {
            $hdrOut.Add($hdr); $res.HeaderOnly++
            Write-Log "IMPORT $obd - header-only (volume 0, manual SAP completes it later)" "Yellow"
            continue
        }

        if (-not (Test-WaitingThrottle -Obd $obd)) {
            $res.Waiting++
            continue   # tried <5 min ago; don't hammer the empty form
        }

        Get-RandomDelay -Min 1 -Max 2
        $lines = Get-ObdJsonData -ObdNumber $obd -Session $Session -Config $config
        # A zero-line response is a FAILURE, not a success. @() is not $null, so
        # the old `$null -ne $lines` posted a header carrying no lines at all.
        # 5.1-safe count: a single non-collection object has no .Count of its own
        # (returns $null), and @($null).Count is 1 - so BOTH tests are required.
        if (($null -ne $lines) -and (@($lines).Count -gt 0)) {
            $hdrOut.Add($hdr)
            foreach ($ln in $lines) { $linesOut.Add((Build-LineRow -obd $obd -line $ln -hdrSmu $smu)) }
            Write-Log "IMPORT $obd - OK ($(@($lines).Count) lines)" "Green"
        } else {
            Set-WaitingStamp -Obd $obd
            $res.Waiting++
            if ($null -eq $lines) {
                Write-Log "WAIT $obd - FormGetData failed, will retry" "Yellow"
            } else {
                Write-Log "WAIT $obd - EMPTY: 0 lines returned, not importing; will retry" "Yellow"
            }
        }
    }

    if ($hdrOut.Count -gt 0) {
        $payload = @{ headerRows = @($hdrOut); lineRows = @($linesOut) }
        if ($DryRun) {
            $dryRunFolder = "$OutputFolder\dryrun"
            if (-not (Test-Path $dryRunFolder)) { New-Item -ItemType Directory -Path $dryRunFolder | Out-Null }
            $df = "$dryRunFolder\glance-$Today-$(Get-Date -Format 'HHmmss').json"
            $payload | ConvertTo-Json -Depth 5 | Set-Content $df -Encoding UTF8
            Write-Log "PRACTICE - WOULD import $($hdrOut.Count) OBDs ($($linesOut.Count) lines); payload -> $df" "Magenta"
            $res.NewImported = $hdrOut.Count
        } else {
            Get-RandomDelay -Min 1 -Max 2
            $up = Send-JsonPayloadToOrbitOMS -Payload $payload
            if ($up.Success) {
                $res.NewImported = $up.Imported
                Write-Log "GLANCE - imported $($up.Imported) (skipped=$($up.Skipped) errors=$($up.Errors))" "Green"
            } else {
                Add-PendingJsonUpload -Payload $payload -Date $Today
                $res.Failed = $hdrOut.Count
                Write-Log "GLANCE - upload failed, parked for retry" "Red"
            }
        }
    }

    $res.Outcome = "imported"
    return $res
}

#  ---- THE INVOICE PASS --------------------------------------
#  1. Ask OrbitOMS (free): which of $Date's orders lack invoices?
#  2. Nothing blank -> zero Breakwalls visits, done.
#  3. Else ONE filtered ask (pendingstatus = Pending Dispatch):
#     rows carry InvoiceNo -> patch the intersection.
function Invoke-InvoicePass {
    param([string]$Date)

    $blanks = @(Get-PendingInvoiceObds -FromDate $Date -ToDate $Date)
    if ($blanks.Count -eq 0) {
        Write-Log "INVPASS $Date - no blanks in OrbitOMS, nothing to do"
        return 0
    }
    $blankSet = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($b in $blanks) { [void]$blankSet.Add($b.ToString().Trim()) }

    $filter = @([ordered]@{ field = "pendingstatus"; value = "Pending Dispatch" })
    $collected = @()
    $pageNum = 1; $lastPage = 1
    do {
        $pr = Get-OBDListPage -PageNum $pageNum -Date $Date -Session $Session -Config $config -ExtraParams $filter
        if (-not ($pr -and $null -ne $pr.data)) { break }
        try { $lastPage = [int]$pr.last_page } catch { $lastPage = 1 }
        foreach ($row in $pr.data) {
            $obd = if ($row.PickListId) { $row.PickListId.ToString().Trim() } else { $null }
            if ($obd -and $blankSet.Contains($obd) -and $row.InvoiceNo -and $row.InvoiceNo.ToString().Trim() -ne "") {
                $collected += Build-PatchHeaderRow (Build-HeaderRow $row)
            }
        }
        $pageNum++
        if ($pageNum -le $lastPage) { Get-RandomDelay -Min 1 -Max 2 }
    } while ($pageNum -le $lastPage)

    if ($collected.Count -gt 0) {
        if ($Practice) { Write-Log "PRACTICE - WOULD patch $($collected.Count) invoices for $Date" "Magenta" }
        Send-PatchHeadersToOrbitOMS -PatchHeaders $collected -IsDryRun ([bool]$DryRun) | Out-Null
    }
    Write-Log "INVPASS $Date - oms blanks=$($blanks.Count) bw ready=$($collected.Count) patched=$($collected.Count)"
    return $collected.Count
}

#endregion NEW FUNCTIONS


#region MAIN PIPELINE  (v3 mode-dispatched)

# ============================================================
#  MODE DECISION  (before any logging or network)
# ============================================================

$ModeState = Read-ModeState
$decision  = Get-RunDecision -State $ModeState

if ($decision.Do -eq "sleep") { exit 0 }                 # silent - no log spam
if (-not (Enter-RunLock))     { exit 0 }                 # someone else is working

# Practice implies dry-run everywhere (server-side dryRun for patches,
# payload-to-disk for imports) plus magenta WOULD lines.
if ($Practice) { $DryRun = $true }

try {

Write-Log ""
Write-Section "RUN STARTED  $Today  [v3 $($decision.Do) - $($decision.Why)]" "Cyan"
if ($Practice) { Write-Log "PRACTICE MODE - real reads, no OrbitOMS writes" "Magenta" }
$Summary.Mode = $decision.Do

# Jitter: never knock exactly on the minute tick
Start-Sleep -Seconds (Get-Random -Minimum 2 -Maximum 21)

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
#  MODE DISPATCH
# ============================================================

$glanceRes = $null

switch -Wildcard ($decision.Do) {

    "morning" {
        # -- yesterday catch-up: recovery (missed orders) --
# ============================================================
#  PHASE 3 - RECOVERY PASS (multi-day, bounded)
# ============================================================

if ($SkipYesterday) {
    Write-Log "[flag] SkipYesterday - yesterday recovery skipped; today only."
} elseif ($TargetDate -ne "") {
    Write-Log "[flag] TargetDate=$TargetDate - yesterday recovery skipped (v3: TargetDate only affects recovery skip)."
} else {

$yState = Read-YesterdayState
if ($yState -and $yState.Status -eq "pending") {

    # Compute bounded recovery range: clamp start to MaxRecoveryDays back and GoLiveDate floor
    $recStart        = $yState.Date
    $recStartWindow  = (Get-Date).AddDays(-$MaxRecoveryDays).ToString("yyyy-MM-dd")
    if ($recStartWindow -gt $recStart) { $recStart = $recStartWindow }
    if ($GoLiveDate     -gt $recStart) { $recStart = $GoLiveDate     }
    $recEnd = $Yesterday

    if ($recStart -gt $recEnd) {
        Write-Log "PHASE 3 - Recovery range empty ($recStart > $recEnd), marking done" "Cyan"
        Write-YesterdayState -Status "done" -Date $yState.Date -Attempts ($yState.Attempts + 1)
    } else {
        Write-Log "PHASE 3 - Recovery $recStart..$recEnd (attempt $($yState.Attempts + 1))" "Cyan"
        # Pre-increment attempts so a mid-run crash leaves the state incremented
        Write-YesterdayState -Status "pending" -Date $yState.Date -Attempts ($yState.Attempts + 1)
        $Summary.YesterdayRan = $true

        Invoke-SpecPrime -Session $Session -Reason "yesterday-recovery" | Out-Null

        $allRangeSuccess = $true
        $curDate = [datetime]::ParseExact($recStart, "yyyy-MM-dd", $null)
        $endDate = [datetime]::ParseExact($recEnd,   "yyyy-MM-dd", $null)

        while ($curDate -le $endDate) {
            $dateStr = $curDate.ToString("yyyy-MM-dd")
            Get-RandomDelay -Min 2 -Max 5
            $dayOk = Invoke-RecoveryDayPass -Date $dateStr
            if (-not $dayOk) { $allRangeSuccess = $false }
            $curDate = $curDate.AddDays(1)
        }

        if ($allRangeSuccess) {
            if (-not $DryRun) {
                Write-YesterdayState -Status "done" -Date $yState.Date -Attempts ($yState.Attempts + 1)
                Write-Log "PHASE 3 - Recovery complete for $recStart..$recEnd" "Green"
                $Summary.YesterdayUpload = "done"
            } else {
                Write-Log "PHASE 3 - [DRY RUN] $recStart..$recEnd complete, state not consumed" "Cyan"
                $Summary.YesterdayUpload = "DRY RUN (not posted)"
            }
        } else {
            Write-YesterdayState -Status "pending" -Date $yState.Date -Attempts ($yState.Attempts + 1)
            Write-Log "PHASE 3 - Recovery incomplete, will retry next cycle" "Yellow"
            $Summary.YesterdayUpload = "partial/pending"
        }

        Get-RandomDelay -Min 3 -Max 7
    }
}

}   # end -not SkipYesterday



        # -- yesterday invoice chase: filtered ask per chase date --
        $chaseTo   = (Get-Date).AddDays(-1).ToString("yyyy-MM-dd")
        $chaseFromRaw = (Get-Date).AddDays(-$ChaseWindowDays).ToString("yyyy-MM-dd")
        $chaseFrom = if ($chaseFromRaw -gt $GoLiveDate) { $chaseFromRaw } else { $GoLiveDate }
        if ($chaseFrom -le $chaseTo) {
            $cd = [datetime]::ParseExact($chaseFrom, "yyyy-MM-dd", $null)
            $ce = [datetime]::ParseExact($chaseTo,   "yyyy-MM-dd", $null)
            while ($cd -le $ce) {
                Invoke-SpecPrime -Session $Session -Reason "morning-chase" | Out-Null
                Invoke-InvoicePass -Date $cd.ToString("yyyy-MM-dd") | Out-Null
                $cd = $cd.AddDays(1)
            }
        } else {
            Write-Log "MORNING - chase window empty ($chaseFrom..$chaseTo)"
        }

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



        $ModeState.MorningDone = $true
        Write-Log "MORNING - sweep done; quiet until $($DayStartHour):00" "Cyan"
    }

    "deepsweep" {
        Invoke-SpecPrime -Session $Session -Reason "deep-sweep" | Out-Null
        Write-Log "DEEPSWEEP - full reconcile of $Today" "Cyan"
        Invoke-RecoveryDayPass -Date $Today | Out-Null
        Invoke-InvoicePass -Date $Today | Out-Null
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


        if ($decision.SweepIndex -eq 0) { $ModeState.Sweep1Done = $true } else { $ModeState.Sweep2Done = $true }
    }

    "glance*" {
        Invoke-SpecPrime -Session $Session -Reason "glance" | Out-Null
        $glanceRes = Invoke-Glance
        $ModeState.GlanceCount++

        if ($decision.Do -eq "glance+invoice") {
            Invoke-InvoicePass -Date $Today | Out-Null
            # pending upload retry rides the slower beat too
            if (Test-Path $PendingJsonFile) {
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


            }
        }
    }
}

$ModeState.LastVisit = Get-Date
Save-ModeState -S $ModeState

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
#  RUN SUMMARY  (compact, mode-aware)
# ============================================================

$cycleEnd  = Get-Date
$cycleSecs = [Math]::Round(($cycleEnd - $Summary.CycleStart).TotalSeconds, 1)

$sumColor = "Green"
if ($Summary.Errors.Count -gt 0 -or ($glanceRes -and $glanceRes.Failed -gt 0)) { $sumColor = "Red" }

Write-Section "CYCLE SUMMARY  $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" $sumColor

$modeStr = $decision.Do
if ($glanceRes) {
    $bw  = if ($glanceRes.BwTotal  -ge 0) { $glanceRes.BwTotal }  else { "?" }
    $om  = if ($glanceRes.OmsCount -ge 0) { $glanceRes.OmsCount } else { "?" }
    Add-Content -Path $LogFile -Value "----- CYCLE SUMMARY -----"
    Add-Content -Path $LogFile -Value "Mode: $modeStr | Date: $Today | BW: $bw | OMS: $om | New: $($glanceRes.NewImported) | HeaderOnly: $($glanceRes.HeaderOnly) | Waiting: $($glanceRes.Waiting) | Failed: $($glanceRes.Failed) | Cycle: ${cycleSecs}s"
} else {
    Add-Content -Path $LogFile -Value "----- CYCLE SUMMARY -----"
    Add-Content -Path $LogFile -Value "Mode: $modeStr | Date: $Today | Yesterday: total=$($Summary.YesterdayBreakwallsTotal) new=$($Summary.YesterdayPreCheckNew) fetched=$($Summary.YesterdayFetched) failed=$($Summary.YesterdayFailed) | Cycle: ${cycleSecs}s"
}

Write-Section "RUN COMPLETE" $sumColor

} finally {
    Exit-RunLock
}

#endregion MAIN PIPELINE
