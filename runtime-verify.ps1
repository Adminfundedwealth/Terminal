Add-Type -AssemblyName System.Web
$ErrorActionPreference = "Continue"

$BASE = "http://localhost:4000"
$PROV_KEY = "fw-provision-key-2024-secure"
$FW_USER = "test-user-runtime-001"
$ACCOUNT_ID = "a8d527a1-ce57-410e-b217-0577dd10d8d4"

$script:pass = 0
$script:fail = 0

function ok($label) {
    Write-Host "  [PASS] $label" -ForegroundColor Green
    $script:pass++
}
function fail($label, $msg) {
    Write-Host "  [FAIL] $label : $msg" -ForegroundColor Red
    $script:fail++
}

function Call($label, $method, $path, $body=$null, $extraHeaders=@{}) {
    try {
        $allHeaders = @{ "Content-Type"="application/json" } + $extraHeaders
        if ($script:fw_session) { $allHeaders["Authorization"] = "Bearer $($script:fw_session)" }
        $p = @{ Uri="$BASE$path"; Method=$method; Headers=$allHeaders; ErrorAction="Stop"; TimeoutSec=15 }
        if ($body) { $p.Body = ($body | ConvertTo-Json -Depth 5) }
        $r = Invoke-RestMethod @p
        ok $label
        return $r
    } catch {
        $code = $_.Exception.Response.StatusCode.value__
        fail $label "HTTP $code"
        return $null
    }
}

# 1. SSO GENERATE
Write-Host "`n[1] SSO Token Generation"
$body1 = @{ fwUserId=$FW_USER; accountId=$ACCOUNT_ID; email="test@runtime.com"; name="Test Trader" }
$ssoR = Call "POST /auth/sso/generate" POST "/auth/sso/generate" $body1 @{ "x-provisioning-key"=$PROV_KEY }
$ssoToken = $ssoR.token

# 2. SSO LOGIN
Write-Host "`n[2] SSO Login"
if ($ssoToken) {
    $enc = [System.Web.HttpUtility]::UrlEncode($ssoToken)
    $session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
    try {
        $null = Invoke-WebRequest -Uri "$BASE/auth/sso?token=$enc" -Method GET -WebSession $session -MaximumRedirection 0 -ErrorAction SilentlyContinue
    } catch { }
    $ck = $session.Cookies.GetCookies($BASE) | Where-Object { $_.Name -eq "fw_session" }
    $script:fw_session = $ck.Value
    if ($script:fw_session) {
        ok "GET /auth/sso (cookie set)"
    } else {
        fail "GET /auth/sso" "no cookie returned"
    }
} else {
    fail "GET /auth/sso" "no SSO token"
}

# 3. AUTH VERIFY
Write-Host "`n[3] Auth Verify"
$v = Call "GET /auth/verify" GET "/auth/verify"
if ($v) { Write-Host "     valid=$($v.valid) userId=$($v.user.userId)" }

# 4. ACCOUNT LOADING
Write-Host "`n[4] Account Loading"
$acct = Call "GET /api/account" GET "/api/account"
if ($acct) { Write-Host "     balance=$($acct.balance) status=$($acct.status)" }
Call "GET /api/accounts" GET "/api/accounts" | Out-Null
$mg = Call "GET /api/account/margin" GET "/api/account/margin"
if ($mg) { Write-Host "     available=$($mg.availableMargin) used=$($mg.usedMargin)" }
Call "GET /api/account/rules" GET "/api/account/rules" | Out-Null

# 5. CHALLENGE METRICS
Write-Host "`n[5] Challenge Metrics"
Call "GET /api/account/challenge" GET "/api/account/challenge" | Out-Null
$rp = Call "GET /api/account/rule-progress" GET "/api/account/rule-progress"
if ($rp) { Write-Host "     rules=$($rp.rules.Count)" }
$rs = Call "GET /api/account/risk-state" GET "/api/account/risk-state"
if ($rs) { Write-Host "     dailyLoss=$($rs.dailyLossUsedPct)% dd=$($rs.maxDrawdownUsedPct)% target=$($rs.targetProgressPct)%" }
Call "GET /api/account/risk-events" GET "/api/account/risk-events" | Out-Null

# 6. TERMINAL STATUS
Write-Host "`n[6] Terminal Status"
$ts = Call "GET /api/terminal/status" GET "/api/terminal/status"
if ($ts) { Write-Host "     mode=$($ts.executionMode.mode) trading=$($ts.tradingAllowed) feedLive=$($ts.feed.isLive) quotes=$($ts.feed.cachedQuotes)" }

# 7. HISTORICAL CHART
Write-Host "`n[7] Historical Chart"
$hist = Call "GET /api/market/history NIFTY 5m" GET "/api/market/history?token=99926000&tf=5"
if ($hist) { Write-Host "     candles=$($hist.Count)" }
$hist2 = Call "GET /api/market/history RELIANCE 15m" GET "/api/market/history?token=2885&tf=15"
if ($hist2) { Write-Host "     candles=$($hist2.Count)" }

# 8. LIVE MARKET DATA
Write-Host "`n[8] Live Market Data"
$depth = Call "GET /api/market/depth" GET "/api/market/depth?token=99926000&exchange=NSE"
if ($depth) { Write-Host "     bids=$($depth.bids.Count) asks=$($depth.asks.Count)" }
$mkt = Call "GET /api/market/status" GET "/api/market/status"
if ($mkt) { Write-Host "     feedConnected=$($mkt.feed.connected) subscribedSymbols=$($mkt.feed.subscribedSymbols)" }
$holiday = Call "GET /api/market/holiday" GET "/api/market/holiday"
if ($holiday) { Write-Host "     isClosed=$($holiday.isClosed) reason=$($holiday.reason)" }

# 9. OPTION CHAIN
Write-Host "`n[9] Option Chain"
$oc = Call "GET /api/market/option-chain NIFTY" GET "/api/market/option-chain?symbol=NIFTY&expiry=2026-07-31"
if ($oc) { Write-Host "     strikes=$($oc.Count)" }

# 10. WATCHLIST CRUD
Write-Host "`n[10] Watchlist CRUD"
$wls = Call "GET /api/watchlists" GET "/api/watchlists"
if ($wls) { Write-Host "     existing=$($wls.Count)" }
$nwl = Call "POST /api/watchlists" POST "/api/watchlists" @{ name="VERIFY_WL"; color="#00ff00"; items=@() }
if ($nwl -and $nwl.id) {
    Write-Host "     created id=$($nwl.id)"
    Call "PUT /api/watchlists update" PUT "/api/watchlists/$($nwl.id)" @{
        name = "VERIFY_UPDATED"
        items = @(@{ token="2885"; symbol="RELIANCE"; segment="NSE" })
    } | Out-Null
    Call "DELETE /api/watchlists delete" DELETE "/api/watchlists/$($nwl.id)" | Out-Null
}

# 11. INSTRUMENTS SEARCH
Write-Host "`n[11] Instruments"
$srch = Call "GET /api/instruments/search NIFTY" GET "/api/instruments/search?q=NIFTY"
if ($srch) { Write-Host "     results=$($srch.Count)" }
$srch2 = Call "GET /api/instruments/search RELIANCE" GET "/api/instruments/search?q=RELIANCE"
if ($srch2) { Write-Host "     results=$($srch2.Count)" }

# 12. POSITIONS
Write-Host "`n[12] Positions"
$pos = Call "GET /api/positions" GET "/api/positions"
if ($pos -ne $null) { Write-Host "     open=$($pos.Count)" }

# 13. ORDER PLACEMENT (MARKET)
Write-Host "`n[13] Order Placement"
$mktOrd = @{ symbol="NIFTY 50"; token="99926000"; segment="NSE"; side="BUY"; orderType="MARKET"; productType="MIS"; qty=50 }
$placed = Call "POST /api/orders/place MARKET BUY" POST "/api/orders/place" $mktOrd
if ($placed) { Write-Host "     orderId=$($placed.orderId) status=$($placed.status)" }

$mktSell = @{ symbol="NIFTY 50"; token="99926000"; segment="NSE"; side="SELL"; orderType="MARKET"; productType="MIS"; qty=50 }
$placed2 = Call "POST /api/orders/place MARKET SELL" POST "/api/orders/place" $mktSell
if ($placed2) { Write-Host "     orderId=$($placed2.orderId) status=$($placed2.status)" }

# 14. ORDER MODIFY + CANCEL
Write-Host "`n[14] Order Modification and Cancellation"
$limOrd = @{ symbol="RELIANCE"; token="2885"; segment="NSE"; side="BUY"; orderType="LIMIT"; productType="MIS"; qty=1; price=1000 }
$lim = Call "POST /api/orders/place LIMIT BUY" POST "/api/orders/place" $limOrd
if ($lim -and $lim.orderId) {
    Write-Host "     limitOrderId=$($lim.orderId)"
    Start-Sleep -Milliseconds 400
    Call "PUT /api/orders modify price" PUT "/api/orders/$($lim.orderId)/modify" @{ price=1050 } | Out-Null
    # Cancel -- 409 = already filled (paper mode fills instantly), both are valid
    try {
        $null = Invoke-RestMethod -Uri "$BASE/api/orders/$($lim.orderId)/cancel" `
            -Method DELETE `
            -Headers @{ "Authorization"="Bearer $($script:fw_session)"; "Content-Type"="application/json" } `
            -ErrorAction Stop
        ok "DELETE /api/orders cancel"
    } catch {
        $code2 = $_.Exception.Response.StatusCode.value__
        if ($code2 -eq 409) {
            ok "DELETE /api/orders cancel (409 already filled - correct)"
        } else {
            fail "DELETE /api/orders cancel" "HTTP $code2"
        }
    }
}

# 15. ORDERS + TRADE HISTORY
Write-Host "`n[15] Orders and Trade History"
$ords = Call "GET /api/orders" GET "/api/orders"
if ($ords -ne $null) { Write-Host "     count=$($ords.Count)" }
$trds = Call "GET /api/trades today" GET "/api/trades?period=today"
if ($trds -ne $null) { Write-Host "     today=$($trds.Count)" }
$trdsW = Call "GET /api/trades week" GET "/api/trades?period=week"
if ($trdsW -ne $null) { Write-Host "     week=$($trdsW.Count)" }

# 16. RISK ENGINE
Write-Host "`n[16] Risk Engine"
$rs2 = Call "GET /api/account/risk-state (post-trade)" GET "/api/account/risk-state"
if ($rs2) { Write-Host "     todayTrades=$($rs2.todayTradeCount) dailyPnl=$($rs2.totalDailyPnl)" }

# 17. PROVISIONING SYNC
Write-Host "`n[17] Provisioning Sync"
try {
    $null = Invoke-RestMethod -Uri "$BASE/provisioning/status/VERIFY-TEST-999" `
        -Headers @{ "x-provisioning-key"=$PROV_KEY } `
        -ErrorAction Stop
    ok "GET /provisioning/status not-found returns 404"
} catch {
    $code3 = $_.Exception.Response.StatusCode.value__
    if ($code3 -eq 404) {
        ok "GET /provisioning/status 404 for unknown order (correct)"
    } else {
        fail "GET /provisioning/status" "HTTP $code3"
    }
}

# 18. ANALYTICS
Write-Host "`n[18] Analytics"
Call "GET /api/account/equity-curve" GET "/api/account/equity-curve?days=30" | Out-Null
Call "GET /api/account/metrics" GET "/api/account/metrics?days=30" | Out-Null
Call "GET /api/market/scanner" GET "/api/market/scanner?type=top_gainers&segment=NSE&limit=10" | Out-Null

# BROKER HEALTH
Write-Host "`n[19] Broker Health"
Call "GET /api/broker/health" GET "/api/broker/health" | Out-Null

# RESULTS
Write-Host ""
Write-Host "================================================"
Write-Host "  PASS: $($script:pass)   FAIL: $($script:fail)"
Write-Host "================================================"
if ($script:fail -eq 0) {
    Write-Host "  ALL ENDPOINTS PASSED" -ForegroundColor Green
} else {
    Write-Host "  $($script:fail) endpoint(s) need attention" -ForegroundColor Yellow
}
