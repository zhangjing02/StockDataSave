// ============================================================
//  CZSC 美股量化平台 - app.js (重构版 · 下拉选择器)
// ============================================================

const CONFIG = {
  RAW_BASE: 'https://raw.githubusercontent.com/zhangjing02/StockDataSave/main',
  DATA_PATH: 'data',
  MONTHS_BACK: 3,

  stocks: [
    'AAPL','MSFT','NVDA','TSLA','META','AMZN','GOOG','AMD',
    'PLTR','SMCI','ARM','ORCL','ASML','TSM','AVGO','MU',
    'RKLB','COIN','NFLX','DIS','RIVN','BABA','NIO','XPEV',
    'BA','DAL','OXY','ADBE','NVO','IBKR','PDD','BILI',
    'FCX','INTC','QCOM'
  ],
  etfs: [
    'SPY','QQQ','IWM','SMH','ARKK','UVXY','KWEB','SOXS'
  ],
  crypto: [
    'BTC-USD','ETH-USD','BNB-USD','SOL-USD','XRP-USD',
    'DOGE-USD','ADA-USD','AVAX-USD','SHIB-USD','DOT-USD'
  ],

  // Friendly display names
  names: {
    'AAPL':'Apple Inc.', 'MSFT':'Microsoft', 'NVDA':'NVIDIA',
    'TSLA':'Tesla', 'META':'Meta Platforms', 'AMZN':'Amazon',
    'GOOG':'Alphabet (Google)', 'AMD':'AMD', 'PLTR':'Palantir',
    'SMCI':'Super Micro', 'ARM':'ARM Holdings', 'ORCL':'Oracle',
    'ASML':'ASML', 'TSM':'Taiwan Semiconductor', 'AVGO':'Broadcom',
    'MU':'Micron', 'RKLB':'Rocket Lab', 'COIN':'Coinbase',
    'NFLX':'Netflix', 'DIS':'Disney', 'RIVN':'Rivian',
    'BABA':'Alibaba', 'NIO':'NIO', 'XPEV':'XPeng',
    'BA':'Boeing', 'DAL':'Delta Air Lines', 'OXY':'Occidental',
    'ADBE':'Adobe', 'NVO':'Novo Nordisk', 'IBKR':'Interactive Brokers',
    'PDD':'PDD Holdings', 'BILI':'Bilibili', 'FCX':'Freeport-McMoRan',
    'INTC':'Intel', 'QCOM':'Qualcomm',
    'SPY':'S&P 500 ETF', 'QQQ':'Nasdaq 100 ETF', 'IWM':'Russell 2000 ETF',
    'SMH':'Semiconductor ETF', 'ARKK':'ARK Innovation ETF',
    'UVXY':'VIX ETF 1.5x', 'KWEB':'China Internet ETF', 'SOXS':'Semiconductor Bear',
    'BTC-USD':'Bitcoin', 'ETH-USD':'Ethereum', 'BNB-USD':'BNB',
    'SOL-USD':'Solana', 'XRP-USD':'XRP', 'DOGE-USD':'Dogecoin',
    'ADA-USD':'Cardano', 'AVAX-USD':'Avalanche', 'SHIB-USD':'Shiba Inu', 'DOT-USD':'Polkadot'
  }
};

// ── State ────────────────────────────────────────────────
let state = {
  category: 'stock',   // 'stock' | 'etf' | 'crypto'
  symbol:   'AAPL',
  tf:       '5m',
  activeTab:'Chart',
};

let chart = null;
let candleSeries = null;
let volumeSeries = null;

// ── Init ─────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  buildSelect('stock');
  updateMarketStatus();
  setInterval(updateMarketStatus, 60000);

  // Init chart
  initChart();
  loadChart();

  // Default news date = today
  const today = getTodayStr();
  const dateInput = document.getElementById('newsDateInput');
  if (dateInput) dateInput.value = today;
});

// ── Category Switch ──────────────────────────────────────
function switchCategory(cat) {
  state.category = cat;
  document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById(
    cat === 'stock' ? 'catStock' : cat === 'etf' ? 'catEtf' : 'catCrypto'
  );
  if (btn) {
    btn.classList.add('active');
    btn.className = btn.className.replace(/ crypto| etf/g, '');
    if (cat === 'crypto') btn.classList.add('crypto');
    if (cat === 'etf')    btn.classList.add('etf');
  }
  buildSelect(cat);
}

function buildSelect(cat) {
  const sel = document.getElementById('symbolSelect');
  const pool = CONFIG[cat === 'stock' ? 'stocks' : cat === 'etf' ? 'etfs' : 'crypto'];
  sel.innerHTML = '';
  pool.forEach(sym => {
    const opt = document.createElement('option');
    opt.value = sym;
    opt.textContent = `${sym}  ${CONFIG.names[sym] ? '· ' + CONFIG.names[sym] : ''}`;
    sel.appendChild(opt);
  });
  // Auto-select first item in category, or keep previous if still valid
  const keep = pool.includes(state.symbol) ? state.symbol : pool[0];
  sel.value = keep;
  state.symbol = keep;
  loadChart();
}

function onSymbolChange(sym) {
  if (!sym) return;
  state.symbol = sym;
  loadChart();
}

// ── Timeframe ────────────────────────────────────────────
function switchTF(tf, btn) {
  state.tf = tf;
  document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  loadChart();
}

// ── Tab Switch ───────────────────────────────────────────
function switchTab(tab) {
  state.activeTab = tab;
  ['Chart', 'News'].forEach(t => {
    document.getElementById('tab' + t)?.classList.toggle('active', t === tab);
    document.getElementById('btn' + t)?.classList.toggle('active', t === tab);
  });
  if (tab === 'News') {
    const input = document.getElementById('newsDateInput');
    if (input) loadNews(input.value || getTodayStr());
  }
}

// ── Chart Init ───────────────────────────────────────────
function initChart() {
  const container = document.getElementById('chartContainer');
  chart = LightweightCharts.createChart(container, {
    width:  container.clientWidth,
    height: container.clientHeight,
    layout: { background:{color:'#0d1117'}, textColor:'#8b949e' },
    grid: {
      vertLines: { color:'rgba(33,38,45,0.5)' },
      horzLines: { color:'rgba(33,38,45,0.5)' }
    },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
    rightPriceScale: { borderColor:'#21262d' },
    timeScale: { borderColor:'#21262d', timeVisible:true, secondsVisible:false }
  });

  candleSeries = chart.addCandlestickSeries({
    upColor:'#3fb950', wickUpColor:'#3fb950',
    downColor:'#f85149', wickDownColor:'#f85149',
    borderVisible: false
  });

  volumeSeries = chart.addHistogramSeries({
    priceFormat: { type:'volume' },
    priceScaleId: 'vol',
    scaleMargins: { top:0.7, bottom:0 }
  });

  window.addEventListener('resize', () => {
    chart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
  });
}

// ── Data Loading ─────────────────────────────────────────
async function loadChart() {
  showLoading(true);
  hideError();

  const sym = state.symbol;
  const tf  = state.tf;

  try {
    const data = await fetchAllData(sym, tf);
    if (data.length === 0) {
      showError(`⚠️ 未找到 ${sym} 的行情数据（${tf}）`);
      return;
    }
    renderChart(data);
    updateStats(sym, data);
  } catch (e) {
    console.error(e);
    showError(`❌ 加载失败：${e.message}`);
  } finally {
    showLoading(false);
  }
}

async function fetchAllData(symbol, tf) {
  const suffix = tf === '5m' ? '_5m.csv' : '_1d.csv';
  const months = getRecentMonths(CONFIG.MONTHS_BACK);
  const symPath = symbol.replace('-', '-'); // keep as-is (e.g. BTC-USD)

  const fetches = months.map(m =>
    fetch(`${CONFIG.RAW_BASE}/${CONFIG.DATA_PATH}/${symbol}/${m}${suffix}`)
      .then(r => r.ok ? r.text() : '')
      .catch(() => '')
  );

  const texts = await Promise.all(fetches);
  let rows = [];
  texts.forEach(t => { if (t) rows = rows.concat(parseCSV(t)); });

  // Deduplicate + sort
  const seen = new Set();
  rows = rows.filter(r => {
    if (seen.has(r.time)) return false;
    seen.add(r.time);
    return true;
  });
  rows.sort((a,b) => a.time - b.time);
  return rows;
}

function parseCSV(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].toLowerCase().split(',');
  const dtIdx = headers.indexOf('dt');
  const oIdx  = headers.indexOf('open');
  const cIdx  = headers.indexOf('close');
  const hIdx  = headers.indexOf('high');
  const lIdx  = headers.indexOf('low');
  const vIdx  = headers.indexOf('vol');
  if ([dtIdx,oIdx,cIdx,hIdx,lIdx].some(i => i < 0)) return [];

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    if (cols.length < 5) continue;
    try {
      const ts = Math.floor(new Date(cols[dtIdx].replace(' ','T') + 'Z').getTime() / 1000);
      if (isNaN(ts)) continue;
      rows.push({
        time:  ts,
        open:  parseFloat(cols[oIdx]),
        high:  parseFloat(cols[hIdx]),
        low:   parseFloat(cols[lIdx]),
        close: parseFloat(cols[cIdx]),
        value: vIdx >= 0 ? parseFloat(cols[vIdx]) : 0
      });
    } catch { /* skip bad row */ }
  }
  return rows;
}

function renderChart(data) {
  const candles = data.map(d => ({ time:d.time, open:d.open, high:d.high, low:d.low, close:d.close }));
  const volumes = data.map(d => ({
    time:  d.time,
    value: d.value,
    color: d.close >= d.open ? 'rgba(63,185,80,0.5)' : 'rgba(248,81,73,0.5)'
  }));
  candleSeries.setData(candles);
  volumeSeries.setData(volumes);
  chart.timeScale().fitContent();
}

function updateStats(sym, data) {
  if (!data.length) return;
  const last = data[data.length - 1];
  const first = data[0];

  const price  = last.close.toFixed(last.close < 1 ? 6 : 2);
  const change = (((last.close - first.open) / first.open) * 100).toFixed(2);
  const isUp   = last.close >= first.open;

  const highs  = Math.max(...data.map(d => d.high)).toFixed(last.close < 1 ? 6 : 2);
  const lows   = Math.min(...data.map(d => d.low)).toFixed(last.close < 1 ? 6 : 2);
  const vol    = formatVolume(data.reduce((s, d) => s + (d.value || 0), 0));

  setStatVal('qPrice',  price,  isUp ? 'up' : 'down');
  setStatVal('qChg',    `${isUp ? '+' : ''}${change}%`, isUp ? 'up' : 'down');
  setStatVal('qHigh',   highs);
  setStatVal('qLow',    lows);
  setStatVal('qVol',    vol);
  setStatVal('qCount',  data.length + ' K');
}

function setStatVal(id, val, cls) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = val;
  el.className = 'stat-val' + (cls ? ' ' + cls : '');
}

function formatVolume(v) {
  if (v >= 1e9) return (v/1e9).toFixed(1) + 'B';
  if (v >= 1e6) return (v/1e6).toFixed(1) + 'M';
  if (v >= 1e3) return (v/1e3).toFixed(1) + 'K';
  return v.toFixed(0);
}

// ── News ─────────────────────────────────────────────────
async function loadNews(dateStr) {
  if (!dateStr) dateStr = getTodayStr();
  const url = `${CONFIG.RAW_BASE}/${CONFIG.DATA_PATH}/news/${dateStr}.md`;
  const el  = document.getElementById('newsContent');
  el.innerHTML = '<div class="news-loading">正在加载新闻...</div>';

  try {
    const res = await fetch(url);
    if (!res.ok) {
      // Try yesterday
      const yesterday = getYesterdayStr(dateStr);
      const res2 = await fetch(`${CONFIG.RAW_BASE}/${CONFIG.DATA_PATH}/news/${yesterday}.md`);
      if (!res2.ok) {
        el.innerHTML = `<div class="news-empty">📭 暂无 ${dateStr} 的新闻早报，数据将在每日 Action 后更新。</div>`;
        return;
      }
      el.innerHTML = renderNewsMarkdown(await res2.text(), yesterday);
      return;
    }
    el.innerHTML = renderNewsMarkdown(await res.text(), dateStr);
  } catch (e) {
    el.innerHTML = `<div class="news-empty">❌ 加载失败：${e.message}</div>`;
  }
}

function renderNewsMarkdown(md, dateLbl) {
  if (!md) return `<div class="news-empty">📭 ${dateLbl} 暂无新闻内容</div>`;
  
  // Simple markdown-to-html converter
  let html = md
    // Headers
    .replace(/^# (.*$)/gm, '<h1 class="news-title-main">$1</h1>')
    .replace(/^## (.*$)/gm, '<h2 class="news-section-title">$1</h2>')
    .replace(/^### (.*$)/gm, '<h3 class="news-item-title">$1</h3>')
    // Blockquotes
    .replace(/^> (.*$)/gm, '<blockquote>$1</blockquote>')
    // Bold
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    // Links
    .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank" class="news-link">$1</a>')
    // Horizontal rule
    .replace(/^---$/gm, '<hr class="news-divider">')
    // Newlines to breaks (careful with existing tags)
    .split('\n').join('<br>');

  // Wrap in sections if simplified
  return `<div class="news-rendered-body">${html}</div>`;
}

// ── Helpers ───────────────────────────────────────────────
function getRecentMonths(n) {
  const months = [];
  const now = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const m = d.getMonth() + 1;
    months.push(`${d.getFullYear()}-${String(m).padStart(2,'0')}`);
  }
  return months;
}

function getTodayStr() {
  return new Date().toISOString().split('T')[0];
}

function getYesterdayStr(dateStr) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}

function showLoading(show) {
  const el = document.getElementById('loadingOverlay');
  if (el) el.style.display = show ? 'flex' : 'none';
}

function showError(msg) {
  const el = document.getElementById('errorBox');
  if (el) { el.textContent = msg; el.style.display = 'block'; }
}

function hideError() {
  const el = document.getElementById('errorBox');
  if (el) el.style.display = 'none';
}

// ── Market Status ─────────────────────────────────────────
function updateMarketStatus() {
  const dot  = document.getElementById('marketDot');
  const text = document.getElementById('marketStatusText');
  if (!dot || !text) return;

  const now  = new Date();
  const etNow = new Date(now.toLocaleString('en-US', { timeZone:'America/New_York' }));
  const day  = etNow.getDay();
  const h    = etNow.getHours();
  const m    = etNow.getMinutes();
  const mins = h * 60 + m;

  const isWeekday  = day >= 1 && day <= 5;
  const inSession  = mins >= 9*60+30 && mins < 16*60;
  const isOpen     = isWeekday && inSession;

  dot.className  = 'dot' + (isOpen ? '' : ' closed');
  text.textContent = isOpen ? '美股交易中' : '美股休市';
}
