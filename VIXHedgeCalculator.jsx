import { useState, useMemo, useEffect, useCallback } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Legend, Cell,
} from 'recharts';
import {
  Shield, Clock, AlertTriangle, DollarSign, Zap,
  TrendingUp, Activity, Layers, Info, CircleDot, Flame,
  Target, Crosshair, Database, Plus, X, Sparkles, Wind,
  GitBranch, Gauge, ChevronRight, BarChart3,
} from 'lucide-react';

// ============================================================
// MEP / VIX Hedge Calculator v2
// ────────────────────────────────────────────────────────────
// v1: 三策略 + 情境 P&L + Timing checklist
// v2 ADDITIONS:
//   [A] IV Crush 二階修正 — vega-aware P&L for scenarios
//   [B] NVDA→QQQ Single Stock Stress Test — 用 implied move
//       推算指數跳空、建議 QQQ Put 對沖
//   [C] Portfolio Beta 整合 — 從持倉算 weighted beta，取代
//       寫死的 -0.008 VIX→portfolio 係數
//   [D] Strategy Recommendation Engine — IVR + DTE + event type
//       自動推薦結構並自動標 RECOMMENDED
// ============================================================

const styleSheet = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Noto+Sans+TC:wght@400;500;700;900&family=JetBrains+Mono:wght@400;500;700&display=swap');

  .font-mono-dm { font-family: 'DM Mono', 'JetBrains Mono', ui-monospace, monospace; }
  .font-tc { font-family: 'Noto Sans TC', -apple-system, sans-serif; }
  .tabular { font-variant-numeric: tabular-nums; }

  .bg-app { background: #0f0f0f; }
  .bg-card { background: #1a1a1a; }
  .bg-subcard { background: #242424; }
  .bg-deepcard { background: #0a0a0a; }
  .text-accent { color: #EAB308; }
  .text-primary { color: #f4f4f4; }
  .text-muted { color: #888; }
  .text-muted-2 { color: #555; }
  .text-green { color: #10b981; }
  .text-red { color: #ef4444; }
  .text-blue { color: #60a5fa; }
  .text-purple { color: #a78bfa; }
  .text-orange { color: #fb923c; }

  .hair-border { border: 1px solid #2a2a2a; }
  .hair-border-b { border-bottom: 1px solid #2a2a2a; }
  .hair-border-t { border-top: 1px solid #2a2a2a; }
  .hair-border-l { border-left: 1px solid #2a2a2a; }
  .hair-border-r { border-right: 1px solid #2a2a2a; }

  input[type="range"] {
    -webkit-appearance: none;
    appearance: none;
    height: 4px;
    background: #2a2a2a;
    border-radius: 2px;
    outline: none;
  }
  input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 14px;
    height: 14px;
    background: #EAB308;
    border-radius: 50%;
    cursor: pointer;
    border: 2px solid #0f0f0f;
  }

  .num-input {
    background: transparent;
    border: 1px solid #2a2a2a;
    color: #f4f4f4;
    padding: 8px 10px;
    border-radius: 4px;
    width: 100%;
    font-family: 'DM Mono', monospace;
    font-size: 14px;
    transition: border-color 0.15s;
  }
  .num-input:focus {
    outline: none;
    border-color: #EAB308;
  }
  .num-input::-webkit-outer-spin-button,
  .num-input::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }

  .text-input {
    background: transparent;
    border: 1px solid #2a2a2a;
    color: #f4f4f4;
    padding: 6px 10px;
    border-radius: 4px;
    font-family: 'DM Mono', monospace;
    font-size: 13px;
    transition: border-color 0.15s;
  }
  .text-input:focus {
    outline: none;
    border-color: #EAB308;
  }

  .pulse-dot {
    width: 6px; height: 6px;
    background: #ef4444;
    border-radius: 50%;
    animation: pulse 1.5s infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(239,68,68,0.7); }
    50% { opacity: 0.7; box-shadow: 0 0 0 6px rgba(239,68,68,0); }
  }

  .strategy-card {
    transition: all 0.15s ease;
  }
  .strategy-card:hover {
    border-color: #EAB308 !important;
  }
  .strategy-card.selected {
    border-color: #EAB308 !important;
    background: rgba(234, 179, 8, 0.05) !important;
  }

  .flame-glow {
    box-shadow: 0 0 20px rgba(239, 68, 68, 0.15) inset;
  }

  .rec-banner {
    background: linear-gradient(135deg, rgba(234,179,8,0.08) 0%, rgba(234,179,8,0.02) 100%);
    border: 1px solid rgba(234,179,8,0.4);
  }

  .rec-banner-wait {
    background: linear-gradient(135deg, rgba(136,136,136,0.06) 0%, rgba(136,136,136,0.02) 100%);
    border: 1px solid rgba(136,136,136,0.3);
  }

  .icon-btn {
    background: transparent;
    border: 1px solid #2a2a2a;
    color: #888;
    border-radius: 4px;
    padding: 4px 8px;
    cursor: pointer;
    transition: all 0.15s;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-family: 'DM Mono', monospace;
    font-size: 11px;
  }
  .icon-btn:hover {
    border-color: #EAB308;
    color: #EAB308;
  }
  .icon-btn.danger:hover {
    border-color: #ef4444;
    color: #ef4444;
  }

  .pos-row {
    transition: background 0.1s;
  }
  .pos-row:hover {
    background: #1f1f1f;
  }

  .toggle-pill {
    display: inline-flex;
    border: 1px solid #2a2a2a;
    border-radius: 4px;
    overflow: hidden;
  }
  .toggle-pill button {
    background: transparent;
    border: none;
    color: #888;
    padding: 6px 12px;
    cursor: pointer;
    font-family: 'DM Mono', monospace;
    font-size: 11px;
    transition: all 0.15s;
    letter-spacing: 0.05em;
  }
  .toggle-pill button.active {
    background: #EAB308;
    color: #0f0f0f;
    font-weight: 700;
  }

  .section-title {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 14px;
    padding-bottom: 10px;
    border-bottom: 1px solid #2a2a2a;
  }
`;

// ============================================================
// Constants — Lookup tables
// ============================================================

// 個股對 SPY 的 beta（用於 portfolio-level VIX hedge 計算）
// VIX 主要對應 SPY，所以這裡用的是 to-SPY beta
const STOCK_BETA = {
  // High-beta growth / momentum
  'NVDA': 1.70, 'TSLA': 1.85, 'AMD': 1.60, 'PLTR': 1.95, 'COIN': 2.10,
  'MSTR': 2.50, 'SMCI': 2.20, 'ARM': 1.65, 'AVGO': 1.40,
  // Mega cap tech
  'AAPL': 1.15, 'MSFT': 1.10, 'GOOGL': 1.15, 'GOOG': 1.15, 'AMZN': 1.30,
  'META': 1.40, 'NFLX': 1.30,
  // Semis / hardware
  'TSM': 1.40, 'ASML': 1.50, 'MU': 1.55, 'QCOM': 1.20, 'INTC': 1.10,
  // Indices / ETF
  'QQQ': 1.15, 'SPY': 1.00, 'IWM': 1.25, 'DIA': 0.95, 'VTI': 1.00,
  'XLK': 1.20, 'XLF': 1.10, 'XLE': 1.20, 'XLV': 0.75, 'XLU': 0.50,
  // Defensive
  'JNJ': 0.60, 'KO': 0.50, 'PG': 0.50, 'WMT': 0.55, 'PEP': 0.55,
  // Cyclical / industrial
  'XOM': 0.90, 'CVX': 0.90, 'CAT': 1.10, 'DE': 1.05,
  // Banks
  'JPM': 1.15, 'BAC': 1.20, 'GS': 1.30, 'WFC': 1.15,
  // From user's MEP watchlist hint
  'SNDK': 1.45, 'AEHR': 1.60,
  // Cash / cash-equivalent
  'CASH': 0.00, 'BIL': 0.00, 'SHY': 0.05,
};

// QQQ 權重（top components, Q1 2026 approximate）
const QQQ_WEIGHT = {
  'AAPL': 0.085, 'MSFT': 0.085, 'NVDA': 0.090, 'AMZN': 0.055, 'META': 0.045,
  'GOOGL': 0.025, 'GOOG': 0.025, 'AVGO': 0.045, 'TSLA': 0.030, 'NFLX': 0.025,
  'COST': 0.025, 'AMD': 0.018, 'PEP': 0.018, 'TMUS': 0.018, 'CSCO': 0.015,
  'ADBE': 0.015, 'LIN': 0.015, 'QCOM': 0.012, 'TXN': 0.012, 'INTU': 0.012,
  'AMAT': 0.012, 'BKNG': 0.012, 'MU': 0.011, 'ARM': 0.010, 'PANW': 0.009,
};

// Contagion factor: 個股事件對同類股的擴散倍率
// 例：NVDA 跌 → AVGO/TSM 也會被拖下水 → QQQ 衝擊 > 單純權重 × move
const CONTAGION_PROFILES = {
  AI_LEADER: 1.80,       // NVDA / AVGO / TSM — AI 整片連動
  AI_BENEFICIARY: 1.40,  // 二線 AI 受益股
  MEGA_CAP: 1.30,        // AAPL / MSFT / GOOG — 個別拖累但非全板塊
  RIPPLE: 1.50,          // META — 給 AR/AI 板塊擴散
  STANDALONE: 1.00,      // 影響不擴散
};

const TICKER_PROFILE = {
  'NVDA': 'AI_LEADER', 'AVGO': 'AI_LEADER', 'TSM': 'AI_LEADER', 'AMD': 'AI_LEADER',
  'AAPL': 'MEGA_CAP', 'MSFT': 'MEGA_CAP', 'GOOGL': 'MEGA_CAP', 'GOOG': 'MEGA_CAP',
  'AMZN': 'MEGA_CAP',
  'META': 'RIPPLE',
  'TSLA': 'STANDALONE', 'NFLX': 'STANDALONE',
};

// Default demo portfolio (sums to ~$500K to match default portfolioValue)
const DEFAULT_POSITIONS = [
  { id: 1, ticker: 'QQQ', value: 180000 },
  { id: 2, ticker: 'NVDA', value: 80000 },
  { id: 3, ticker: 'AAPL', value: 50000 },
  { id: 4, ticker: 'MSFT', value: 50000 },
  { id: 5, ticker: 'AVGO', value: 40000 },
  { id: 6, ticker: 'TSM', value: 30000 },
  { id: 7, ticker: 'JPM', value: 20000 },
  { id: 8, ticker: 'CASH', value: 50000 },
];

// ────────────────────────────────────────────────────────────
// Lookup helpers
const getBeta = (ticker) => {
  const t = (ticker || '').toUpperCase().trim();
  if (t in STOCK_BETA) return STOCK_BETA[t];
  return 1.10; // unknown ticker → assume average growth tilt
};
const getQQQWeight = (ticker) => QQQ_WEIGHT[(ticker || '').toUpperCase()] ?? 0;
const getContagion = (ticker) => {
  const profile = TICKER_PROFILE[(ticker || '').toUpperCase()];
  return CONTAGION_PROFILES[profile] ?? CONTAGION_PROFILES.STANDALONE;
};

// ============================================================
// Number formatters
// ============================================================
const formatNum = (n, digits = 0) => {
  if (!isFinite(n)) return '—';
  return n.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
};

const formatMoney = (n) => {
  if (!isFinite(n)) return '—';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1_000_000) return sign + '$' + (abs / 1_000_000).toFixed(2) + 'M';
  if (abs >= 1_000) return sign + '$' + (abs / 1_000).toFixed(1) + 'K';
  return sign + '$' + abs.toFixed(0);
};

const formatPct = (n, digits = 1) => {
  if (!isFinite(n)) return '—';
  return (n * 100).toFixed(digits) + '%';
};

// ============================================================
// Calc helpers
// ============================================================

// VIX option vega 簡化估算
// 注意：VIX option 的 vega 對應的是 VVIX (vol of vol)
// 這裡用粗略 approximation：moneyness × DTE-decay factor × base vega
// 真正精確值需要 BS pricing on VIX (which is non-trivial because VIX has mean reversion)
function estimateVixVega(vixSpot, strike, daysRemaining) {
  const moneyness = vixSpot / strike;
  const dteFactor = Math.sqrt(Math.max(daysRemaining, 1) / 30);

  let baseVega;
  if (moneyness > 0.95 && moneyness < 1.10) baseVega = 0.075;       // ATM / slight ITM
  else if (moneyness < 0.85) baseVega = 0.035;                       // deep OTM
  else if (moneyness > 1.20) baseVega = 0.040;                       // deep ITM
  else baseVega = 0.060;                                              // moderate OTM

  return baseVega * dteFactor;
}

// 估算事件後 option 的「殘存價值」(intrinsic + small remaining time value)
// 用於 IV-aware mode 的更精確 P&L
function estimateOptionValueAfter(strike, vixEnd, ivAfter, daysRemainingAfter) {
  const intrinsic = Math.max(0, vixEnd - strike);
  // Time value 隨 IV 與 sqrt(DTE) 衰減
  // 粗估：ATM 時 time value ≈ 0.04 × IV × sqrt(DTE/30)
  const moneyness = vixEnd / strike;
  let tvFactor;
  if (moneyness > 0.95 && moneyness < 1.10) tvFactor = 0.04;
  else if (moneyness < 0.80) tvFactor = 0.005;
  else if (moneyness > 1.30) tvFactor = 0.005;
  else tvFactor = 0.02;
  const timeValue = tvFactor * (ivAfter / 100) * vixEnd * Math.sqrt(Math.max(daysRemainingAfter, 0.5) / 30);
  return intrinsic + timeValue;
}

// 計算單腿 P&L (per leg, vs initial premium paid/received)
function calcLegPnL(leg, vixEnd, ivAfter, ivBefore, daysRemainingAfter, mode) {
  const sign = leg.action === 'BUY' ? 1 : -1;

  if (mode === 'simple') {
    // 到期內在價值，跟原版邏輯一樣
    const intrinsic = Math.max(0, vixEnd - leg.strike) * 100;
    const initialDebit = leg.premium * 100;
    // BUY: P&L = intrinsic - premium ; SELL: P&L = premium - intrinsic
    // 共通公式：sign × (intrinsic - premium)
    return sign * (intrinsic - initialDebit) * leg.qty;
  }

  // IV-aware: 殘存價值 = intrinsic + time value (含 IV)
  const valueAfter = estimateOptionValueAfter(leg.strike, vixEnd, ivAfter, daysRemainingAfter) * 100;
  const initialPrice = leg.premium * 100;
  return sign * (valueAfter - initialPrice) * leg.qty;
}

// 計算整個策略的 P&L
function calcStrategyPnL(strategy, vixEnd, ivAfter, ivBefore, daysRemainingAfter, mode) {
  return strategy.legs.reduce((sum, leg) => {
    return sum + calcLegPnL(leg, vixEnd, ivAfter, ivBefore, daysRemainingAfter, mode);
  }, 0);
}

// 計算 portfolio weighted beta
function calcPortfolioBeta(positions) {
  const totalValue = positions.reduce((sum, p) => sum + (p.value || 0), 0);
  if (totalValue <= 0) return 1.0;
  const weightedSum = positions.reduce((sum, p) => {
    return sum + (p.value || 0) * getBeta(p.ticker);
  }, 0);
  return weightedSum / totalValue;
}

// 單股事件對 QQQ 的 stress impact
// expected QQQ gap = stock_implied_move × stock_QQQ_weight × contagion_factor
function calcStressImpact({ impliedMove, qqqWeight, contagion, portfolioValue, qqqExposurePct }) {
  const qqqGapPct = impliedMove * qqqWeight * contagion;
  const exposureValue = portfolioValue * qqqExposurePct;
  const expectedLoss = exposureValue * qqqGapPct;
  return { qqqGapPct, exposureValue, expectedLoss };
}

// 推算 QQQ Put 對沖建議
function suggestQQQPut({ qqqPrice, expectedGapPct, expectedLoss, otmPct }) {
  const strike = Math.round((qqqPrice * (1 - otmPct)) * 4) / 4; // round to nearest $0.25
  const qqqEnd = qqqPrice * (1 - expectedGapPct);
  const perContractGain = Math.max(0, (strike - qqqEnd)) * 100;

  // 估算 Put premium：粗估 weekly ATM put 約 0.7-1.2% of underlying
  // OTM 略低
  const ivProxy = 0.20; // assume QQQ implied vol ~20%
  const dte = 7; // assume weekly hedge
  const estPremium = qqqPrice * ivProxy * Math.sqrt(dte / 365) * 0.4; // BS-ish proxy
  const otmDiscount = Math.max(0.5, 1 - otmPct * 25); // OTM 越深越便宜
  const adjustedPremium = estPremium * otmDiscount;

  const contracts = perContractGain > 0 ? Math.ceil(expectedLoss / perContractGain) : 0;
  const totalCost = contracts * adjustedPremium * 100;

  return {
    strike,
    qqqEnd,
    perContractGain,
    estPremium: adjustedPremium,
    contracts,
    totalCost,
    coverageRatio: contracts > 0 && expectedLoss > 0
      ? (contracts * perContractGain) / expectedLoss
      : 0,
  };
}

// 策略推薦引擎
// 基於 IVR + DTE + event type 推薦最佳結構
function recommendStrategy({ ivr, daysToEvent, eventType }) {
  // Edge cases — 進場時機不對
  if (daysToEvent > 14) {
    return {
      id: null,
      label: '建議等待',
      reason: 'T-' + daysToEvent + ' 太早，IV 還沒升溫，過早建倉會被 theta 慢慢吃',
      confidence: 'WAIT',
      tone: 'wait',
    };
  }

  if (daysToEvent < 1) {
    return {
      id: null,
      label: '建議等待 / 不進場',
      reason: 'T-' + daysToEvent + ' 已晚，IV 已被推高到最貴，胃口差且事件後 IV crush 風險最大',
      confidence: 'WAIT',
      tone: 'wait',
    };
  }

  // 黃金窗口 T-7 ~ T-3 — 主要邏輯
  if (daysToEvent >= 3 && daysToEvent <= 7) {
    if (ivr >= 70) {
      return {
        id: 'spread_16_20',
        label: '推薦：16/20 Call Spread',
        reason: 'IVR ' + ivr + ' 高位 + T-' + daysToEvent + ' → Spread 雙腿抵消 vega 是抗 IV Crush 唯一解',
        confidence: 'HIGH',
        tone: 'go',
      };
    }
    if (ivr < 30) {
      return {
        id: 'mixed',
        label: '推薦：18C + 20C 混搭',
        reason: 'IVR ' + ivr + ' 低 + T-' + daysToEvent + ' → 純買方便宜，70% 主力 + 30% 樂透吃 vega 順風 + 黑天鵝彩券',
        confidence: 'HIGH',
        tone: 'go',
      };
    }
    return {
      id: 'spread_16_20',
      label: '推薦：16/20 Call Spread',
      reason: 'IVR ' + ivr + ' 中等 + T-' + daysToEvent + ' → Spread 平衡型，IV crush 風險受控且成本親民',
      confidence: 'MEDIUM',
      tone: 'go',
    };
  }

  // T-2 ~ T-1 IV 已經偏貴
  if (daysToEvent >= 1 && daysToEvent <= 2) {
    if (ivr >= 70) {
      return {
        id: 'spread_16_20',
        label: '推薦：16/20 Call Spread (謹慎)',
        reason: 'IVR ' + ivr + ' 已高 + T-' + daysToEvent + ' → 只能 Spread，純買方會被 IV crush 雙殺',
        confidence: 'MEDIUM',
        tone: 'caution',
      };
    }
    return {
      id: 'spread_16_20',
      label: '推薦：16/20 Call Spread',
      reason: 'T-' + daysToEvent + ' 接近事件，Spread 是僅存的安全選擇',
      confidence: 'MEDIUM',
      tone: 'caution',
    };
  }

  // T-8 ~ T-14 還可以早佈
  if (ivr < 40) {
    return {
      id: 'single_18',
      label: '推薦：純 18 Call',
      reason: 'T-' + daysToEvent + ' 早期 + IVR ' + ivr + ' 低 → 純買方還沒被推高，先卡位',
      confidence: 'MEDIUM',
      tone: 'go',
    };
  }
  return {
    id: 'spread_16_20',
    label: '推薦：16/20 Call Spread',
    reason: 'T-' + daysToEvent + ' + IVR ' + ivr + ' → Spread 平衡風險',
    confidence: 'MEDIUM',
    tone: 'go',
  };
}

function nextWeekdayISO(baseDate, targetDay) {
  const d = new Date(baseDate);
  d.setHours(12, 0, 0, 0);
  const diff = (targetDay - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

// ============================================================
// MAIN COMPONENT
// ============================================================
export default function VIXHedgeCalculator({
  externalPositions = null,
  externalHedgeBudgetBps = null,    // L2 → L1 hedge budget override
  externalMacroAlerts = null,        // L2 red alerts: array of { id, severity, name, ... }
  externalMacroScore = null,         // L2 weighted total score (0-100), optional context
  externalMacroBand = null,          // L2 position band info, optional context
  externalVIXSpot = null,            // L2 → L1 VIX spot price from Polygon
  workerUrl = 'https://solitary-wood-898d.justest521.workers.dev',  // for option chain fetch
}) {
  // ──────────────────────────────────────────────────────────
  // State: Inputs (existing v1)
  // ──────────────────────────────────────────────────────────
  const [portfolioValueManual, setPortfolioValueManual] = useState(500000);
  const [hedgeBudgetBps, setHedgeBudgetBps] = useState(externalHedgeBudgetBps ?? 30);

  // Sync L2 hedge budget if provided
  useEffect(() => {
    if (externalHedgeBudgetBps != null && isFinite(externalHedgeBudgetBps)) {
      setHedgeBudgetBps(externalHedgeBudgetBps);
    }
  }, [externalHedgeBudgetBps]);

  const [eventType, setEventType] = useState('FOMC');
  const [daysToEvent, setDaysToEvent] = useState(7);

  const [vixPrice, setVixPrice] = useState(16.36);
  const [vixIvRank, setVixIvRank] = useState(65);

  // Sync VIX spot from L2 Polygon
  useEffect(() => {
    if (externalVIXSpot != null && isFinite(externalVIXSpot)) {
      setVixPrice(externalVIXSpot);
    }
  }, [externalVIXSpot]);

  const [call16Premium, setCall16Premium] = useState(2.20);
  const [call18Premium, setCall18Premium] = useState(0.95);
  const [call20Premium, setCall20Premium] = useState(0.59);
  const [call22Premium, setCall22Premium] = useState(0.35);

  // VIX option chain auto-fill state
  const [chainStatus, setChainStatus] = useState('idle');  // 'idle' | 'fetching' | 'synced' | 'error'
  const [chainError, setChainError] = useState(null);
  const [chainSyncTime, setChainSyncTime] = useState(null);

  // Stress test (single stock) implied-move auto-fill state
  const [straddleStatus, setStraddleStatus] = useState('idle');
  const [straddleError, setStraddleError] = useState(null);
  const [straddleSyncTime, setStraddleSyncTime] = useState(null);

  const eventDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + daysToEvent);
    return d;
  }, [daysToEvent]);

  // VIX weekly options usually expire on Wednesdays; single-stock weeklies on Fridays.
  // Aligning to real option weekdays prevents the Polygon buttons from asking for
  // weekend expiries such as 2026-05-31.
  const targetExpiry = useMemo(() => nextWeekdayISO(eventDate, 3), [eventDate]);      // VIX call chain
  const stockTargetExpiry = useMemo(() => nextWeekdayISO(eventDate, 5), [eventDate]); // stock ATM straddle

  const fetchVIXChain = useCallback(async () => {
    setChainStatus('fetching');
    setChainError(null);
    try {
      const url = workerUrl + '/api/polygon/option-chain'
        + '?underlying=VIX&type=call&expiry=' + targetExpiry
        + '&strikes=16,18,20,22';
      const res = await fetch(url);
      if (!res.ok) {
        const text = await res.text();
        throw new Error('HTTP ' + res.status + ' — ' + text.slice(0, 150));
      }
      const data = await res.json();
      if (!data.contracts || data.contracts.length === 0) {
        throw new Error('No contracts found at expiry ' + targetExpiry + '. Try a different date.');
      }
      // Map strikes to setters
      const byStrike = {};
      data.contracts.forEach(c => { byStrike[Math.round(c.strike)] = c; });

      let appliedCount = 0;
      const apply = (strike, setter) => {
        const c = byStrike[strike];
        const premium = c?.premium ?? c?.mid ?? c?.lastPrice ?? c?.dayClose ?? c?.fmv;
        if (premium != null && premium > 0) {
          setter(parseFloat(premium.toFixed(2)));
          appliedCount += 1;
        }
      };
      apply(16, setCall16Premium);
      apply(18, setCall18Premium);
      apply(20, setCall20Premium);
      apply(22, setCall22Premium);

      if (appliedCount === 0) {
        throw new Error('Contracts found for ' + targetExpiry + ', but Polygon returned no bid/ask/last premium.');
      }

      setChainSyncTime(new Date());
      setChainStatus('synced');
    } catch (e) {
      console.error('[L1] VIX chain fetch error:', e);
      setChainError(e.message || String(e));
      setChainStatus('error');
    }
  }, [workerUrl, targetExpiry]);

  // Stress test: fetch ATM straddle for single stock → derive implied-move %
  const fetchStressStraddle = useCallback(async (ticker) => {
    setStraddleStatus('fetching');
    setStraddleError(null);
    try {
      const url = workerUrl + '/api/polygon/atm-straddle'
        + '?underlying=' + encodeURIComponent(ticker)
        + '&expiry=' + stockTargetExpiry;
      const res = await fetch(url);
      if (!res.ok) {
        const text = await res.text();
        throw new Error('HTTP ' + res.status + ' — ' + text.slice(0, 150));
      }
      const data = await res.json();
      const movePct = data.impliedMovePct ?? data.implied_move_pct ?? data.impliedMove;
      if (movePct == null || !isFinite(movePct)) {
        throw new Error('No implied move data returned for ' + ticker);
      }
      // Polygon returns either a fraction (0.08) or percent (8). Normalize to percent.
      const normalized = movePct < 1 ? movePct * 100 : movePct;
      setStressImpliedMove(parseFloat(normalized.toFixed(2)));
      setStraddleSyncTime(new Date());
      setStraddleStatus('synced');
    } catch (e) {
      console.error('[L1] Stress straddle fetch error:', e);
      setStraddleError(e.message || String(e));
      setStraddleStatus('error');
    }
  }, [workerUrl, stockTargetExpiry]);

  const [selectedStructure, setSelectedStructure] = useState('spread_16_20');

  // ──────────────────────────────────────────────────────────
  // State: NEW (v2)
  // ──────────────────────────────────────────────────────────
  // [A] IV Crush 二階修正
  const [pnlMode, setPnlMode] = useState('iv_aware');     // 'simple' | 'iv_aware'
  const [vixIvBefore, setVixIvBefore] = useState(95);     // VIX option implied vol pre-event (~ VVIX)
  const [vixIvAfter, setVixIvAfter] = useState(60);       // post-event IV after crush
  const [daysAfterEvent, setDaysAfterEvent] = useState(2); // DTE remaining after event

  // [C] Portfolio positions (auto from external or manual)
  const [positions, setPositions] = useState(externalPositions || DEFAULT_POSITIONS);
  const [autoSyncPV, setAutoSyncPV] = useState(true);
  const [newPosTicker, setNewPosTicker] = useState('');
  const [newPosValue, setNewPosValue] = useState('');

  // [B] Single stock stress test
  const [stressTicker, setStressTicker] = useState('NVDA');
  const [stressImpliedMove, setStressImpliedMove] = useState(8);    // %
  const [stressQQQWeight, setStressQQQWeight] = useState(9.0);      // %, auto-fill
  const [stressContagion, setStressContagion] = useState(1.8);      // auto-fill
  const [qqqPrice, setQqqPrice] = useState(500);
  const [qqqExposurePct, setQqqExposurePct] = useState(60);          // %
  const [qqqPutOTMPct, setQqqPutOTMPct] = useState(0.5);             // %

  // Sync stress ticker auto-fills
  useEffect(() => {
    const w = getQQQWeight(stressTicker);
    if (w > 0) setStressQQQWeight(w * 100);
    setStressContagion(getContagion(stressTicker));
  }, [stressTicker]);

  // Sync external positions if provided
  useEffect(() => {
    if (externalPositions && Array.isArray(externalPositions)) {
      setPositions(externalPositions);
    }
  }, [externalPositions]);

  // ──────────────────────────────────────────────────────────
  // Derived values
  // ──────────────────────────────────────────────────────────
  const positionsTotal = useMemo(
    () => positions.reduce((sum, p) => sum + (Number(p.value) || 0), 0),
    [positions]
  );

  const portfolioValue = autoSyncPV ? positionsTotal : portfolioValueManual;

  const portfolioBeta = useMemo(() => calcPortfolioBeta(positions), [positions]);

  const hedgeBudget = useMemo(
    () => portfolioValue * (hedgeBudgetBps / 10000),
    [portfolioValue, hedgeBudgetBps]
  );

  // VIX → portfolio sensitivity, scaled by portfolio beta
  // base coefficient: VIX +1 ≈ SPY -0.8% → portfolio impact = -0.008 × beta
  const vixToPortfolioBeta = -0.008 * portfolioBeta;

  // Recommendation engine
  const recommendation = useMemo(
    () => recommendStrategy({ ivr: vixIvRank, daysToEvent, eventType }),
    [vixIvRank, daysToEvent, eventType]
  );

  // Auto-select recommended strategy on first load if user hasn't manually selected
  // (We let manual selection take precedence after they click)

  // ──────────────────────────────────────────────────────────
  // Strategies (existing logic, unchanged structure)
  // ──────────────────────────────────────────────────────────
  const stratA = useMemo(() => {
    const contracts = Math.floor(hedgeBudget / (call18Premium * 100));
    const actualCost = contracts * call18Premium * 100;
    return {
      id: 'single_18',
      name: '純 18 Call',
      nameEn: 'Single OTM Call',
      desc: '成本低、槓桿適中、主力保險',
      contracts,
      cost: actualCost,
      legs: [{ action: 'BUY', qty: contracts, strike: 18, premium: call18Premium }],
      maxLoss: actualCost,
      breakeven: 18 + call18Premium,
      ivCrushRisk: 'HIGH',
      ivCrushColor: '#ef4444',
      protection: 'linear',
      deltaEst: 0.35 * contracts,
      // Pre-compute net vega (positive = long vega, hurt by IV crush)
      netVega: estimateVixVega(vixPrice, 18, daysToEvent + daysAfterEvent) * contracts,
    };
  }, [hedgeBudget, call18Premium, vixPrice, daysToEvent, daysAfterEvent]);

  const stratB = useMemo(() => {
    const netDebit = call16Premium - call20Premium;
    const contracts = Math.floor(hedgeBudget / (netDebit * 100));
    const actualCost = contracts * netDebit * 100;
    const maxProfitPerContract = (20 - 16 - netDebit) * 100;
    const maxProfit = contracts * maxProfitPerContract;
    const totalDte = daysToEvent + daysAfterEvent;
    const longVega = estimateVixVega(vixPrice, 16, totalDte) * contracts;
    const shortVega = estimateVixVega(vixPrice, 20, totalDte) * contracts;
    return {
      id: 'spread_16_20',
      name: '16/20 Call Spread',
      nameEn: 'Call Spread (抗 IV Crush)',
      desc: '配合 200MA 壓力、雙腿抵消 vega',
      contracts,
      cost: actualCost,
      netDebit,
      legs: [
        { action: 'BUY', qty: contracts, strike: 16, premium: call16Premium },
        { action: 'SELL', qty: contracts, strike: 20, premium: call20Premium },
      ],
      maxLoss: actualCost,
      maxProfit,
      capAtStrike: 20,
      breakeven: 16 + netDebit,
      ivCrushRisk: 'LOW',
      ivCrushColor: '#10b981',
      protection: 'capped',
      netVega: longVega - shortVega,
    };
  }, [hedgeBudget, call16Premium, call20Premium, vixPrice, daysToEvent, daysAfterEvent]);

  const stratC = useMemo(() => {
    const mainBudget = hedgeBudget * 0.7;
    const lottoBudget = hedgeBudget * 0.3;
    const mainContracts = Math.floor(mainBudget / (call18Premium * 100));
    const lottoContracts = Math.floor(lottoBudget / (call20Premium * 100));
    const actualCost = mainContracts * call18Premium * 100 + lottoContracts * call20Premium * 100;
    const totalDte = daysToEvent + daysAfterEvent;
    const vegaMain = estimateVixVega(vixPrice, 18, totalDte) * mainContracts;
    const vegaLotto = estimateVixVega(vixPrice, 20, totalDte) * lottoContracts;
    return {
      id: 'mixed',
      name: '18C + 20C 混搭',
      nameEn: 'Mixed (Main + Lottery)',
      desc: '70% 主力保險 + 30% 黑天鵝彩券',
      contracts: mainContracts + lottoContracts,
      mainContracts,
      lottoContracts,
      cost: actualCost,
      legs: [
        { action: 'BUY', qty: mainContracts, strike: 18, premium: call18Premium },
        { action: 'BUY', qty: lottoContracts, strike: 20, premium: call20Premium },
      ],
      maxLoss: actualCost,
      breakeven: 18 + call18Premium,
      ivCrushRisk: 'HIGH',
      ivCrushColor: '#ef4444',
      protection: 'asymmetric',
      netVega: vegaMain + vegaLotto,
    };
  }, [hedgeBudget, call18Premium, call20Premium, vixPrice, daysToEvent, daysAfterEvent]);

  const strategies = { single_18: stratA, spread_16_20: stratB, mixed: stratC };

  // ──────────────────────────────────────────────────────────
  // Scenario P&L (modified to support iv_aware mode)
  // ──────────────────────────────────────────────────────────
  const vixScenarios = useMemo(() => {
    const baseScenarios = [
      { end: 13, desc: 'Fed 大鴿 / 市場大鬆口氣', portfolioImpactBase: 0.009 },
      { end: 15, desc: '平淡 / 預期內', portfolioImpactBase: 0.003 },
      { end: vixPrice, desc: '持平', portfolioImpactBase: 0 },
      { end: 18, desc: '小波動', portfolioImpactBase: -0.013 },
      { end: 20, desc: '中波動 / 鷹派', portfolioImpactBase: -0.029 },
      { end: 23, desc: '黑天鵝 / 崩盤', portfolioImpactBase: -0.053 },
      { end: 28, desc: '雷曼級恐慌', portfolioImpactBase: -0.093 },
    ];
    return baseScenarios.map((s) => {
      // Portfolio impact scaled by portfolio beta (NEW: dynamic, not hard-coded)
      const portfolioImpact = s.portfolioImpactBase * portfolioBeta;
      const pnl_A = calcStrategyPnL(stratA, s.end, vixIvAfter, vixIvBefore, daysAfterEvent, pnlMode);
      const pnl_B = calcStrategyPnL(stratB, s.end, vixIvAfter, vixIvBefore, daysAfterEvent, pnlMode);
      const pnl_C = calcStrategyPnL(stratC, s.end, vixIvAfter, vixIvBefore, daysAfterEvent, pnlMode);
      const portLoss = portfolioValue * portfolioImpact;
      return {
        ...s,
        portfolioImpact,
        pnl_A,
        pnl_B,
        pnl_C,
        portLoss,
        netA: portLoss + pnl_A,
        netB: portLoss + pnl_B,
        netC: portLoss + pnl_C,
      };
    });
  }, [stratA, stratB, stratC, vixPrice, vixIvAfter, vixIvBefore, daysAfterEvent, pnlMode, portfolioBeta, portfolioValue]);

  // ──────────────────────────────────────────────────────────
  // Stress test calc
  // ──────────────────────────────────────────────────────────
  const stressResult = useMemo(() => calcStressImpact({
    impliedMove: stressImpliedMove / 100,
    qqqWeight: stressQQQWeight / 100,
    contagion: stressContagion,
    portfolioValue,
    qqqExposurePct: qqqExposurePct / 100,
  }), [stressImpliedMove, stressQQQWeight, stressContagion, portfolioValue, qqqExposurePct]);

  const qqqPutSuggestion = useMemo(() => suggestQQQPut({
    qqqPrice,
    expectedGapPct: stressResult.qqqGapPct,
    expectedLoss: stressResult.expectedLoss,
    otmPct: qqqPutOTMPct / 100,
  }), [qqqPrice, stressResult, qqqPutOTMPct]);

  // ──────────────────────────────────────────────────────────
  // Position handlers
  // ──────────────────────────────────────────────────────────
  const handleAddPosition = () => {
    const ticker = newPosTicker.trim().toUpperCase();
    const value = Number(newPosValue);
    if (!ticker || !isFinite(value) || value <= 0) return;
    setPositions([...positions, {
      id: Date.now(),
      ticker,
      value,
    }]);
    setNewPosTicker('');
    setNewPosValue('');
  };

  const handleDeletePosition = (id) => {
    setPositions(positions.filter((p) => p.id !== id));
  };

  const handleUpdatePosition = (id, field, value) => {
    setPositions(positions.map((p) =>
      p.id === id ? { ...p, [field]: field === 'value' ? Number(value) || 0 : value } : p
    ));
  };

  // ============================================================
  // RENDER
  // ============================================================
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: styleSheet }} />
      <div className="bg-app text-primary font-tc" style={{ minHeight: '100vh' }}>
        {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ Header */}
        <div className="hair-border-b" style={{ padding: '20px 28px' }}>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div style={{ position: 'relative' }}>
                <Shield size={22} className="text-accent" />
                <div className="pulse-dot" style={{ position: 'absolute', top: '-2px', right: '-3px' }} />
              </div>
              <div>
                <div className="font-tc font-bold text-primary" style={{ fontSize: '17px', letterSpacing: '0.02em' }}>
                  VIX Hedge Calculator <span className="text-accent" style={{ fontSize: '13px' }}>v2</span>
                </div>
                <div className="text-xs text-muted font-mono-dm" style={{ letterSpacing: '0.05em' }}>
                  L1 組合對沖 · IV 感知 · 壓力測試 · Beta 縮放
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3 text-xs font-mono-dm text-muted">
              <span>VIX <span className="text-accent">{vixPrice.toFixed(2)}</span></span>
              <span className="text-muted-2">·</span>
              <span>IVR <span className="text-accent">{vixIvRank}</span></span>
              <span className="text-muted-2">·</span>
              <span>β <span className="text-accent">{portfolioBeta.toFixed(2)}</span></span>
              <span className="text-muted-2">·</span>
              <span>T-<span className="text-accent">{daysToEvent}</span></span>
            </div>
          </div>
        </div>

        {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ Main Grid */}
        <div
          className="main-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: '340px 1fr',
            gap: '0',
          }}
        >
          {/* ────────────────────────────── LEFT: Sticky Inputs */}
          <div className="hair-border-r bg-card" style={{
            padding: '20px',
            position: 'sticky',
            top: 0,
            alignSelf: 'flex-start',
            maxHeight: '100vh',
            overflowY: 'auto',
          }}>
            {/* Section: Portfolio */}
            <div className="section-title">
              <DollarSign size={13} className="text-accent" />
              <span className="font-mono-dm text-xs text-muted" style={{ letterSpacing: '0.1em' }}>投資組合</span>
            </div>

            <div className="mb-4">
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-muted font-tc">總價值（auto: 持倉合計）</label>
                <button
                  onClick={() => setAutoSyncPV(!autoSyncPV)}
                  className="icon-btn"
                  style={{ fontSize: '9px', padding: '2px 6px' }}
                >
                  {autoSyncPV ? 'AUTO' : 'MANUAL'}
                </button>
              </div>
              {autoSyncPV ? (
                <div className="bg-subcard hair-border" style={{
                  padding: '8px 10px',
                  borderRadius: '4px',
                }}>
                  <div className="font-mono-dm tabular text-accent" style={{ fontSize: '18px', fontWeight: 500 }}>
                    {formatMoney(positionsTotal)}
                  </div>
                  <div className="text-xs text-muted-2 font-mono-dm" style={{ marginTop: '2px' }}>
                    {positions.length} positions · β {portfolioBeta.toFixed(2)}
                  </div>
                </div>
              ) : (
                <input
                  type="number"
                  value={portfolioValueManual}
                  onChange={(e) => setPortfolioValueManual(Number(e.target.value))}
                  className="num-input"
                />
              )}
            </div>

            <div className="mb-4">
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-muted font-tc">避險預算</label>
                <span className="font-mono-dm tabular text-accent text-xs">
                  {hedgeBudgetBps} bps · {formatMoney(hedgeBudget)}
                </span>
              </div>
              <input
                type="range"
                min="10"
                max="100"
                step="5"
                value={hedgeBudgetBps}
                onChange={(e) => setHedgeBudgetBps(Number(e.target.value))}
                style={{ width: '100%' }}
              />
              <div className="flex justify-between text-xs text-muted-2 font-mono-dm mt-1">
                <span>10 bps</span><span>50</span><span>100</span>
              </div>
            </div>

            {/* Section: Event */}
            <div className="section-title" style={{ marginTop: '24px' }}>
              <Clock size={13} className="text-accent" />
              <span className="font-mono-dm text-xs text-muted" style={{ letterSpacing: '0.1em' }}>EVENT</span>
            </div>

            <div className="mb-4">
              <label className="text-xs text-muted font-tc block mb-1">事件類型</label>
              <select
                value={eventType}
                onChange={(e) => setEventType(e.target.value)}
                className="num-input"
                style={{ padding: '6px 10px' }}
              >
                <option value="FOMC">FOMC（聯準會）</option>
                <option value="CPI">CPI（通膨數據）</option>
                <option value="EARNINGS">財報季</option>
                <option value="ELECTION">政治事件</option>
                <option value="OTHER">其他</option>
              </select>
            </div>

            <div className="mb-4">
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-muted font-tc">距事件天數</label>
                <span className="font-mono-dm tabular text-accent text-xs">T-{daysToEvent}</span>
              </div>
              <input
                type="range"
                min="0"
                max="21"
                step="1"
                value={daysToEvent}
                onChange={(e) => setDaysToEvent(Number(e.target.value))}
                style={{ width: '100%' }}
              />
              <div className="flex justify-between text-xs text-muted-2 font-mono-dm mt-1">
                <span>T-0</span><span>T-7</span><span>T-14</span><span>T-21</span>
              </div>
            </div>

            {/* Section: VIX */}
            <div className="section-title" style={{ marginTop: '24px' }}>
              <Activity size={13} className="text-accent" />
              <span className="font-mono-dm text-xs text-muted" style={{ letterSpacing: '0.1em' }}>VIX</span>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-4">
              <div>
                <label className="text-xs text-muted font-tc block mb-1">現價</label>
                <input
                  type="number"
                  step="0.01"
                  value={vixPrice}
                  onChange={(e) => setVixPrice(Number(e.target.value))}
                  className="num-input"
                />
              </div>
              <div>
                <label className="text-xs text-muted font-tc block mb-1">IV Rank</label>
                <input
                  type="number"
                  step="1"
                  min="0"
                  max="100"
                  value={vixIvRank}
                  onChange={(e) => setVixIvRank(Number(e.target.value))}
                  className="num-input"
                />
              </div>
            </div>

            {/* Section: IV Crush 模型參數 */}
            <div className="section-title" style={{ marginTop: '24px' }}>
              <Wind size={13} className="text-accent" />
              <span className="font-mono-dm text-xs text-muted" style={{ letterSpacing: '0.1em' }}>IV CRUSH MODEL</span>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="text-xs text-muted font-tc block mb-1">事件前 IV</label>
                <input
                  type="number"
                  step="1"
                  value={vixIvBefore}
                  onChange={(e) => setVixIvBefore(Number(e.target.value))}
                  className="num-input"
                />
              </div>
              <div>
                <label className="text-xs text-muted font-tc block mb-1">事件後 IV</label>
                <input
                  type="number"
                  step="1"
                  value={vixIvAfter}
                  onChange={(e) => setVixIvAfter(Number(e.target.value))}
                  className="num-input"
                  style={{ borderColor: vixIvAfter < vixIvBefore - 20 ? '#ef4444' : '#2a2a2a' }}
                />
              </div>
            </div>
            <div className="mb-3">
              <label className="text-xs text-muted font-tc block mb-1">事件後剩餘 DTE</label>
              <input
                type="number"
                step="1"
                min="0"
                value={daysAfterEvent}
                onChange={(e) => setDaysAfterEvent(Number(e.target.value))}
                className="num-input"
              />
            </div>
            <div className="bg-subcard hair-border text-xs text-muted-2 font-tc" style={{
              padding: '6px 8px', borderRadius: '4px', fontSize: '10px', lineHeight: 1.5,
            }}>
              IV 從 {vixIvBefore} → {vixIvAfter}（Δ {(vixIvAfter - vixIvBefore).toFixed(0)}），影響事件後剩餘時間價值
            </div>

            {/* Section: Option Chain */}
            <div className="section-title" style={{ marginTop: '24px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Layers size={13} className="text-accent" />
              <span className="font-mono-dm text-xs text-muted" style={{ letterSpacing: '0.1em' }}>VIX CALL CHAIN</span>
              <button
                onClick={fetchVIXChain}
                disabled={chainStatus === 'fetching'}
                style={{
                  marginLeft: 'auto',
                  fontSize: '10px',
                  padding: '3px 8px',
                  borderRadius: '3px',
                  border: '1px solid ' + (chainStatus === 'error' ? '#ef4444' : chainStatus === 'synced' ? '#10b981' : '#2a2a2a'),
                  background: 'transparent',
                  color: chainStatus === 'error' ? '#ef4444' : chainStatus === 'synced' ? '#10b981' : '#EAB308',
                  cursor: chainStatus === 'fetching' ? 'wait' : 'pointer',
                  fontFamily: 'DM Mono',
                  letterSpacing: '0.05em',
                }}
                title={'從 Polygon 抓 ' + targetExpiry + ' 到期的 16/18/20/22C premium'}
              >
                {chainStatus === 'fetching' ? '⋯ 抓取中' : chainStatus === 'synced' ? '✓ 已同步' : chainStatus === 'error' ? '✕ 失敗' : '↻ 從 Polygon 自動填'}
              </button>
            </div>
            {chainStatus === 'synced' && chainSyncTime && (
              <div style={{ fontSize: '10px', color: '#888', fontFamily: 'DM Mono', marginTop: '4px', marginBottom: '6px' }}>
                expiry {targetExpiry} · {Math.round((Date.now() - chainSyncTime.getTime()) / 1000)}s ago
              </div>
            )}
            {chainStatus === 'error' && chainError && (
              <div style={{ fontSize: '10px', color: '#ef4444', marginTop: '4px', marginBottom: '6px', lineHeight: '1.4' }}>
                {chainError.slice(0, 120)}
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <PremiumInput label="16C" value={call16Premium} onChange={setCall16Premium} />
              <PremiumInput label="18C" value={call18Premium} onChange={setCall18Premium} accent />
              <PremiumInput label="20C" value={call20Premium} onChange={setCall20Premium} />
              <PremiumInput label="22C" value={call22Premium} onChange={setCall22Premium} muted />
            </div>
          </div>

          {/* ────────────────────────────── RIGHT: Main Content */}
          <div style={{ padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: '24px' }}>

            {/* ═══════════════════════════════════════ L2 Macro Context (if provided) */}
            {(externalMacroScore != null || (externalMacroAlerts && externalMacroAlerts.length > 0)) && (
              <MacroContextBanner
                score={externalMacroScore}
                band={externalMacroBand}
                alerts={externalMacroAlerts || []}
                hedgeBudgetBps={externalHedgeBudgetBps}
              />
            )}

            {/* ═══════════════════════════════════════ Recommendation Banner */}
            <RecommendationBanner
              rec={recommendation}
              onApply={(id) => id && setSelectedStructure(id)}
              currentSelection={selectedStructure}
              ivr={vixIvRank}
              dte={daysToEvent}
              eventType={eventType}
            />

            {/* ═══════════════════════════════════════ Strategy Cards */}
            <div>
              <div className="section-title">
                <Shield size={14} className="text-accent" />
                <span className="font-tc font-bold text-primary" style={{ fontSize: '14px' }}>避險策略選擇</span>
                <span className="text-xs text-muted-2 font-mono-dm" style={{ marginLeft: 'auto' }}>
                  3 STRUCTURES
                </span>
              </div>

              <div className="grid grid-cols-3 gap-3" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
                <StrategyCard
                  id="single_18"
                  strat={stratA}
                  selected={selectedStructure === 'single_18'}
                  onSelect={setSelectedStructure}
                  badge="A · LINEAR"
                  recommended={recommendation.id === 'single_18'}
                />
                <StrategyCard
                  id="spread_16_20"
                  strat={stratB}
                  selected={selectedStructure === 'spread_16_20'}
                  onSelect={setSelectedStructure}
                  badge="B · SPREAD"
                  recommended={recommendation.id === 'spread_16_20'}
                />
                <StrategyCard
                  id="mixed"
                  strat={stratC}
                  selected={selectedStructure === 'mixed'}
                  onSelect={setSelectedStructure}
                  badge="C · MIXED"
                  recommended={recommendation.id === 'mixed'}
                />
              </div>

              {/* Net Vega indicator */}
              <div className="mt-3 grid grid-cols-3 gap-3" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
                <VegaImpactBadge strat={stratA} ivDelta={vixIvAfter - vixIvBefore} />
                <VegaImpactBadge strat={stratB} ivDelta={vixIvAfter - vixIvBefore} />
                <VegaImpactBadge strat={stratC} ivDelta={vixIvAfter - vixIvBefore} />
              </div>
            </div>

            {/* ═══════════════════════════════════════ Scenarios Table */}
            <div className="bg-card hair-border" style={{ borderRadius: '6px', padding: '18px' }}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <BarChart3 size={14} className="text-accent" />
                  <span className="font-tc font-bold text-primary text-sm">情境 P&L 分析</span>
                  <HelpTooltip text={'三個 macro scenario 的持倉 P&L 推算：\n\n樂觀 (+5% SPX)：預估獲利\n基準 (持平)：時間衰減成本\n悲觀 (–5% SPX)：最大回撤估算\n\n含 Greek 計算：\n損益 ≈ Delta × Beta × ΔSPX × 持倉值'} />
                </div>
                <PnLModeToggle mode={pnlMode} setMode={setPnlMode} />
              </div>
              <div style={{ fontSize: '11px', color: '#9ca3af', fontFamily: 'Noto Sans TC', lineHeight: '1.55', marginTop: '-4px', marginBottom: '14px' }}>
                ▸ 在不同 macro scenario（樂觀／基準／悲觀）下，目前持倉組合的盈虧推算與最大回撤估算。
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }} className="font-mono-dm tabular">
                  <thead>
                    <tr className="hair-border-b">
                      <th style={{ textAlign: 'left', padding: '8px 6px', color: '#888', fontWeight: 500 }}>情境</th>
                      <th style={{ textAlign: 'right', padding: '8px 6px', color: '#888', fontWeight: 500 }}>VIX 收</th>
                      <th style={{ textAlign: 'right', padding: '8px 6px', color: '#888', fontWeight: 500 }}>組合衝擊</th>
                      <th style={{ textAlign: 'right', padding: '8px 6px', color: '#888', fontWeight: 500 }}>A 純買</th>
                      <th style={{ textAlign: 'right', padding: '8px 6px', color: '#888', fontWeight: 500 }}>B Spread</th>
                      <th style={{ textAlign: 'right', padding: '8px 6px', color: '#888', fontWeight: 500 }}>C 混搭</th>
                      <th style={{ textAlign: 'right', padding: '8px 6px', color: '#EAB308', fontWeight: 500 }}>淨 (選中)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vixScenarios.map((s, idx) => {
                      const selectedNet = selectedStructure === 'single_18' ? s.netA :
                                          selectedStructure === 'spread_16_20' ? s.netB : s.netC;
                      return (
                        <tr key={idx} className="hair-border-b pos-row">
                          <td style={{ padding: '8px 6px' }} className="font-tc text-xs text-primary">{s.desc}</td>
                          <td style={{ padding: '8px 6px', textAlign: 'right', color: '#f4f4f4' }}>{s.end.toFixed(2)}</td>
                          <td style={{ padding: '8px 6px', textAlign: 'right' }}>
                            <span style={{ color: s.portfolioImpact < 0 ? '#ef4444' : s.portfolioImpact > 0 ? '#10b981' : '#555' }}>
                              {(s.portfolioImpact * 100).toFixed(2)}%
                            </span>
                          </td>
                          <td style={{ padding: '8px 6px', textAlign: 'right' }}>
                            <PnLCell value={s.pnl_A} />
                          </td>
                          <td style={{ padding: '8px 6px', textAlign: 'right' }}>
                            <PnLCell value={s.pnl_B} />
                          </td>
                          <td style={{ padding: '8px 6px', textAlign: 'right' }}>
                            <PnLCell value={s.pnl_C} />
                          </td>
                          <td style={{ padding: '8px 6px', textAlign: 'right' }}>
                            <PnLCell value={selectedNet} highlight />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="mt-3 text-xs text-muted-2 font-tc" style={{ fontSize: '10.5px', lineHeight: 1.5 }}>
                {pnlMode === 'simple' ? (
                  <>「Simple」模式：到期內在價值，不計 IV crush 與時間價值。適合「持有到到期」且 VIX 大漲的情境。</>
                ) : (
                  <>「IV-Aware」模式：含事件後 IV 從 {vixIvBefore} → {vixIvAfter} 的時間價值衰減 + 殘存 {daysAfterEvent} DTE。Spread 因 net vega 接近 0，IV crush 影響小。</>
                )}
              </div>
            </div>

            {/* ═══════════════════════════════════════ Portfolio Beta Section */}
            <PortfolioBetaSection
              positions={positions}
              positionsTotal={positionsTotal}
              portfolioBeta={portfolioBeta}
              vixToPortfolioBeta={vixToPortfolioBeta}
              externalConnected={!!externalPositions}
              newPosTicker={newPosTicker}
              setNewPosTicker={setNewPosTicker}
              newPosValue={newPosValue}
              setNewPosValue={setNewPosValue}
              onAdd={handleAddPosition}
              onDelete={handleDeletePosition}
              onUpdate={handleUpdatePosition}
            />

            {/* ═══════════════════════════════════════ Single Stock Stress Test */}
            <StockStressSection
              stressTicker={stressTicker}
              setStressTicker={setStressTicker}
              stressImpliedMove={stressImpliedMove}
              setStressImpliedMove={setStressImpliedMove}
              fetchStressStraddle={fetchStressStraddle}
              straddleStatus={straddleStatus}
              straddleError={straddleError}
              straddleSyncTime={straddleSyncTime}
              targetExpiry={stockTargetExpiry}
              stressQQQWeight={stressQQQWeight}
              setStressQQQWeight={setStressQQQWeight}
              stressContagion={stressContagion}
              setStressContagion={setStressContagion}
              qqqPrice={qqqPrice}
              setQqqPrice={setQqqPrice}
              qqqExposurePct={qqqExposurePct}
              setQqqExposurePct={setQqqExposurePct}
              qqqPutOTMPct={qqqPutOTMPct}
              setQqqPutOTMPct={setQqqPutOTMPct}
              stressResult={stressResult}
              qqqPutSuggestion={qqqPutSuggestion}
              portfolioValue={portfolioValue}
            />

            {/* ═══════════════════════════════════════ Timing Checklist */}
            <div className="bg-card hair-border" style={{ borderRadius: '6px', padding: '18px' }}>
              <div className="section-title" style={{ marginBottom: '12px', paddingBottom: '8px' }}>
                <Clock size={14} className="text-accent" />
                <span className="font-tc font-bold text-primary text-sm">進場時機紀律</span>
                <HelpTooltip text={'T-N 天執行檢核表：\n\nT–7：觀察 IV / 波動率變化\nT–3：確認 catalyst 強度\nT–1：開倉 / 加碼最後機會\nT+0：事件當日決策\nT+1：結算 / 停損\n\n避免「事件前慌張開倉、事件後遲遲不停損」'} />
                <span className="text-xs text-muted-2 font-mono-dm" style={{ marginLeft: 'auto' }}>T-{daysToEvent}</span>
              </div>
              <div style={{ fontSize: '11px', color: '#9ca3af', fontFamily: 'Noto Sans TC', lineHeight: '1.55', marginTop: '-4px', marginBottom: '12px' }}>
                ▸ 距事件 T-N 天的進場節奏檢核 — 提醒何時該開倉、加碼、停損，避免情緒化操作。
              </div>
              <div className="grid grid-cols-1 gap-2">
                <TimingRow
                  label="T-14 之外（太早，IV 還沒升溫）"
                  status={daysToEvent <= 14}
                  tip="過早建倉會被 theta 慢慢吃掉"
                />
                <TimingRow
                  label="T-7 ~ T-3 黃金佈局窗口"
                  status={daysToEvent >= 3 && daysToEvent <= 7}
                  tip="IV 升溫但未到峰值，胃口最佳"
                />
                <TimingRow
                  label="T-1 之內（已晚，IV 推到最高）"
                  status={daysToEvent <= 1}
                  tip="避免事件公布前 IV 最後衝高，IV crush 風險最大"
                />
                <TimingRow
                  label="事件後 IV Crush 前分批落袋"
                  status={true}
                  tip="事件後 VIX 若衝高到 19-20 → 立刻部分獲利"
                />
                <TimingRow
                  label="最晚持有到下週五（三巫日後）"
                  status={daysToEvent <= 10}
                  tip="短天期避險不應跨月"
                />
              </div>
            </div>

            {/* ═══════════════════════════════════════ Modeling Notes */}
            <div className="bg-deepcard hair-border" style={{ borderRadius: '6px', padding: '14px 18px' }}>
              <div className="flex items-start gap-2">
                <Info size={13} className="text-muted" style={{ marginTop: '3px', flexShrink: 0 }} />
                <div className="text-xs text-muted font-tc" style={{ lineHeight: 1.7 }}>
                  <div className="mb-2 font-mono-dm text-muted-2" style={{ fontSize: '9.5px', letterSpacing: '0.12em' }}>MODEL ASSUMPTIONS · v2</div>
                  <div className="mb-1.5">
                    <span className="text-accent font-mono-dm" style={{ fontSize: '10.5px' }}>[A] IV-Aware P&L</span>
                    {' — '}使用 vega-shortcut（base vega × moneyness × √(DTE/30)）估算殘存時間價值。**非 Black-Scholes pricing**；VIX 期權真實 vega 需考慮 mean reversion 與 VVIX。誤差量級 ±15-25%。
                  </div>
                  <div className="mb-1.5">
                    <span className="text-accent font-mono-dm" style={{ fontSize: '10.5px' }}>[B] Single Stock Stress</span>
                    {' — '}用 implied move × QQQ權重 × contagion 簡化估算。沒有 cross-sectional vol surface、沒有 sector ETF spillover modeling。實際單股事件對指數衝擊可能差 ±30%。
                  </div>
                  <div className="mb-1.5">
                    <span className="text-accent font-mono-dm" style={{ fontSize: '10.5px' }}>[C] Portfolio Beta</span>
                    {' — '}用內建 lookup table 的 to-SPY beta，找不到的 ticker 預設 1.10。Beta 是歷史平均，事件期間個股 beta 會大幅偏離（例如 NVDA 財報日 beta 可能瞬間到 3+）。
                  </div>
                  <div>
                    <span className="text-accent font-mono-dm" style={{ fontSize: '10.5px' }}>[D] Recommendation Engine</span>
                    {' — '}只看 IVR + DTE + event type。沒看 GEX、term structure、skew、機構 positioning。建議當作「初稿選擇」而非最終決策。
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="hair-border-t text-xs text-muted-2 font-mono-dm" style={{ padding: '16px 28px' }}>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <span>MEP / Portfolio Layer · VIX Hedge Calculator v2 · 基於 MimiVsJames 2025-09-17 教學</span>
            <span>避險不是投機 — 成本最小化下的尾部保護</span>
          </div>
        </div>
      </div>

      <style>{`
        @media (max-width: 900px) {
          .main-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </>
  );
}

// ════════════════════════════════════════════════════════════
// SUB-COMPONENTS
// ════════════════════════════════════════════════════════════

// ────────────────────────────── Strategy Card (existing, slightly enhanced)
function StrategyCard({ id, strat, selected, onSelect, badge, recommended }) {
  return (
    <div
      onClick={() => onSelect(id)}
      className={'bg-card hair-border strategy-card ' + (selected ? 'selected' : '')}
      style={{
        borderRadius: '6px',
        padding: '14px 16px',
        cursor: 'pointer',
        position: 'relative',
      }}
    >
      {recommended && (
        <div
          style={{
            position: 'absolute',
            top: '-7px',
            right: '12px',
            background: '#EAB308',
            color: '#0f0f0f',
            fontSize: '9px',
            fontWeight: 700,
            padding: '2px 6px',
            borderRadius: '3px',
            letterSpacing: '0.1em',
            fontFamily: 'DM Mono',
          }}
        >
          ★ RECOMMENDED
        </div>
      )}
      <div className="flex items-center justify-between mb-2">
        <span
          className="font-mono-dm"
          style={{
            fontSize: '10px',
            padding: '2px 6px',
            borderRadius: '3px',
            background: '#242424',
            color: '#888',
            letterSpacing: '0.08em',
          }}
        >
          {badge}
        </span>
        <span className="text-xs font-mono-dm" style={{ color: strat.ivCrushColor }}>
          IV crush: {strat.ivCrushRisk}
        </span>
      </div>
      <div className="font-bold text-sm text-primary mb-1" style={{ fontFamily: 'Noto Sans TC' }}>
        {strat.name}
      </div>
      <div className="text-xs text-muted mb-3 font-tc" style={{ fontSize: '10.5px', lineHeight: 1.4 }}>
        {strat.desc}
      </div>
      <div className="hair-border-t" style={{ paddingTop: '10px' }}>
        <div className="flex justify-between items-baseline">
          <span className="text-xs text-muted">口數</span>
          <span className="font-mono-dm tabular text-accent" style={{ fontSize: '20px', fontWeight: 500 }}>
            {strat.contracts}
          </span>
        </div>
        <div className="flex justify-between items-baseline mt-1">
          <span className="text-xs text-muted">支出</span>
          <span className="font-mono-dm tabular text-primary text-sm">
            {formatMoney(strat.cost)}
          </span>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────── Recommendation Banner (NEW)
function RecommendationBanner({ rec, onApply, currentSelection, ivr, dte, eventType }) {
  const isWait = rec.tone === 'wait';
  const isCaution = rec.tone === 'caution';
  const isApplied = rec.id === currentSelection;

  const bgClass = isWait ? 'rec-banner-wait' : 'rec-banner';
  const iconColor = isWait ? '#888' : isCaution ? '#fb923c' : '#EAB308';
  const Icon = isWait ? Clock : isCaution ? AlertTriangle : Sparkles;

  return (
    <div className={bgClass} style={{ borderRadius: '6px', padding: '16px 20px' }}>
      <div className="flex items-start gap-3">
        <div style={{ marginTop: '2px' }}>
          <Icon size={18} style={{ color: iconColor }} />
        </div>
        <div className="flex-1">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="font-mono-dm text-xs text-muted-2" style={{ letterSpacing: '0.12em', marginBottom: '3px' }}>
                STRATEGY RECOMMENDATION ENGINE
              </div>
              <div className="font-tc font-bold text-primary" style={{ fontSize: '15px' }}>
                {rec.label}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span
                className="font-mono-dm"
                style={{
                  fontSize: '10px',
                  padding: '3px 8px',
                  borderRadius: '3px',
                  background: rec.tone === 'go' ? 'rgba(16,185,129,0.15)' :
                              rec.tone === 'caution' ? 'rgba(251,146,60,0.15)' :
                              'rgba(136,136,136,0.15)',
                  color: rec.tone === 'go' ? '#10b981' :
                         rec.tone === 'caution' ? '#fb923c' : '#888',
                  letterSpacing: '0.08em',
                }}
              >
                {rec.confidence}
              </span>
              {rec.id && !isApplied && (
                <button
                  onClick={() => onApply(rec.id)}
                  className="icon-btn"
                  style={{
                    borderColor: '#EAB308',
                    color: '#EAB308',
                    fontSize: '10px',
                    padding: '4px 10px',
                  }}
                >
                  套用 <ChevronRight size={10} />
                </button>
              )}
              {isApplied && rec.id && (
                <span className="font-mono-dm text-xs text-green" style={{ fontSize: '10px' }}>
                  ✓ APPLIED
                </span>
              )}
            </div>
          </div>
          <div className="text-xs text-muted font-tc mt-2" style={{ fontSize: '11.5px', lineHeight: 1.5 }}>
            {rec.reason}
          </div>
          <div className="flex items-center gap-3 mt-2 text-xs font-mono-dm text-muted-2" style={{ fontSize: '10px' }}>
            <span>IVR <span className="text-accent">{ivr}</span></span>
            <span>·</span>
            <span>DTE <span className="text-accent">T-{dte}</span></span>
            <span>·</span>
            <span>EVENT <span className="text-accent">{eventType}</span></span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────── PnL Mode Toggle (NEW)
function PnLModeToggle({ mode, setMode }) {
  return (
    <div className="toggle-pill">
      <button
        className={mode === 'simple' ? 'active' : ''}
        onClick={() => setMode('simple')}
      >
        SIMPLE
      </button>
      <button
        className={mode === 'iv_aware' ? 'active' : ''}
        onClick={() => setMode('iv_aware')}
      >
        IV-AWARE
      </button>
    </div>
  );
}

// ────────────────────────────── Vega Impact Badge (NEW)
function VegaImpactBadge({ strat, ivDelta }) {
  // ivDelta < 0 = IV crush
  // long vega + IV crush = loss; short vega + IV crush = gain
  const vegaLoss = strat.netVega * 100 * ivDelta;
  const isCrushSafe = Math.abs(strat.netVega) < 0.5; // spread ~ neutral
  const tone = isCrushSafe ? 'green' : (vegaLoss < -200 ? 'red' : 'orange');
  const color = tone === 'green' ? '#10b981' : tone === 'red' ? '#ef4444' : '#fb923c';
  const label = isCrushSafe ? 'NET VEGA ≈ 0' : ('NET VEGA ' + (strat.netVega > 0 ? '+' : '') + strat.netVega.toFixed(1));

  return (
    <div className="bg-subcard hair-border" style={{
      borderRadius: '4px',
      padding: '6px 10px',
      borderColor: color + '30',
    }}>
      <div className="flex items-center justify-between">
        <span className="font-mono-dm" style={{ fontSize: '9.5px', color, letterSpacing: '0.08em' }}>
          {label}
        </span>
        <span className="font-mono-dm tabular" style={{ fontSize: '11px', color: vegaLoss < 0 ? '#ef4444' : '#10b981' }}>
          {ivDelta !== 0 ? formatMoney(vegaLoss) : '—'}
        </span>
      </div>
      <div className="text-xs text-muted-2 font-tc" style={{ fontSize: '9px', marginTop: '1px' }}>
        若 IV {ivDelta > 0 ? '+' : ''}{ivDelta.toFixed(0)} → vega 影響
      </div>
    </div>
  );
}

// ────────────────────────────── Portfolio Beta Section (NEW)
function PortfolioBetaSection({
  positions, positionsTotal, portfolioBeta, vixToPortfolioBeta,
  externalConnected,
  newPosTicker, setNewPosTicker, newPosValue, setNewPosValue,
  onAdd, onDelete, onUpdate,
}) {
  return (
    <div className="bg-card hair-border" style={{ borderRadius: '6px', padding: '18px' }}>
      <div className="section-title" style={{ marginBottom: '14px' }}>
        <Database size={14} className="text-accent" />
        <span className="font-tc font-bold text-primary text-sm">Portfolio Beta · 持倉組合</span>
        <HelpTooltip text={'Beta = 持倉組合對 SPX 的敏感度\n\nBeta > 1.0：比大盤波動更大（高 β）\nBeta = 1.0：與大盤同步\nBeta < 1.0：比大盤穩定\n\n過高時建議用 SPY Put 中性化\n（目標 Beta = 0.5–0.8 較穩健）'} />
        <span className="text-xs text-muted-2 font-mono-dm" style={{ marginLeft: 'auto' }}>
          {externalConnected ? 'EXTERNAL · SYNCED' : 'MANUAL'}
        </span>
      </div>
      <div style={{ fontSize: '11px', color: '#9ca3af', fontFamily: 'Noto Sans TC', lineHeight: '1.55', marginTop: '-6px', marginBottom: '14px' }}>
        ▸ 持倉組合相對 SPX 的 Beta 值 — 大盤跌 1% 你大概跌多少，是否需要中性化避險。
      </div>

      {/* Computed metrics row */}
      <div className="grid grid-cols-4 gap-3 mb-4" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px' }}>
        <EffCard label="持倉總值" value={formatMoney(positionsTotal)} tone="default" />
        <EffCard label="加權 Beta" value={portfolioBeta.toFixed(3)} tone={portfolioBeta > 1.3 ? 'red' : portfolioBeta > 1.1 ? 'orange' : 'accent'} />
        <EffCard label="VIX +1pt 組合衝擊" value={(vixToPortfolioBeta * 100).toFixed(2) + '%'} tone="red" />
        <EffCard label="持倉數量" value={positions.length} tone="default" />
      </div>

      {/* Positions table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }} className="font-mono-dm tabular">
          <thead>
            <tr className="hair-border-b">
              <th style={{ textAlign: 'left', padding: '8px 6px', color: '#888', fontWeight: 500 }}>Ticker</th>
              <th style={{ textAlign: 'right', padding: '8px 6px', color: '#888', fontWeight: 500 }}>金額</th>
              <th style={{ textAlign: 'right', padding: '8px 6px', color: '#888', fontWeight: 500 }}>權重</th>
              <th style={{ textAlign: 'right', padding: '8px 6px', color: '#888', fontWeight: 500 }}>β (vs SPY)</th>
              <th style={{ textAlign: 'right', padding: '8px 6px', color: '#888', fontWeight: 500 }}>β-貢獻</th>
              <th style={{ textAlign: 'center', padding: '8px 6px', color: '#888', fontWeight: 500, width: '40px' }}></th>
            </tr>
          </thead>
          <tbody>
            {positions.map((p) => {
              const beta = getBeta(p.ticker);
              const weight = positionsTotal > 0 ? p.value / positionsTotal : 0;
              const contribution = weight * beta;
              const isUnknown = !(p.ticker?.toUpperCase() in STOCK_BETA);
              return (
                <tr key={p.id} className="hair-border-b pos-row">
                  <td style={{ padding: '6px' }}>
                    <input
                      type="text"
                      value={p.ticker}
                      onChange={(e) => onUpdate(p.id, 'ticker', e.target.value.toUpperCase())}
                      className="text-input"
                      style={{ width: '80px', padding: '4px 8px' }}
                    />
                    {isUnknown && (
                      <span className="ml-1" style={{ fontSize: '9px', color: '#fb923c' }}>?</span>
                    )}
                  </td>
                  <td style={{ padding: '6px', textAlign: 'right' }}>
                    <input
                      type="number"
                      value={p.value}
                      onChange={(e) => onUpdate(p.id, 'value', e.target.value)}
                      className="text-input"
                      style={{ width: '100px', padding: '4px 8px', textAlign: 'right' }}
                    />
                  </td>
                  <td style={{ padding: '6px', textAlign: 'right', color: '#888' }}>
                    {(weight * 100).toFixed(1)}%
                  </td>
                  <td style={{ padding: '6px', textAlign: 'right', color: beta > 1.3 ? '#ef4444' : beta > 1.0 ? '#fb923c' : beta < 0.7 ? '#10b981' : '#f4f4f4' }}>
                    {beta.toFixed(2)}
                  </td>
                  <td style={{ padding: '6px', textAlign: 'right', color: '#EAB308' }}>
                    {contribution.toFixed(3)}
                  </td>
                  <td style={{ padding: '6px', textAlign: 'center' }}>
                    <button
                      onClick={() => onDelete(p.id)}
                      className="icon-btn danger"
                      style={{ padding: '2px 5px' }}
                    >
                      <X size={10} />
                    </button>
                  </td>
                </tr>
              );
            })}
            {/* Add row — 隱藏當 Supabase 已連線（避免跟頁面上方的「持倉管理」搞混） */}
            {!externalConnected && (
              <tr>
                <td style={{ padding: '8px 6px' }}>
                  <input
                    type="text"
                    placeholder="TICKER"
                    value={newPosTicker}
                    onChange={(e) => setNewPosTicker(e.target.value.toUpperCase())}
                    onKeyDown={(e) => e.key === 'Enter' && onAdd()}
                    className="text-input"
                    style={{ width: '80px', padding: '4px 8px' }}
                  />
                </td>
                <td style={{ padding: '8px 6px', textAlign: 'right' }}>
                  <input
                    type="number"
                    placeholder="0"
                    value={newPosValue}
                    onChange={(e) => setNewPosValue(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && onAdd()}
                    className="text-input"
                    style={{ width: '100px', padding: '4px 8px', textAlign: 'right' }}
                  />
                </td>
                <td colSpan={4} style={{ padding: '8px 6px', textAlign: 'right' }}>
                  <button onClick={onAdd} className="icon-btn" style={{ borderColor: '#EAB308', color: '#EAB308' }}>
                    <Plus size={10} /> 新增持倉
                  </button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-3 text-xs text-muted-2 font-tc" style={{ fontSize: '10.5px', lineHeight: 1.5 }}>
        Beta 來自內建 lookup（to-SPY），未知 ticker 預設 1.10。
        {externalConnected
          ? <span style={{ color: '#EAB308' }}>  · 持倉來自 Supabase（自動同步）。要新增/編輯/刪除請到頁面最上方「<b>持倉管理</b>」面板，這裡只算 Beta。</span>
          : '  權重變化會即時影響 VIX hedge 的有效性計算。'}
      </div>
    </div>
  );
}

// ────────────────────────────── Stock Stress Section (NEW)
function StockStressSection({
  stressTicker, setStressTicker,
  stressImpliedMove, setStressImpliedMove,
  fetchStressStraddle, straddleStatus, straddleError, straddleSyncTime, targetExpiry,
  stressQQQWeight, setStressQQQWeight,
  stressContagion, setStressContagion,
  qqqPrice, setQqqPrice,
  qqqExposurePct, setQqqExposurePct,
  qqqPutOTMPct, setQqqPutOTMPct,
  stressResult, qqqPutSuggestion, portfolioValue,
}) {
  return (
    <div className="bg-card hair-border" style={{ borderRadius: '6px', padding: '18px' }}>
      <div className="section-title" style={{ marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '6px' }}>
        <Crosshair size={14} className="text-accent" />
        <span className="font-tc font-bold text-primary text-sm">Single Stock Stress Test · NVDA→QQQ</span>
        <HelpTooltip text={'NVDA → QQQ 對沖邏輯：\n\nNVDA 在 QQQ 中佔約 8% 權重\n單純權重看：NVDA 跌 10% → QQQ 跌 0.8%\n\n但實務上 NVDA 大跌時整個科技股連動\n→ QQQ 跌幅放大 2–3 倍\n\n建議用 QQQ Put 對沖 NVDA 單一風險\n（同樣的避險效果，成本更低）\n\n按「↻ 從 Polygon 算」自動拿 ATM straddle 算 implied move %'} />
        <button
          onClick={() => fetchStressStraddle && fetchStressStraddle(stressTicker)}
          disabled={straddleStatus === 'fetching' || !fetchStressStraddle}
          style={{
            marginLeft: 'auto',
            fontSize: '10px',
            padding: '3px 8px',
            borderRadius: '3px',
            border: '1px solid ' + (straddleStatus === 'error' ? '#ef4444' : straddleStatus === 'synced' ? '#10b981' : '#2a2a2a'),
            background: 'transparent',
            color: straddleStatus === 'error' ? '#ef4444' : straddleStatus === 'synced' ? '#10b981' : '#EAB308',
            cursor: straddleStatus === 'fetching' ? 'wait' : 'pointer',
            fontFamily: 'DM Mono',
            letterSpacing: '0.05em',
          }}
          title={'從 Polygon 抓 ' + stressTicker + ' ' + (targetExpiry || '') + ' ATM straddle 算 implied move'}
        >
          {straddleStatus === 'fetching' ? '⋯ 計算中' : straddleStatus === 'synced' ? '✓ 已同步' : straddleStatus === 'error' ? '✕ 失敗' : '↻ 從 Polygon 算'}
        </button>
        <span className="text-xs text-muted-2 font-mono-dm" style={{ marginLeft: '8px' }}>
          別人賭 NVDA · 聰明人看 NVDA 賭 QQQ
        </span>
      </div>
      <div style={{ fontSize: '11px', color: '#9ca3af', fontFamily: 'Noto Sans TC', lineHeight: '1.55', marginTop: '-6px', marginBottom: '12px' }}>
        ▸ 把單一重倉股（NVDA）的下跌情境放大到整個持倉，並建議用 QQQ Put 對沖規模。
      </div>
      {straddleStatus === 'synced' && straddleSyncTime && (
        <div style={{ fontSize: '10px', color: '#888', fontFamily: 'DM Mono', marginTop: '-8px', marginBottom: '10px' }}>
          {stressTicker} expiry {targetExpiry} · {Math.round((Date.now() - straddleSyncTime.getTime()) / 1000)}s ago
        </div>
      )}
      {straddleStatus === 'error' && straddleError && (
        <div style={{ fontSize: '10px', color: '#ef4444', marginTop: '-8px', marginBottom: '10px', lineHeight: '1.4' }}>
          {straddleError.slice(0, 140)}
        </div>
      )}

      {/* Inputs grid */}
      <div className="grid grid-cols-3 gap-3 mb-4" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
        <div>
          <label className="text-xs text-muted font-tc block mb-1">標的 Ticker</label>
          <select
            value={stressTicker}
            onChange={(e) => setStressTicker(e.target.value)}
            className="num-input"
            style={{ padding: '6px 10px' }}
          >
            <option value="NVDA">NVDA</option>
            <option value="AAPL">AAPL</option>
            <option value="MSFT">MSFT</option>
            <option value="META">META</option>
            <option value="GOOGL">GOOGL</option>
            <option value="AMZN">AMZN</option>
            <option value="AVGO">AVGO</option>
            <option value="TSLA">TSLA</option>
            <option value="AMD">AMD</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-muted font-tc block mb-1">Implied Move (%)</label>
          <input
            type="number"
            step="0.5"
            value={stressImpliedMove}
            onChange={(e) => setStressImpliedMove(Number(e.target.value))}
            className="num-input"
          />
        </div>
        <div>
          <label className="text-xs text-muted font-tc block mb-1">QQQ 權重 (%)</label>
          <input
            type="number"
            step="0.1"
            value={stressQQQWeight}
            onChange={(e) => setStressQQQWeight(Number(e.target.value))}
            className="num-input"
          />
        </div>
        <div>
          <label className="text-xs text-muted font-tc block mb-1">Contagion 倍率</label>
          <input
            type="number"
            step="0.1"
            value={stressContagion}
            onChange={(e) => setStressContagion(Number(e.target.value))}
            className="num-input"
          />
        </div>
        <div>
          <label className="text-xs text-muted font-tc block mb-1">QQQ 現價 ($)</label>
          <input
            type="number"
            step="0.5"
            value={qqqPrice}
            onChange={(e) => setQqqPrice(Number(e.target.value))}
            className="num-input"
          />
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs text-muted font-tc">QQQ-相關曝險</label>
            <span className="font-mono-dm text-xs text-accent">{qqqExposurePct}%</span>
          </div>
          <input
            type="range"
            min="0" max="100" step="5"
            value={qqqExposurePct}
            onChange={(e) => setQqqExposurePct(Number(e.target.value))}
            style={{ width: '100%' }}
          />
        </div>
      </div>

      {/* Results: Stress Impact */}
      <div className="bg-subcard hair-border flame-glow" style={{ borderRadius: '4px', padding: '14px 16px', marginBottom: '14px' }}>
        <div className="flex items-center gap-2 mb-3">
          <Flame size={12} className="text-red" />
          <span className="font-mono-dm text-muted text-xs" style={{ letterSpacing: '0.1em' }}>EXPECTED STRESS IMPACT</span>
        </div>
        <div className="grid grid-cols-3 gap-4" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px' }}>
          <div>
            <div className="text-xs text-muted-2 font-mono-dm" style={{ fontSize: '9.5px', letterSpacing: '0.1em', marginBottom: '4px' }}>
              QQQ 預期跳空
            </div>
            <div className="font-mono-dm tabular text-red" style={{ fontSize: '24px', fontWeight: 500 }}>
              -{(stressResult.qqqGapPct * 100).toFixed(2)}%
            </div>
            <div className="text-xs text-muted font-tc" style={{ fontSize: '10px', marginTop: '2px' }}>
              {stressImpliedMove}% × {stressQQQWeight.toFixed(1)}% × {stressContagion}x
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-2 font-mono-dm" style={{ fontSize: '9.5px', letterSpacing: '0.1em', marginBottom: '4px' }}>
              QQQ-相關曝險
            </div>
            <div className="font-mono-dm tabular text-primary" style={{ fontSize: '24px', fontWeight: 500 }}>
              {formatMoney(stressResult.exposureValue)}
            </div>
            <div className="text-xs text-muted font-tc" style={{ fontSize: '10px', marginTop: '2px' }}>
              組合 {formatMoney(portfolioValue)} × {qqqExposurePct}%
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-2 font-mono-dm" style={{ fontSize: '9.5px', letterSpacing: '0.1em', marginBottom: '4px' }}>
              預期損失
            </div>
            <div className="font-mono-dm tabular text-red" style={{ fontSize: '24px', fontWeight: 500 }}>
              {formatMoney(-stressResult.expectedLoss)}
            </div>
            <div className="text-xs text-muted font-tc" style={{ fontSize: '10px', marginTop: '2px' }}>
              {stressTicker} 事件造成
            </div>
          </div>
        </div>
      </div>

      {/* QQQ Put hedge suggestion */}
      <div className="hair-border" style={{ borderRadius: '4px', padding: '14px 16px', borderColor: '#EAB30840' }}>
        <div className="flex items-center gap-2 mb-3">
          <Target size={12} className="text-accent" />
          <span className="font-mono-dm text-accent text-xs" style={{ letterSpacing: '0.1em' }}>SUGGESTED QQQ PUT HEDGE</span>
        </div>
        <div className="grid grid-cols-2 gap-4 mb-3" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
          <div className="bg-deepcard hair-border" style={{ padding: '10px 12px', borderRadius: '4px' }}>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-muted font-tc">OTM 程度</label>
              <span className="font-mono-dm text-xs text-accent">{qqqPutOTMPct.toFixed(1)}%</span>
            </div>
            <input
              type="range"
              min="0" max="3" step="0.25"
              value={qqqPutOTMPct}
              onChange={(e) => setQqqPutOTMPct(Number(e.target.value))}
              style={{ width: '100%' }}
            />
            <div className="flex justify-between text-xs text-muted-2 font-mono-dm mt-1">
              <span>ATM</span><span>1%</span><span>2%</span><span>3%</span>
            </div>
          </div>
          <div className="bg-deepcard hair-border" style={{ padding: '10px 12px', borderRadius: '4px' }}>
            <div className="text-xs text-muted-2 font-mono-dm" style={{ fontSize: '9.5px', letterSpacing: '0.1em', marginBottom: '4px' }}>
              建議 STRIKE
            </div>
            <div className="font-mono-dm tabular text-accent" style={{ fontSize: '20px', fontWeight: 500 }}>
              ${qqqPutSuggestion.strike.toFixed(2)}
            </div>
            <div className="text-xs text-muted font-tc" style={{ fontSize: '10px', marginTop: '2px' }}>
              QQQ {qqqPrice} 下 {(qqqPutOTMPct).toFixed(1)}% OTM
            </div>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-3" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px' }}>
          <EffCard label="QQQ 預期收 ($)" value={'$' + qqqPutSuggestion.qqqEnd.toFixed(2)} tone="red" />
          <EffCard label="每口收益估算" value={formatMoney(qqqPutSuggestion.perContractGain)} tone="green" />
          <EffCard label="建議口數" value={qqqPutSuggestion.contracts} tone="accent" />
          <EffCard label="總成本估算" value={formatMoney(qqqPutSuggestion.totalCost)} tone="orange" />
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <div className="bg-subcard hair-border" style={{ padding: '8px 12px', borderRadius: '4px' }}>
            <div className="text-xs text-muted-2 font-mono-dm" style={{ fontSize: '9.5px', letterSpacing: '0.08em' }}>
              對沖覆蓋率
            </div>
            <div className="font-mono-dm tabular" style={{
              fontSize: '15px',
              fontWeight: 500,
              color: qqqPutSuggestion.coverageRatio >= 1 ? '#10b981' : qqqPutSuggestion.coverageRatio >= 0.7 ? '#fb923c' : '#ef4444',
            }}>
              {(qqqPutSuggestion.coverageRatio * 100).toFixed(0)}%
            </div>
          </div>
          <div className="bg-subcard hair-border" style={{ padding: '8px 12px', borderRadius: '4px' }}>
            <div className="text-xs text-muted-2 font-mono-dm" style={{ fontSize: '9.5px', letterSpacing: '0.08em' }}>
              成本 / 預期損失比
            </div>
            <div className="font-mono-dm tabular" style={{
              fontSize: '15px',
              fontWeight: 500,
              color: stressResult.expectedLoss > 0 && qqqPutSuggestion.totalCost / stressResult.expectedLoss < 0.5 ? '#10b981' : '#fb923c',
            }}>
              {stressResult.expectedLoss > 0 ? ((qqqPutSuggestion.totalCost / stressResult.expectedLoss) * 100).toFixed(0) + '%' : '—'}
            </div>
          </div>
        </div>

        <div className="mt-3 text-xs text-muted font-tc" style={{ fontSize: '10.5px', lineHeight: 1.5 }}>
          Premium 用 BS-proxy 估算（QQQ IV ~20%、weekly DTE 7 天）。實際下單請以即時 chain 為準。
          覆蓋率 &lt; 100% 表示對沖不足；&gt; 100% 表示過度對沖（會浪費權利金但安全邊際更大）。
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────── Existing helper components
function MiniMetric({ label, value, accent, red, green }) {
  const color = accent ? '#EAB308' : red ? '#ef4444' : green ? '#10b981' : '#f4f4f4';
  return (
    <div>
      <div className="text-muted-2 font-mono-dm" style={{ fontSize: '10px', letterSpacing: '0.1em', marginBottom: '2px' }}>
        {label}
      </div>
      <div
        className="font-mono-dm tabular"
        style={{ fontSize: '18px', fontWeight: 500, color }}
      >
        {value}
      </div>
    </div>
  );
}

function EffCard({ label, value, tone }) {
  const color =
    tone === 'accent' ? '#EAB308' :
    tone === 'red' ? '#ef4444' :
    tone === 'green' ? '#10b981' :
    tone === 'orange' ? '#fb923c' :
    '#f4f4f4';
  return (
    <div className="bg-subcard hair-border" style={{ borderRadius: '4px', padding: '12px 14px' }}>
      <div className="text-xs text-muted mb-1 font-tc" style={{ fontSize: '10.5px' }}>
        {label}
      </div>
      <div
        className="font-mono-dm tabular"
        style={{ fontSize: '20px', fontWeight: 500, color }}
      >
        {value}
      </div>
    </div>
  );
}

function PremiumInput({ label, value, onChange, accent, muted }) {
  return (
    <div>
      <label
        className="block mb-1 font-mono-dm"
        style={{
          fontSize: '10px',
          color: accent ? '#EAB308' : muted ? '#555' : '#888',
          letterSpacing: '0.05em',
        }}
      >
        {label}
      </label>
      <input
        type="number"
        step="0.01"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="num-input"
        style={{
          padding: '6px 8px',
          fontSize: '13px',
          borderColor: accent ? '#EAB308' : '#2a2a2a',
        }}
      />
    </div>
  );
}

function PnLCell({ value, highlight }) {
  const color = value < 0 ? '#ef4444' : value > 0 ? '#10b981' : '#555';
  return (
    <div
      className="text-right"
      style={{
        color,
        fontWeight: highlight ? 700 : 400,
        background: highlight ? 'rgba(234,179,8,0.06)' : 'transparent',
        padding: highlight ? '0 4px' : '0',
        borderRadius: '2px',
      }}
    >
      {formatMoney(value)}
    </div>
  );
}

function TimingRow({ label, status, tip }) {
  return (
    <div className="flex items-start gap-3 hair-border" style={{
      padding: '8px 12px',
      borderRadius: '4px',
      borderColor: status ? '#10b98140' : '#2a2a2a',
    }}>
      <div
        style={{
          width: '14px',
          height: '14px',
          borderRadius: '50%',
          background: status ? '#10b98130' : '#2a2a2a',
          border: '1.5px solid ' + (status ? '#10b981' : '#555'),
          flexShrink: 0,
          marginTop: '2px',
          position: 'relative',
        }}
      >
        {status && (
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              width: '5px',
              height: '5px',
              borderRadius: '50%',
              background: '#10b981',
            }}
          />
        )}
      </div>
      <div className="flex-1">
        <div className="text-sm font-tc text-primary" style={{ fontSize: '13px' }}>
          {label}
        </div>
        <div className="text-xs text-muted font-tc" style={{ fontSize: '10.5px', marginTop: '2px' }}>
          {tip}
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────── MacroContextBanner (NEW v2.1: L2 cross-layer)
function MacroContextBanner({ score, band, alerts, hedgeBudgetBps }) {
  const hasCritical = alerts.some((a) => a.severity === 'critical');
  const hasHigh = alerts.some((a) => a.severity === 'high');
  const tone = hasCritical ? 'critical' : hasHigh ? 'warn' : 'info';
  const accentColor = tone === 'critical' ? '#ef4444' : tone === 'warn' ? '#fb923c' : (band?.color || '#60a5fa');

  return (
    <div
      style={{
        background: 'linear-gradient(135deg, ' + accentColor + '12 0%, transparent 70%)',
        border: '1px solid ' + accentColor + '40',
        borderRadius: '6px',
        padding: '12px 16px',
      }}
    >
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div
            style={{
              width: '8px',
              height: '8px',
              background: accentColor,
              borderRadius: '50%',
              boxShadow: '0 0 8px ' + accentColor,
            }}
          />
          <div>
            <div className="font-mono-dm text-muted-2" style={{ fontSize: '9px', letterSpacing: '0.12em' }}>
              L2 MACRO CONTEXT · UPSTREAM SIGNAL
            </div>
            <div className="font-tc font-bold" style={{ fontSize: '13px', color: '#f4f4f4', marginTop: '2px' }}>
              {score != null ? 'L2 Score ' + score.toFixed(0) : ''}
              {band ? ' · ' + band.label : ''}
              {hedgeBudgetBps != null ? ' → 已套用 ' + hedgeBudgetBps + ' bps hedge 預算' : ''}
            </div>
          </div>
        </div>
        {alerts.length > 0 && (
          <div className="flex flex-col items-end" style={{ gap: '2px' }}>
            <span
              className="font-mono-dm"
              style={{
                fontSize: '9px',
                padding: '2px 8px',
                borderRadius: '3px',
                background: accentColor + '25',
                color: accentColor,
                letterSpacing: '0.1em',
              }}
            >
              {alerts.length} L2 ALERT{alerts.length > 1 ? 'S' : ''}
            </span>
            <span className="text-xs text-muted font-tc" style={{ fontSize: '10px' }}>
              {alerts.map((a) => a.name).join(' · ')}
            </span>
          </div>
        )}
      </div>
      {hasCritical && (
        <div className="mt-2 text-xs font-tc" style={{ fontSize: '11px', color: accentColor, lineHeight: 1.4 }}>
          ⚠ L2 已觸發 critical 警報。本層 strategy recommendation 僅供參考，請優先遵守 L2 機械式執行清單（清空槓桿、SGOV 60%+）。
        </div>
      )}
    </div>
  );
}
