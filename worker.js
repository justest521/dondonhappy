// ============================================================
// solitary-wood-898d.justest521.workers.dev
// Cloudflare Worker · MEP Trading System Proxy
// ────────────────────────────────────────────────────────────
// Routes:
//   GET  /api/fred?series=X&limit=N      — FRED economic data
//   POST /api/ai                          — Anthropic API proxy (existing)
//   GET  /api/uw/*                        — Unusual Whales (existing, preserved)
//   GET  /api/yahoo?symbol=X              — Yahoo Finance quote (existing, preserved)
//
// Required env vars (set via `wrangler secret put` or dashboard):
//   FRED_API_KEY        — https://fred.stlouisfed.org/docs/api/api_key.html
//   ANTHROPIC_API_KEY   — https://console.anthropic.com/settings/keys
//   UW_API_KEY          — Unusual Whales (if you use UW routes)
// ============================================================

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    try {
      // ── New: FRED proxy
      if (path === '/api/fred') {
        return await handleFred(url, env);
      }
      if (path === '/api/fred/batch') {
        return await handleFredBatch(url, env);
      }

      // ── Existing: Anthropic AI proxy
      if (path === '/api/ai') {
        return await handleAI(request, env);
      }

      // ── Existing: Unusual Whales proxy (passthrough auth)
      if (path.startsWith('/api/uw/')) {
        return await handleUW(request, env);
      }

      // ── Existing: Yahoo Finance proxy
      if (path === '/api/yahoo' || path.startsWith('/api/yahoo/')) {
        return await handleYahoo(request, env);
      }

      // ── New: Polygon proxy
      // /api/polygon/quote?ticker=I:VIX  — index/stock current price
      // /api/polygon/sma?ticker=I:SPX&window=20&timespan=week  — 20MA
      // /api/polygon/option-chain?underlying=VIX&expiry=2026-05-14  — chain snapshot
      // /api/polygon/option-snapshot?underlying=NVDA&contract=O:NVDA260516C00150000
      if (path.startsWith('/api/polygon/')) {
        return await handlePolygon(request, env, path);
      }

      // ── Health check (basic — just confirms worker is alive)
      if (path === '/' || path === '/health') {
        return jsonResponse({
          ok: true,
          worker: 'solitary-wood-898d',
          routes: [
            '/api/fred', '/api/fred/batch',
            '/api/ai',
            '/api/uw/*',
            '/api/yahoo',
            '/api/polygon/quote', '/api/polygon/sma',
            '/api/polygon/option-chain', '/api/polygon/option-snapshot',
            '/api/polygon/atm-straddle',
            '/api/health/integrations',
          ],
          time: new Date().toISOString(),
        });
      }

      // ── Aggregated integration health (FRED / UW / Polygon / Yahoo)
      // Single endpoint that proxies the 4 representative pings server-side.
      // Frontend just calls this once → no flaky 4-way browser fetch fan-out.
      if (path === '/api/health/integrations') {
        return await handleHealthIntegrations(request, env);
      }

      // ── Scanner batch: fetch IVR + earnings for many tickers in one call.
      // Frontend (OptionsScanner / TextbookLiveMatches) uses this to avoid
      // N×2 browser fetches (which can be blocked by extensions / SW).
      if (path === '/api/scanner/batch') {
        return await handleScannerBatch(request, env);
      }

      // ── Telegram push alerts
      if (path === '/api/alerts/test') {
        return await handleAlertTest(request, env);
      }
      if (path === '/api/alerts/check') {
        return await handleAlertCheck(request, env);
      }
      if (path === '/api/alerts/status') {
        return await handleAlertStatus(request, env);
      }

      return new Response('Not Found', { status: 404, headers: corsHeaders() });
    } catch (err) {
      return jsonResponse({ error: 'Worker error', message: err.message }, 500);
    }
  },
};

// ════════════════════════════════════════════════════════════
// CORS
// ════════════════════════════════════════════════════════════
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key, anthropic-version',
    'Access-Control-Max-Age': '86400',
  };
}

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

// ════════════════════════════════════════════════════════════
// FRED (Federal Reserve Economic Data)
// ════════════════════════════════════════════════════════════
async function handleFred(url, env) {
  const series = url.searchParams.get('series');
  const limit = parseInt(url.searchParams.get('limit') || '25', 10);
  if (!series) return jsonResponse({ error: 'Missing series param' }, 400);
  if (!env.FRED_API_KEY) {
    return jsonResponse({
      error: 'FRED_API_KEY not configured. Set via: wrangler secret put FRED_API_KEY',
    }, 500);
  }

  // Cache key: per-series, 60-min TTL (FRED data is daily/weekly anyway)
  const cacheKey = 'fred-' + series + '-' + limit;
  const cache = caches.default;
  const cacheUrl = new URL(url);
  cacheUrl.pathname = '/__cache/' + cacheKey;
  const cacheReq = new Request(cacheUrl.toString());
  const cached = await cache.match(cacheReq);
  if (cached) {
    const headers = new Headers(cached.headers);
    headers.set('X-Cache', 'HIT');
    return new Response(cached.body, { status: cached.status, headers });
  }

  // FRED API call
  const fredUrl = 'https://api.stlouisfed.org/fred/series/observations'
    + '?series_id=' + encodeURIComponent(series)
    + '&api_key=' + env.FRED_API_KEY
    + '&file_type=json'
    + '&sort_order=desc'
    + '&limit=' + limit;

  const fredRes = await fetch(fredUrl, { headers: { 'User-Agent': 'curl/8.0' } });
  if (!fredRes.ok) {
    const errText = await fredRes.text();
    return jsonResponse({
      error: 'FRED API error',
      status: fredRes.status,
      details: errText.slice(0, 500),
    }, fredRes.status);
  }

  const data = await fredRes.json();

  // Slim down response: just date + value pairs
  const slim = {
    series_id: series,
    units: data.units || null,
    observations: (data.observations || []).map(o => ({
      date: o.date,
      value: o.value === '.' ? null : parseFloat(o.value),
    })),
    fetched_at: new Date().toISOString(),
  };

  const response = jsonResponse(slim);
  // Cache for 60 minutes
  response.headers.set('Cache-Control', 's-maxage=3600');
  response.headers.set('X-Cache', 'MISS');
  await cache.put(cacheReq, response.clone());
  return response;
}

// Batch fetch multiple series in one call (saves round trips)
async function handleFredBatch(url, env) {
  const seriesParam = url.searchParams.get('series');
  const limit = parseInt(url.searchParams.get('limit') || '25', 10);
  if (!seriesParam) return jsonResponse({ error: 'Missing series param (comma-separated)' }, 400);
  if (!env.FRED_API_KEY) return jsonResponse({ error: 'FRED_API_KEY not configured' }, 500);

  const seriesList = seriesParam.split(',').map(s => s.trim()).filter(Boolean);
  if (seriesList.length > 10) return jsonResponse({ error: 'Max 10 series per batch' }, 400);

  const results = await Promise.all(
    seriesList.map(async (s) => {
      try {
        const fredUrl = 'https://api.stlouisfed.org/fred/series/observations'
          + '?series_id=' + encodeURIComponent(s)
          + '&api_key=' + env.FRED_API_KEY
          + '&file_type=json'
          + '&sort_order=desc'
          + '&limit=' + limit;
        const r = await fetch(fredUrl, { headers: { 'User-Agent': 'curl/8.0' } });
        if (!r.ok) return { series: s, error: 'FRED returned ' + r.status };
        const d = await r.json();
        return {
          series: s,
          observations: (d.observations || []).map(o => ({
            date: o.date,
            value: o.value === '.' ? null : parseFloat(o.value),
          })),
        };
      } catch (e) {
        return { series: s, error: e.message };
      }
    })
  );

  return jsonResponse({
    series: results,
    fetched_at: new Date().toISOString(),
  });
}

// ════════════════════════════════════════════════════════════
// Anthropic AI proxy
// ════════════════════════════════════════════════════════════
async function handleAI(request, env) {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'POST only' }, 405);
  }
  if (!env.ANTHROPIC_API_KEY) {
    return jsonResponse({ error: 'ANTHROPIC_API_KEY not configured' }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  // Sane defaults
  if (!body.model) body.model = 'claude-sonnet-4-5-20250929';
  if (!body.max_tokens) body.max_tokens = 2048;

  const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  const data = await aiRes.json();
  return jsonResponse(data, aiRes.status);
}

// ════════════════════════════════════════════════════════════
// Unusual Whales passthrough (preserve existing dondonhappy logic)
// ════════════════════════════════════════════════════════════
async function handleUW(request, env) {
  const url = new URL(request.url);
  // Strip /api/uw prefix → forward rest
  const uwPath = url.pathname.replace(/^\/api\/uw/, '');
  const uwUrl = 'https://api.unusualwhales.com' + uwPath + url.search;

  // Cache wrapper — UW data is daily-ish, 15 min cache is plenty and saves
  // rate-limit budget when multiple tabs/refreshes hit the same ticker.
  const cacheKey = 'uw-' + uwPath + '?' + url.search;
  const cache = caches.default;
  const cacheReq = new Request('https://internal/__uw-cache/' + encodeURIComponent(cacheKey));
  const cached = await cache.match(cacheReq);
  if (cached) {
    const headers = new Headers(cached.headers);
    headers.set('X-Cache', 'HIT');
    return new Response(cached.body, { status: cached.status, headers });
  }

  const headers = new Headers();
  headers.set('Accept', 'application/json');
  if (env.UW_API_KEY) {
    headers.set('Authorization', 'Bearer ' + env.UW_API_KEY);
  }

  const uwRes = await fetch(uwUrl, { headers });
  const text = await uwRes.text();
  const response = new Response(text, {
    status: uwRes.status,
    headers: {
      'Content-Type': uwRes.headers.get('Content-Type') || 'application/json',
      'Cache-Control': 's-maxage=900',
      'X-Cache': 'MISS',
      ...corsHeaders(),
    },
  });
  // Only cache 200 responses
  if (uwRes.ok) {
    await cache.put(cacheReq, response.clone());
  }
  return response;
}

// ════════════════════════════════════════════════════════════
// Yahoo Finance proxy (preserve existing dondonhappy logic)
// ════════════════════════════════════════════════════════════
async function handleYahoo(request, env) {
  const url = new URL(request.url);
  const symbol = url.searchParams.get('symbol');
  if (!symbol) return jsonResponse({ error: 'Missing symbol param' }, 400);

  // Yahoo's /v7/quote requires crumb cookie now (returns 401). Use /v8/chart instead.
  const yahooUrl = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(symbol)
    + '?interval=1d&range=5d';
  try {
    const r = await fetch(yahooUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MEP-Worker/1.0)' },
    });
    if (!r.ok) {
      return jsonResponse({ error: 'Yahoo fetch failed', status: r.status, symbol }, r.status);
    }
    const data = await r.json();
    const result = data.chart?.result?.[0];
    if (!result) return jsonResponse({ error: 'No data for symbol', symbol }, 404);
    const meta = result.meta || {};
    const closes = result.indicators?.quote?.[0]?.close || [];
    const lastClose = closes.filter(v => v != null).pop() ?? null;
    return jsonResponse({
      symbol,
      regularMarketPrice: meta.regularMarketPrice ?? lastClose,
      price: meta.regularMarketPrice ?? lastClose,
      previousClose: meta.previousClose ?? meta.chartPreviousClose ?? null,
      currency: meta.currency ?? null,
      exchange: meta.exchangeName ?? null,
      asOf: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : null,
      source: 'yahoo-chart-v8',
    });
  } catch (e) {
    return jsonResponse({ error: 'Yahoo fetch failed', message: e.message }, 500);
  }
}

// ════════════════════════════════════════════════════════════
// Polygon.io proxy
// ────────────────────────────────────────────────────────────
// Required: env.POLYGON_API_KEY (set via wrangler secret put POLYGON_API_KEY)
// Subscription tier matters:
//   - Indices snapshot (I:VIX, I:SPX) requires Indices subscription
//   - Options snapshot/chain requires Options subscription
//   - Stocks snapshot requires Stocks subscription
// All prefixed with 'I:' for indices, 'O:' for options, plain ticker for stocks.
// ════════════════════════════════════════════════════════════
async function handlePolygon(request, env, path) {
  if (!env.POLYGON_API_KEY) {
    return jsonResponse({
      error: 'POLYGON_API_KEY not configured. Set via: wrangler secret put POLYGON_API_KEY',
    }, 500);
  }
  const url = new URL(request.url);
  const subPath = path.replace(/^\/api\/polygon/, '');

  try {
    if (subPath === '/quote') {
      return await polygonQuote(url, env);
    }
    if (subPath === '/sma') {
      return await polygonSMA(url, env);
    }
    if (subPath === '/aggregates') {
      return await polygonAggregates(url, env);
    }
    if (subPath === '/ticker-details') {
      return await polygonTickerDetails(url, env);
    }
    if (subPath === '/option-chain') {
      return await polygonOptionChain(url, env);
    }
    if (subPath === '/option-snapshot') {
      return await polygonOptionSnapshot(url, env);
    }
    if (subPath === '/atm-straddle') {
      return await polygonATMStraddle(url, env);
    }
    return jsonResponse({ error: 'Unknown polygon route: ' + subPath }, 404);
  } catch (e) {
    return jsonResponse({
      error: 'Polygon proxy error',
      message: e.message,
      route: subPath,
    }, 500);
  }
}

// Cache wrapper — Polygon data we cache 5 min for snapshots, 60 min for SMA
async function polygonCachedFetch(cacheKey, ttlSec, fetcher) {
  const cache = caches.default;
  const cacheUrl = new URL('https://internal/__polygon-cache/' + cacheKey);
  const cacheReq = new Request(cacheUrl.toString());
  const cached = await cache.match(cacheReq);
  if (cached) {
    const headers = new Headers(cached.headers);
    headers.set('X-Cache', 'HIT');
    return new Response(cached.body, { status: cached.status, headers });
  }
  const fresh = await fetcher();
  if (fresh.ok) {
    const cloned = fresh.clone();
    const responseToCache = new Response(cloned.body, fresh);
    responseToCache.headers.set('Cache-Control', 's-maxage=' + ttlSec);
    responseToCache.headers.set('X-Cache', 'MISS');
    await cache.put(cacheReq, responseToCache.clone());
    return responseToCache;
  }
  return fresh;
}

// ────────────────────────────────────────────────────────────
// /api/polygon/quote?ticker=I:VIX  → { ticker, price, prevClose, change, changePct, asOf }
// Tries indices snapshot first, falls back to last-trade for stocks.
// ────────────────────────────────────────────────────────────
async function polygonQuote(url, env) {
  const ticker = url.searchParams.get('ticker');
  if (!ticker) return jsonResponse({ error: 'Missing ticker' }, 400);

  return polygonCachedFetch('quote-' + ticker, 60, async () => {
    let polyUrl;
    if (ticker.startsWith('I:')) {
      // Indices: use Indices unified snapshot
      polyUrl = 'https://api.polygon.io/v3/snapshot?ticker.any_of=' + encodeURIComponent(ticker)
        + '&apiKey=' + env.POLYGON_API_KEY;
      const r = await fetch(polyUrl);
      const d = await r.json();
      if (!r.ok || !d.results || d.results.length === 0) {
        return jsonResponse({
          error: 'Indices snapshot failed (你的 Polygon 方案可能未含 Indices)',
          status: r.status,
          polygonError: d.error || d.message || null,
          ticker,
          hint: 'Options Starter 不含 Indices。需要 Indices Starter ($29/月) 或用 ETF 代理（VIXY 代理 VIX、SPY 代理 SPX）',
        }, r.ok ? 404 : r.status);
      }
      const item = d.results[0];
      return jsonResponse({
        ticker,
        price: item.value ?? null,
        prevClose: item.session?.previous_close ?? null,
        change: item.session?.change ?? null,
        changePct: item.session?.change_percent ?? null,
        marketStatus: item.market_status ?? null,
        asOf: item.last_updated ? new Date(item.last_updated / 1_000_000).toISOString() : null,
        source: 'polygon-indices',
      });
    }
    // Stocks: use snapshot
    polyUrl = 'https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers/'
      + encodeURIComponent(ticker) + '?apiKey=' + env.POLYGON_API_KEY;
    const r = await fetch(polyUrl);
    const d = await r.json();
    if (!r.ok || !d.ticker) {
      return jsonResponse({
        error: 'Stock snapshot failed',
        status: r.status,
        polygonError: d.error || d.message || null,
        ticker,
      }, r.ok ? 404 : r.status);
    }
    const t = d.ticker;
    // After-hours / weekend: lastTrade & day.c can be 0; fall back to prevDay close so price is always usable
    const lastTradeP = t.lastTrade?.p;
    const dayClose = t.day?.c;
    const prevClose = t.prevDay?.c ?? null;
    const price = (lastTradeP && lastTradeP > 0) ? lastTradeP
                : (dayClose && dayClose > 0) ? dayClose
                : prevClose;
    return jsonResponse({
      ticker,
      price,
      prevClose,
      change: t.todaysChange ?? null,
      changePct: t.todaysChangePerc ?? null,
      asOf: t.updated ? new Date(t.updated / 1_000_000).toISOString() : null,
      source: 'polygon-stocks',
      ...(price === prevClose && (!lastTradeP || lastTradeP === 0) ? { note: 'using prev-day close (market closed/no trades)' } : {}),
    });
  });
}

// ────────────────────────────────────────────────────────────
// /api/polygon/sma?ticker=I:SPX&window=20&timespan=week
// Uses Polygon's SMA technical indicator endpoint.
// Returns latest SMA value + latest close price + above/below boolean.
// ────────────────────────────────────────────────────────────
async function polygonSMA(url, env) {
  const ticker = url.searchParams.get('ticker');
  const window = parseInt(url.searchParams.get('window') || '20', 10);
  const timespan = url.searchParams.get('timespan') || 'day';
  if (!ticker) return jsonResponse({ error: 'Missing ticker' }, 400);

  const cacheKey = 'sma-v2-' + ticker + '-' + window + '-' + timespan;
  return polygonCachedFetch(cacheKey, 1800, async () => {
    // Indices SMA endpoint
    const isIndex = ticker.startsWith('I:');
    const base = 'https://api.polygon.io/v1/indicators/sma/' + encodeURIComponent(ticker)
      + '?timespan=' + timespan
      + '&window=' + window
      + '&series_type=close'
      + '&order=desc'
      + '&limit=10'
      + '&apiKey=' + env.POLYGON_API_KEY;
    const r = await fetch(base);
    const d = await r.json();
    if (!r.ok) {
      return jsonResponse({
        error: 'SMA fetch failed',
        status: r.status,
        polygonError: d.error || d.message || null,
        ticker,
        hint: isIndex ? '需要 Indices subscription' : '檢查 ticker 拼寫',
      }, r.status);
    }
    const sma = d.results?.values?.[0];
    if (!sma) {
      return jsonResponse({ error: 'No SMA data', ticker }, 404);
    }

    // Polygon's SMA response does not always include the underlying close.
    // Never compare SMA against itself: fetch recent aggregates and use the
    // newest close so SPX above/below MA remains a real signal.
    const aggregateBars = d.results?.underlying?.aggregates || [];
    let latestClose = aggregateBars[0]?.c ?? aggregateBars[aggregateBars.length - 1]?.c ?? null;
    let closeTimestamp = aggregateBars[0]?.t ?? aggregateBars[aggregateBars.length - 1]?.t ?? null;
    let closeSource = latestClose != null ? 'polygon-sma-underlying' : null;

    if (latestClose == null) {
      const bars = await fetchPolygonAggregateBars(ticker, 10, env);
      const latestBar = bars[bars.length - 1] || null;
      latestClose = latestBar?.c ?? null;
      closeTimestamp = latestBar?.t ?? null;
      closeSource = latestClose != null ? 'polygon-aggregates' : null;
    }

    return jsonResponse({
      ticker,
      window,
      timespan,
      latestSMA: sma.value,
      smaTimestamp: sma.timestamp ? new Date(sma.timestamp).toISOString() : null,
      latestClose,
      closeTimestamp: closeTimestamp ? new Date(closeTimestamp).toISOString() : null,
      aboveMA: latestClose != null ? latestClose > sma.value : null,
      pctFromMA: latestClose != null
        ? ((latestClose - sma.value) / sma.value) * 100
        : null,
      closeSource,
      source: 'polygon-sma',
    });
  });
}

async function fetchPolygonAggregateBars(ticker, days, env) {
  const to = new Date();
  const from = new Date(Date.now() - days * 2 * 86400000);
  const fmt = (d) => d.toISOString().slice(0, 10);
  const polyUrl = 'https://api.polygon.io/v2/aggs/ticker/' + encodeURIComponent(ticker)
    + '/range/1/day/' + fmt(from) + '/' + fmt(to)
    + '?adjusted=true&sort=asc&limit=' + (days * 2)
    + '&apiKey=' + env.POLYGON_API_KEY;
  const r = await fetch(polyUrl);
  const d = await r.json();
  if (!r.ok) return [];
  return d.results || [];
}

// ────────────────────────────────────────────────────────────
// /api/polygon/aggregates?ticker=SPY&days=70
// Returns the last N daily closes — used for RRG relative-strength math
// against SPY (sector rotation) and rolling beta computation.
// ────────────────────────────────────────────────────────────
async function polygonAggregates(url, env) {
  const ticker = url.searchParams.get('ticker');
  const days = Math.max(5, Math.min(400, parseInt(url.searchParams.get('days') || '70', 10)));
  if (!ticker) return jsonResponse({ error: 'Missing ticker' }, 400);

  const cacheKey = 'aggs-' + ticker + '-' + days;
  return polygonCachedFetch(cacheKey, 900, async () => {
    const barsRaw = await fetchPolygonAggregateBars(ticker, days, env);
    if (barsRaw.length === 0) {
      return jsonResponse({
        error: 'Aggregates fetch failed or returned no bars',
        ticker,
      }, 502);
    }
    const bars = barsRaw.slice(-days).map(b => ({ t: b.t, c: b.c }));
    return jsonResponse({ ticker, count: bars.length, bars });
  });
}

// ────────────────────────────────────────────────────────────
// /api/polygon/ticker-details?ticker=NVDA
// Returns market cap + sector + share count — used to auto-classify TICKER_PROFILE
// (AI_LEADER / MEGA_CAP / etc.) and approximate QQQ_WEIGHT.
// ────────────────────────────────────────────────────────────
async function polygonTickerDetails(url, env) {
  const ticker = url.searchParams.get('ticker');
  if (!ticker) return jsonResponse({ error: 'Missing ticker' }, 400);
  const cacheKey = 'tdetails-' + ticker.toUpperCase();
  return polygonCachedFetch(cacheKey, 86400, async () => {
    const polyUrl = 'https://api.polygon.io/v3/reference/tickers/' + encodeURIComponent(ticker.toUpperCase())
      + '?apiKey=' + env.POLYGON_API_KEY;
    const r = await fetch(polyUrl);
    const d = await r.json();
    if (!r.ok || !d.results) {
      return jsonResponse({
        error: 'Ticker details fetch failed',
        status: r.status,
        polygonError: d.error || d.message || null,
        ticker,
      }, r.status);
    }
    const res = d.results;
    return jsonResponse({
      ticker: res.ticker,
      name: res.name || null,
      market_cap: isFinite(res.market_cap) ? res.market_cap : null,
      share_class_shares_outstanding: isFinite(res.share_class_shares_outstanding) ? res.share_class_shares_outstanding : null,
      weighted_shares_outstanding: isFinite(res.weighted_shares_outstanding) ? res.weighted_shares_outstanding : null,
      sic_code: res.sic_code || null,
      sic_description: res.sic_description || null,
      primary_exchange: res.primary_exchange || null,
    });
  });
}

// ────────────────────────────────────────────────────────────
// /api/polygon/option-chain?underlying=VIX&expiry=2026-05-14&strikes=16,18,20,22
// Returns parsed list of contracts at the specified strikes (call default).
// ────────────────────────────────────────────────────────────
async function polygonOptionChain(url, env) {
  const underlying = url.searchParams.get('underlying');
  const expiry = url.searchParams.get('expiry');     // YYYY-MM-DD
  const strikesParam = url.searchParams.get('strikes');  // comma-separated
  const contractType = url.searchParams.get('type') || 'call';
  if (!underlying || !expiry) {
    return jsonResponse({ error: 'Missing underlying or expiry param' }, 400);
  }

  const strikes = strikesParam
    ? strikesParam.split(',').map(s => parseFloat(s.trim())).filter(s => isFinite(s))
    : null;

  const cacheKey = 'optchain-' + underlying + '-' + expiry + '-' + (strikesParam || 'all') + '-' + contractType;
  return polygonCachedFetch(cacheKey, 60, async () => {
    // Polygon option chain snapshot
    let polyUrl = 'https://api.polygon.io/v3/snapshot/options/' + encodeURIComponent(underlying)
      + '?expiration_date=' + expiry
      + '&contract_type=' + contractType
      + '&limit=250'
      + '&apiKey=' + env.POLYGON_API_KEY;
    const r = await fetch(polyUrl);
    const d = await r.json();
    if (!r.ok) {
      return jsonResponse({
        error: 'Option chain fetch failed',
        status: r.status,
        polygonError: d.error || d.message || null,
        underlying, expiry,
      }, r.status);
    }
    let contracts = (d.results || []).map(c => ({
      ticker: c.details?.ticker,
      strike: c.details?.strike_price,
      expiry: c.details?.expiration_date,
      type: c.details?.contract_type,
      bid: c.last_quote?.bid ?? null,
      ask: c.last_quote?.ask ?? null,
      mid: (c.last_quote?.bid != null && c.last_quote?.ask != null)
        ? (c.last_quote.bid + c.last_quote.ask) / 2 : null,
      lastPrice: c.last_trade?.price ?? null,
      dayClose: c.day?.close ?? c.day?.c ?? null,
      fmv: c.fmv ?? null,
      premium: ((c.last_quote?.bid != null && c.last_quote?.ask != null)
        ? (c.last_quote.bid + c.last_quote.ask) / 2
        : (c.last_trade?.price ?? c.day?.close ?? c.day?.c ?? c.fmv ?? null)),
      iv: c.implied_volatility ?? null,
      delta: c.greeks?.delta ?? null,
      gamma: c.greeks?.gamma ?? null,
      theta: c.greeks?.theta ?? null,
      vega: c.greeks?.vega ?? null,
      openInterest: c.open_interest ?? null,
      volume: c.day?.volume ?? null,
    }));

    // Filter by strikes if specified
    if (strikes) {
      contracts = strikes.map(s => {
        // Find closest strike in returned chain (within $0.5 tolerance)
        const match = contracts.reduce((best, c) => {
          const dist = Math.abs(c.strike - s);
          return (best === null || dist < Math.abs(best.strike - s)) ? c : best;
        }, null);
        return match && Math.abs(match.strike - s) <= 1.0 ? match : null;
      }).filter(Boolean);
    }

    return jsonResponse({
      underlying,
      expiry,
      contractType,
      requestedStrikes: strikes,
      contracts,
      asOf: new Date().toISOString(),
      source: 'polygon-options',
    });
  });
}

// ────────────────────────────────────────────────────────────
// /api/polygon/option-snapshot?underlying=NVDA&contract=O:NVDA260516C00150000
// Single-contract detailed snapshot (full greeks, iv, oi).
// ────────────────────────────────────────────────────────────
async function polygonOptionSnapshot(url, env) {
  const underlying = url.searchParams.get('underlying');
  const contract = url.searchParams.get('contract');
  if (!underlying || !contract) {
    return jsonResponse({ error: 'Missing underlying or contract param' }, 400);
  }
  const cacheKey = 'optsnap-' + contract;
  return polygonCachedFetch(cacheKey, 60, async () => {
    const polyUrl = 'https://api.polygon.io/v3/snapshot/options/' + encodeURIComponent(underlying)
      + '/' + encodeURIComponent(contract) + '?apiKey=' + env.POLYGON_API_KEY;
    const r = await fetch(polyUrl);
    const d = await r.json();
    if (!r.ok) {
      return jsonResponse({
        error: 'Option snapshot failed',
        status: r.status,
        polygonError: d.error || d.message || null,
      }, r.status);
    }
    return jsonResponse(d);
  });
}

// ────────────────────────────────────────────────────────────
// /api/polygon/atm-straddle?underlying=NVDA&expiry=2026-05-16
// 計算 ATM straddle premium → implied move estimate
// expectedMove ≈ (ATM Call mid + ATM Put mid) ×  ~0.85
// ────────────────────────────────────────────────────────────
async function polygonATMStraddle(url, env) {
  const underlying = url.searchParams.get('underlying');
  const expiry = url.searchParams.get('expiry');
  if (!underlying || !expiry) {
    return jsonResponse({ error: 'Missing underlying or expiry' }, 400);
  }
  const cacheKey = 'atmstr-' + underlying + '-' + expiry;
  return polygonCachedFetch(cacheKey, 300, async () => {
    // 1. Get current spot
    const spotRes = await fetch('https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers/'
      + encodeURIComponent(underlying) + '?apiKey=' + env.POLYGON_API_KEY);
    const spotData = await spotRes.json();
    if (!spotRes.ok || !spotData.ticker) {
      return jsonResponse({
        error: 'Could not get spot price',
        polygonError: spotData.error || spotData.message,
      }, spotRes.status);
    }
    // After-hours / weekend: lastTrade & day.c can be 0 (truthy via ??), so explicitly skip 0
    const lastTradeP = spotData.ticker.lastTrade?.p;
    const dayClose = spotData.ticker.day?.c;
    const prevClose = spotData.ticker.prevDay?.c;
    const spot = (lastTradeP && lastTradeP > 0) ? lastTradeP
               : (dayClose && dayClose > 0) ? dayClose
               : (prevClose && prevClose > 0) ? prevClose
               : null;
    if (!spot) return jsonResponse({ error: 'No spot price found' }, 404);

    // 2. Round spot to nearest strike (assume strikes spaced $1 for high-priced stocks, $0.5 for low)
    const atmStrike = Math.round(spot);

    // 3. Fetch both call and put at ATM
    const fetchSide = async (type) => {
      const u = 'https://api.polygon.io/v3/snapshot/options/' + encodeURIComponent(underlying)
        + '?expiration_date=' + expiry
        + '&contract_type=' + type
        + '&strike_price.gte=' + (atmStrike - 2.5)
        + '&strike_price.lte=' + (atmStrike + 2.5)
        + '&limit=10'
        + '&apiKey=' + env.POLYGON_API_KEY;
      const r = await fetch(u);
      const d = await r.json();
      if (!r.ok) return null;
      // Find the contract closest to spot
      return (d.results || []).reduce((best, c) => {
        const dist = Math.abs((c.details?.strike_price || 0) - spot);
        return (!best || dist < Math.abs(best.details.strike_price - spot)) ? c : best;
      }, null);
    };

    const [call, put] = await Promise.all([fetchSide('call'), fetchSide('put')]);
    if (!call || !put) {
      return jsonResponse({
        error: 'Could not find ATM straddle pair',
        spot, atmStrike,
        callFound: !!call, putFound: !!put,
      }, 404);
    }

    const callMid = (call.last_quote?.bid != null && call.last_quote?.ask != null && call.last_quote.bid > 0)
      ? (call.last_quote.bid + call.last_quote.ask) / 2
      : (call.last_trade?.price ?? null);
    const putMid = (put.last_quote?.bid != null && put.last_quote?.ask != null && put.last_quote.bid > 0)
      ? (put.last_quote.bid + put.last_quote.ask) / 2
      : (put.last_trade?.price ?? null);

    let straddlePremium = (callMid || 0) + (putMid || 0);
    let impliedMoveDollar = straddlePremium * 0.85;
    let impliedMovePct = spot > 0 ? (impliedMoveDollar / spot) * 100 : null;
    let derivedFrom = 'straddle-mid';

    // Fallback: if no quotes/trades (market closed), estimate from IV via Black-Scholes approximation
    // Implied move ≈ Spot × avg(IV) × √(DTE/365)
    if (straddlePremium <= 0) {
      const callIV = call.implied_volatility;
      const putIV = put.implied_volatility;
      if (callIV && putIV) {
        const avgIV = (callIV + putIV) / 2;
        const dte = (new Date(expiry).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
        if (dte > 0) {
          impliedMovePct = avgIV * Math.sqrt(dte / 365) * 100;
          impliedMoveDollar = (impliedMovePct / 100) * spot;
          straddlePremium = impliedMoveDollar / 0.85;  // implied straddle from IV
          derivedFrom = 'iv-estimate';
        }
      }
    }

    return jsonResponse({
      underlying,
      expiry,
      spot,
      atmStrike: call.details.strike_price,
      callTicker: call.details?.ticker,
      callMid,
      callIV: call.implied_volatility,
      putTicker: put.details?.ticker,
      putMid,
      putIV: put.implied_volatility,
      straddlePremium,
      impliedMoveDollar,
      impliedMovePct,
      derivedFrom,
      asOf: new Date().toISOString(),
      source: 'polygon-atm-straddle',
    });
  });
}

// ════════════════════════════════════════════════════════════
// Aggregated integration health check
// ════════════════════════════════════════════════════════════
// Direct upstream pings (NOT via self-fetch — Cloudflare blocks
// same-zone subrequests with error 1042). Each probe goes straight
// to the source API using the worker's stored credentials.
async function handleHealthIntegrations(request, env) {
  // Build probe definitions — each goes to upstream directly
  const probes = [
    {
      key: 'fred',
      label: '/api/fred/batch?series=WALCL',
      build: () => {
        if (!env.FRED_API_KEY) return { error: 'FRED_API_KEY not set in worker secrets' };
        return {
          url: 'https://api.stlouisfed.org/fred/series/observations'
            + '?series_id=WALCL&api_key=' + env.FRED_API_KEY
            + '&file_type=json&sort_order=desc&limit=1',
          init: { headers: { 'User-Agent': 'curl/8.0' } },
          validate: (j) => Array.isArray(j.observations) && j.observations.length > 0,
        };
      },
    },
    {
      key: 'uw',
      label: '/api/uw/api/stock/SPY/iv-rank',
      build: () => {
        if (!env.UW_API_KEY) return { error: 'UW_API_KEY not set in worker secrets' };
        return {
          url: 'https://api.unusualwhales.com/api/stock/SPY/iv-rank?timespan=1m',
          init: { headers: { 'Accept': 'application/json', 'Authorization': 'Bearer ' + env.UW_API_KEY } },
          validate: (j) => Array.isArray(j.data),
        };
      },
    },
    {
      key: 'polygon',
      label: '/api/polygon/quote?ticker=SPY',
      build: () => {
        if (!env.POLYGON_API_KEY) return { error: 'POLYGON_API_KEY not set in worker secrets' };
        return {
          url: 'https://api.polygon.io/v2/aggs/ticker/SPY/prev?adjusted=true&apiKey=' + env.POLYGON_API_KEY,
          init: {},
          validate: (j) => Array.isArray(j.results) && j.results.length > 0,
        };
      },
    },
    {
      key: 'yahoo',
      label: '/api/yahoo?symbol=%5EMOVE',
      build: () => ({
        url: 'https://query1.finance.yahoo.com/v8/finance/chart/%5EMOVE?interval=1d&range=1d',
        init: { headers: { 'User-Agent': 'Mozilla/5.0' } },
        validate: (j) => j && j.chart && Array.isArray(j.chart.result) && j.chart.result.length > 0,
      }),
    },
  ];

  const results = await Promise.all(probes.map(async (p) => {
    const t0 = Date.now();
    const config = p.build();

    if (config.error) {
      return {
        provider: p.key, path: p.label, status: 'error',
        httpStatus: 0, reason: config.error, elapsedMs: 0, sample: '',
      };
    }

    try {
      const r = await fetch(config.url, config.init);
      const txt = await r.text();
      let json = null;
      let parseErr = null;
      try { json = JSON.parse(txt); } catch (e) { parseErr = e.message; }
      const elapsed = Date.now() - t0;
      let status = 'ok';
      let reason = 'OK';
      if (!r.ok) { status = 'error'; reason = 'Upstream HTTP ' + r.status; }
      else if (parseErr) { status = 'error'; reason = 'JSON parse: ' + parseErr; }
      else if (!json) { status = 'error'; reason = 'Empty response'; }
      else if (!config.validate(json)) { status = 'error'; reason = 'Validator failed (shape mismatch)'; }

      return {
        provider: p.key,
        path: p.label,
        status,
        httpStatus: r.status,
        reason,
        elapsedMs: elapsed,
        sample: json ? JSON.stringify(json).slice(0, 200) : (txt || '').slice(0, 200),
      };
    } catch (e) {
      return {
        provider: p.key,
        path: p.label,
        status: 'error',
        httpStatus: 0,
        reason: 'NETWORK: ' + (e.message || 'fetch threw'),
        elapsedMs: Date.now() - t0,
        sample: '',
      };
    }
  }));

  const okCount = results.filter(r => r.status === 'ok').length;
  const overall = okCount === results.length ? 'ok' : (okCount === 0 ? 'down' : 'degraded');

  return jsonResponse({
    ok: overall === 'ok',
    overall,
    okCount,
    total: results.length,
    checks: results,
    time: new Date().toISOString(),
    worker: 'solitary-wood-898d',
  });
}

// ════════════════════════════════════════════════════════════
// Scanner batch — pre-aggregate IVR + earnings for many tickers
// ════════════════════════════════════════════════════════════
// Frontend usage:
//   GET /api/scanner/batch?tickers=NVDA,AAPL,MSFT,...
// Returns:
//   {
//     tickers: [
//       { ticker: "NVDA", ivr: {ivr, iv, asOf}, earnings: {date, expectedMovePct, ...} },
//       ...
//     ]
//   }
// Saves the browser from making N×2 cross-origin fetches.
async function handleScannerBatch(request, env) {
  const url = new URL(request.url);
  const tickersParam = url.searchParams.get('tickers');
  if (!tickersParam) return jsonResponse({ error: 'Missing tickers param (comma-separated)' }, 400);
  if (!env.UW_API_KEY) return jsonResponse({ error: 'UW_API_KEY not configured' }, 500);

  const tickers = tickersParam.split(',').map(s => s.trim().toUpperCase()).filter(Boolean).slice(0, 30);

  const today = new Date().toISOString().slice(0, 10);
  const headers = { 'Accept': 'application/json', 'Authorization': 'Bearer ' + env.UW_API_KEY };

  const results = await Promise.all(tickers.map(async (t) => {
    // Fetch IVR + earnings (UW) + prev-day quote (Polygon) in parallel
    const [ivrR, earnR, quoteR] = await Promise.allSettled([
      fetch('https://api.unusualwhales.com/api/stock/' + encodeURIComponent(t) + '/iv-rank?timespan=1m', { headers }),
      fetch('https://api.unusualwhales.com/api/earnings/' + encodeURIComponent(t), { headers }),
      env.POLYGON_API_KEY
        ? fetch('https://api.polygon.io/v2/aggs/ticker/' + encodeURIComponent(t) + '/prev?adjusted=true&apiKey=' + env.POLYGON_API_KEY)
        : Promise.resolve(null),
    ]);

    let ivr = null;
    let close = null;  // last close from UW (free side product)
    if (ivrR.status === 'fulfilled' && ivrR.value.ok) {
      try {
        const j = await ivrR.value.json();
        const arr = j && j.data;
        if (Array.isArray(arr) && arr.length > 0) {
          const latest = arr[arr.length - 1];
          const rank = parseFloat(latest.iv_rank_1y);
          const iv = parseFloat(latest.volatility);
          const c = parseFloat(latest.close);
          if (isFinite(c)) close = c;
          ivr = {
            ivr: isFinite(rank) ? parseFloat(rank.toFixed(1)) : null,
            iv: isFinite(iv) ? parseFloat((iv * 100).toFixed(1)) : null,
            asOf: latest.date,
          };
        }
      } catch (_) {}
    }

    let earnings = null;
    if (earnR.status === 'fulfilled' && earnR.value.ok) {
      try {
        const j = await earnR.value.json();
        const arr = j && j.data;
        if (Array.isArray(arr) && arr.length > 0) {
          const future = arr
            .filter((e) => e.report_date && e.report_date >= today)
            .sort((a, b) => (a.report_date < b.report_date ? -1 : 1));
          if (future.length > 0) {
            const next = future[0];
            const movePct = parseFloat(next.expected_move_perc);
            earnings = {
              date: next.report_date,
              time: next.report_time || null,
              expectedMovePct: isFinite(movePct) ? parseFloat((movePct * 100).toFixed(2)) : null,
              expectedMove: parseFloat(next.expected_move) || null,
              streetEst: parseFloat(next.street_mean_est) || null,
            };
          }
        }
      } catch (_) {}
    }

    // Polygon prev-day close — preferred over UW (more recent / current trading day)
    let quote = close != null ? { price: close, source: 'uw-close' } : null;
    if (quoteR && quoteR.status === 'fulfilled' && quoteR.value && quoteR.value.ok) {
      try {
        const j = await quoteR.value.json();
        if (Array.isArray(j.results) && j.results.length > 0) {
          const r = j.results[0];
          const p = parseFloat(r.c);
          if (isFinite(p)) quote = { price: p, source: 'polygon-prev', volume: r.v, asOf: r.t };
        }
      } catch (_) {}
    }

    return { ticker: t, ivr, earnings, quote };
  }));

  const response = jsonResponse({
    tickers: results,
    fetched_at: new Date().toISOString(),
    count: results.length,
  });
  response.headers.set('Cache-Control', 's-maxage=300');  // 5min server cache
  return response;
}

// ════════════════════════════════════════════════════════════
// Telegram push alerts
// ════════════════════════════════════════════════════════════
// Setup steps for user:
//   1. Open Telegram, talk to @BotFather, /newbot, get HTTP API token
//   2. Send any message to your new bot (e.g., "hi")
//   3. curl https://api.telegram.org/bot<TOKEN>/getUpdates | jq
//      → find chat.id in the response
//   4. wrangler secret put TELEGRAM_BOT_TOKEN
//   5. wrangler secret put TELEGRAM_CHAT_ID
//   6. wrangler deploy
// ════════════════════════════════════════════════════════════

function alertsConfigured(env) {
  return !!(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID);
}

async function sendTelegram(env, text) {
  if (!alertsConfigured(env)) {
    return { ok: false, error: 'Telegram secrets not set (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID)' };
  }
  const url = 'https://api.telegram.org/bot' + env.TELEGRAM_BOT_TOKEN + '/sendMessage';
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: env.TELEGRAM_CHAT_ID,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
    const j = await r.json();
    return { ok: r.ok && j.ok, status: r.status, response: j };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function handleAlertStatus(request, env) {
  return jsonResponse({
    configured: alertsConfigured(env),
    hasBotToken: !!env.TELEGRAM_BOT_TOKEN,
    hasChatId: !!env.TELEGRAM_CHAT_ID,
    workerTime: new Date().toISOString(),
  });
}

async function handleAlertTest(request, env) {
  const result = await sendTelegram(env,
    '🧪 <b>MEP Trading System · 測試訊息</b>\n\n' +
    '如果你收到這則訊息，Telegram alerts 已正確設定 ✓\n' +
    '時間: ' + new Date().toISOString() + '\n' +
    'Worker: solitary-wood-898d');
  return jsonResponse(result, result.ok ? 200 : 500);
}

// Conditions checked: VIX, MOVE, SPY %change. Returns array of triggered alerts.
async function handleAlertCheck(request, env) {
  const triggered = [];

  // VIX
  if (env.POLYGON_API_KEY) {
    try {
      const r = await fetch('https://api.polygon.io/v3/snapshot/indices?ticker.any_of=I:VIX&apiKey=' + env.POLYGON_API_KEY);
      if (r.ok) {
        const j = await r.json();
        const vix = j.results && j.results[0] && j.results[0].value;
        if (isFinite(vix)) {
          if (vix > 30) triggered.push({ key: 'vix-30', severity: 'critical', text: '🔴 <b>VIX = ' + vix.toFixed(2) + '</b> · 突破 30 (恐慌區)' });
          else if (vix > 25) triggered.push({ key: 'vix-25', severity: 'warning', text: '🟡 <b>VIX = ' + vix.toFixed(2) + '</b> · 突破 25 (警戒區)' });
        }
      }
    } catch (_) {}
  }

  // MOVE
  try {
    const r = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/%5EMOVE?interval=1d&range=1d', {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (r.ok) {
      const j = await r.json();
      const move = j.chart && j.chart.result && j.chart.result[0] && j.chart.result[0].meta && j.chart.result[0].meta.regularMarketPrice;
      if (isFinite(move)) {
        if (move > 130) triggered.push({ key: 'move-130', severity: 'critical', text: '🔴 <b>MOVE = ' + move.toFixed(1) + '</b> · 債市波動爆炸 (>130)' });
        else if (move > 110) triggered.push({ key: 'move-110', severity: 'warning', text: '🟡 <b>MOVE = ' + move.toFixed(1) + '</b> · 債市波動升高 (>110)' });
      }
    }
  } catch (_) {}

  // SPY intraday %change
  if (env.POLYGON_API_KEY) {
    try {
      const r = await fetch('https://api.polygon.io/v2/aggs/ticker/SPY/prev?adjusted=true&apiKey=' + env.POLYGON_API_KEY);
      if (r.ok) {
        const j = await r.json();
        const result = Array.isArray(j.results) && j.results[0];
        if (result) {
          const close = result.c, open = result.o;
          const pct = ((close - open) / open) * 100;
          if (pct < -3) triggered.push({ key: 'spy-down-3', severity: 'critical', text: '🔴 <b>SPY 當日 ' + pct.toFixed(2) + '%</b> · 大跌警報' });
          else if (pct < -2) triggered.push({ key: 'spy-down-2', severity: 'warning', text: '🟡 <b>SPY 當日 ' + pct.toFixed(2) + '%</b> · 中跌警戒' });
          else if (pct > 3) triggered.push({ key: 'spy-up-3', severity: 'info', text: '🟢 <b>SPY 當日 +' + pct.toFixed(2) + '%</b> · 大漲，FOMO 警告' });
        }
      }
    } catch (_) {}
  }

  // If any conditions triggered AND Telegram configured, send a single combined message
  let sent = null;
  if (triggered.length > 0 && alertsConfigured(env)) {
    const msg = '⚠️ <b>MEP Alert · ' + new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }) + '</b>\n\n' +
                triggered.map(a => a.text).join('\n');
    sent = await sendTelegram(env, msg);
  }

  return jsonResponse({
    triggered,
    triggeredCount: triggered.length,
    telegramConfigured: alertsConfigured(env),
    sent,
    time: new Date().toISOString(),
  });
}
