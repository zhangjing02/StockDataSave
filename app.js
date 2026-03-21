// ============================================================
//  CZSC 美股量化平台 - app.js (Search Tabs Edition)
// ============================================================

const CONFIG = {
  RAW_BASE: 'https://raw.githubusercontent.com/zhangjing02/StockDataSave/main',
  DATA_PATH: 'data',

  // Categorized Pools
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
  symbol:   'AAPL',
  tf:       '1d',
  activeTab:'Chart',
  searchKeyword: '',
  searchCategory: 'stocks' // stocks, etfs, crypto
};

let chart = null;
let candleSeries = null;
let volumeSeries = null;
let signalSeriesList = [];

// ── Init ─────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  updateMarketStatus();
  setInterval(updateMarketStatus, 60000);
  initChart();
  loadChart();

  const dateInput = document.getElementById('newsDateInput');
  if (dateInput) dateInput.value = getTodayStr();

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.sidebar-search')) {
      showSearchResults(false);
    }
  });
});

// ── Search Logic ─────────────────────────────────────────
function setSearchCategory(cat) {
  state.searchCategory = cat;
  document.querySelectorAll('.s-tab').forEach(t => {
    t.classList.toggle('active', t.id === `stab_${cat}`);
  });
  onSearchInput(state.searchKeyword);
}

function showSearchResults(show) {
  const dd = document.getElementById('searchDropdown');
  if (dd) dd.style.display = show ? 'block' : 'none';
  if (show) onSearchInput(state.searchKeyword);
}

function onSearchInput(val) {
  state.searchKeyword = (val || '').toLowerCase();
  const dd = document.getElementById('searchDropdown');
  if (!dd) return;
  dd.innerHTML = '';

  const pool = CONFIG[state.searchCategory] || [];
  const filtered = pool.filter(s => {
    const name = CONFIG.names[s] || '';
    return s.toLowerCase().includes(state.searchKeyword) || 
           name.toLowerCase().includes(state.searchKeyword);
  });

  if (filtered.length === 0) {
    dd.innerHTML = '<div style="padding:10px; font-size:12px; color:var(--text-muted)">无匹配结果</div>';
    return;
  }

  filtered.forEach(sym => {
    const item = document.createElement('div');
    item.className = 'symbol-item';
    item.onclick = () => onSelectSymbol(sym);
    item.innerHTML = `
      <span class="s-name">${sym}</span>
      <span class="s-sub">${CONFIG.names[sym] || ''}</span>
    `;
    dd.appendChild(item);
  });
}

function onSelectSymbol(sym) {
  state.symbol = sym;
  const input = document.getElementById('symbolSearch');
  if (input) input.value = sym;
  showSearchResults(false);
  loadChart();
}

// ── Timeframe & Tab ──────────────────────────────────────
function switchTF(tf, btn) {
  state.tf = tf;
  document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  loadChart();
}

function switchTab(tab) {
  state.activeTab = tab;
  ['Chart', 'News'].forEach(t => {
    const pane = document.getElementById('tab' + t);
    const btn  = document.getElementById('btn' + t);
    if (pane) pane.style.display = (t === tab) ? 'block' : 'none';
    if (btn) btn.classList.toggle('active', t === tab);
  });
  
  if (tab === 'News') {
    const input = document.getElementById('newsDateInput');
    loadNews(input?.value || getTodayStr());
  } else {
    setTimeout(() => {
      if (chart) {
        const container = document.getElementById('chartContainer');
        if (container) chart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
      }
    }, 50);
  }
}

// ── Chart ────────────────────────────────────────────────
function initChart() {
  const container = document.getElementById('chartContainer');
  if (!container) {
    console.error('❌ Missing chartContainer');
    return;
  }
  chart = LightweightCharts.createChart(container, {
    width:  container.clientWidth || 800,
    height: container.clientHeight || 500,
    layout: { 
      background: { color: 'transparent' }, 
      textColor: '#8b949e',
      fontFamily: 'Inter'
    },
    grid: {
      vertLines: { color: 'rgba(33, 38, 45, 0.2)' },
      horzLines: { color: 'rgba(33, 38, 45, 0.2)' }
    },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
    rightPriceScale: { borderColor: '#30363d', scaleMargins: { top: 0.1, bottom: 0.2 } },
    timeScale: { borderColor: '#30363d', timeVisible: true, secondsVisible: false }
  });

  candleSeries = chart.addCandlestickSeries({
    upColor: '#26a69a', wickUpColor: '#26a69a',
    downColor: '#ef5350', wickDownColor: '#ef5350',
    borderVisible: false
  });

  volumeSeries = chart.addHistogramSeries({
    priceFormat: { type: 'volume' },
    priceScaleId: 'v-scale',
    scaleMargins: { top: 0.8, bottom: 0 }
  });
  chart.priceScale('v-scale').applyOptions({ visible: false });

  window.addEventListener('resize', () => {
    if (chart && container) {
      chart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
    }
  });
}

async function loadChart() {
  showLoading(true);
  hideError();

  const sym = state.symbol;
  let tf  = state.tf;
  
  let fetchTf = tf;
  if (tf === '5d') fetchTf = '1m'; 
  if (tf === '1y') fetchTf = '1mo';

  try {
    let data = await fetchPriceData(sym, fetchTf);
    if (!data || data.length === 0) {
      showError(`⚠️ 暂无 ${sym} [${tf}] 的数据支撑。`);
      return;
    }

    if (tf === '5d') {
      const now = Math.floor(Date.now() / 1000);
      const fiveDaysAgo = now - (5 * 24 * 3600);
      data = data.filter(d => d.time >= fiveDaysAgo);
    } else if (tf === '1y') {
      data = aggregateToYearly(data);
    }

    renderChart(data);
    updateStats(sym, data);
    loadSignals(sym, fetchTf);

  } catch (e) {
    showError(`❌ 加载失败: ${e.message}`);
  } finally {
    showLoading(false);
  }
}

async function fetchPriceData(symbol, tf) {
  const url = `${CONFIG.RAW_BASE}/${CONFIG.DATA_PATH}/${symbol}_${tf}.csv`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const text = await res.text();
  return parseCSV(text);
}

function aggregateToYearly(monthlyData) {
  if (!monthlyData.length) return [];
  const years = {};
  monthlyData.forEach(d => {
    const year = new Date(d.time * 1000).getUTCFullYear();
    if (!years[year]) {
      years[year] = { time: Math.floor(Date.UTC(year, 0, 1)/1000), open: d.open, high: d.high, low: d.low, close: d.close, value: d.value };
    } else {
      years[year].high = Math.max(years[year].high, d.high);
      years[year].low = Math.min(years[year].low, d.low);
      years[year].close = d.close;
      years[year].value += (d.value || 0);
    }
  });
  return Object.values(years).sort((a,b) => a.time - b.time);
}

function parseCSV(text) {
  if (!text || !text.trim()) return [];
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].toLowerCase().split(',');
  const dtIdx = headers.indexOf('dt') !== -1 ? headers.indexOf('dt') : headers.indexOf('date');
  const oIdx  = headers.indexOf('open');
  const hIdx  = headers.indexOf('high');
  const lIdx  = headers.indexOf('low');
  const cIdx  = headers.indexOf('close');
  const vIdx  = headers.indexOf('vol') !== -1 ? headers.indexOf('vol') : headers.indexOf('volume');

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    if (cols.length < 5) continue;
    
    let timeStr = cols[dtIdx];
    if (!timeStr) continue;
    
    // Defensive date parsing
    let ts;
    try {
      ts = Math.floor(new Date(timeStr.replace(' ','T') + (timeStr.includes('+') || timeStr.includes('Z') ? '' : 'Z')).getTime() / 1000);
    } catch(err) { continue; }
    
    if (isNaN(ts)) continue;
    rows.push({
      time: ts,
      open: parseFloat(cols[oIdx]),
      high: parseFloat(cols[hIdx]),
      low:  parseFloat(cols[lIdx]),
      close:parseFloat(cols[cIdx]),
      value:vIdx >= 0 ? parseFloat(cols[vIdx]) : 0
    });
  }
  return rows.sort((a,b) => a.time - b.time);
}

function renderChart(data) {
  if (!candleSeries || !volumeSeries || !chart) {
    console.error('❌ Chart not initialized properly');
    return;
  }
  candleSeries.setData(data);
  const volumes = data.map(d => ({
    time: d.time,
    value: d.value,
    color: d.close >= d.open ? 'rgba(38, 166, 154, 0.4)' : 'rgba(239, 83, 80, 0.4)'
  }));
  volumeSeries.setData(volumes);
  chart.timeScale().fitContent();
}

async function loadSignals(symbol, tf) {
  if (!chart || !candleSeries) return;
  signalSeriesList.forEach(s => chart.removeSeries(s));
  signalSeriesList = [];

  const url = `${CONFIG.RAW_BASE}/${CONFIG.DATA_PATH}/analysis/${symbol}_${tf}_signals.json`;
  try {
    const res = await fetch(url);
    if (!res.ok) return;
    const s = await res.json();
    
    if (s.bi) {
      const ser = chart.addLineSeries({ color:'#ff9800', lineWidth:1, lastValueVisible:false, priceLineVisible:false });
      signalSeriesList.push(ser);
      const points = [];
      s.bi.forEach(b => {
        const t1 = parseDt(b.start_dt);
        const t2 = parseDt(b.end_dt);
        if (t1) points.push({ time:t1, value: b.direction.toString().includes('up') || b.direction == 1 ? b.low : b.high });
        if (t2) points.push({ time:t2, value: b.direction.toString().includes('up') || b.direction == 1 ? b.high : b.low });
      });
      ser.setData(uniqueByTime(points));
    }
    if (s.markers) candleSeries.setMarkers(s.markers);
    else candleSeries.setMarkers([]);
  } catch (e) {}
}

function parseDt(str) {
  if (!str) return null;
  const d = new Date(str.replace(' ','T') + 'Z');
  return isNaN(d.getTime()) ? null : Math.floor(d.getTime() / 1000);
}
function uniqueByTime(arr) {
  const seen = new Set();
  return arr.filter(i => {
    if (seen.has(i.time)) return false;
    seen.add(i.time);
    return true;
  }).sort((a,b) => a.time - b.time);
}

function updateStats(sym, data) {
  if (!data.length) return;
  const last = data[data.length - 1];
  const first = data[0];
  const chg = (((last.close - first.open) / first.open) * 100).toFixed(2);
  const isUp = last.close >= first.open;

  setStat('qPrice', (last.close || 0).toFixed(last.close < 1 ? 4 : 2), isUp ? 'up' : 'down');
  setStat('qChg', `${isUp?'+':''}${chg}%`, isUp ? 'up' : 'down');
  setStat('qHigh', (Math.max(...data.map(d=>d.high||0)) || 0).toFixed(2));
  setStat('qLow',  (Math.min(...data.map(d=>d.low||0)) || 0).toFixed(2));
  setStat('qVol',  formatVolume(data.reduce((a,b)=>a+(b.value||0),0)));
}

function setStat(id, val, cls) {
  const el = document.getElementById(id);
  if (el) { el.textContent = val; el.className = 'i-val' + (cls ? ' ' + cls : ''); }
}
function formatVolume(v) {
  if (v >= 1e9) return (v/1e9).toFixed(1) + 'B';
  if (v >= 1e6) return (v/1e6).toFixed(1) + 'M';
  return (v/1e3).toFixed(1) + 'K';
}

async function loadNews(dateStr) {
  const url = `${CONFIG.RAW_BASE}/${CONFIG.DATA_PATH}/news/${dateStr}.md`;
  const el = document.getElementById('newsContent');
  if (!el) return;
  el.innerHTML = '<div style="color:var(--text-muted); padding:40px; text-align:center;">读取中...</div>';
  try {
    const res = await fetch(url);
    if (!res.ok) {
      el.innerHTML = `<div style="color:var(--text-muted); padding:40px; text-align:center;">📅 ${dateStr} 暂无。</div>`;
      return;
    }
    const md = await res.text();
    el.innerHTML = renderSimpleMarkdown(md);
  } catch (e) { el.innerHTML = '❌ 无法加载。'; }
}

function renderSimpleMarkdown(md) {
  if (!md) return '';
  return md.replace(/^# (.*$)/gm, '<h1 style="margin-bottom:20px">$1</h1>')
           .replace(/^## (.*$)/gm, '<h2 style="color:var(--accent-blue); margin:30px 0 15px">$1</h2>')
           .replace(/^### (.*$)/gm, '<h3 style="margin:20px 0 10px">$1</h3>')
           .replace(/^---$/gm, '<hr style="opacity:0.1; margin:30px 0">')
           .replace(/> (.*$)/gm, '<blockquote style="border-left:4px solid var(--accent-blue); padding-left:15px; color:var(--text-dim); margin:10px 0">$1</blockquote>')
           .split('\n').join('<br>');
}

function updateMarketStatus() {
  const dot = document.getElementById('marketDot');
  const text = document.getElementById('marketStatusText');
  const etNow = new Date(new Date().toLocaleString('en-US', { timeZone:'America/New_York' }));
  const open = etNow.getDay() >= 1 && etNow.getDay() <= 5 && (etNow.getHours()*60+etNow.getMinutes() >= 570 && etNow.getHours()*60+etNow.getMinutes() < 960);
  if (dot) dot.className = 'dot' + (open ? '' : ' closed');
  if (text) text.textContent = open ? '美股交易中 (EST)' : '美股已休市 (EST)';
}

function getTodayStr() { return new Date().toISOString().split('T')[0]; }
function showLoading(s) {
  const el = document.getElementById('loadingOverlay');
  if (el) el.style.display = s ? 'flex' : 'none';
}
function showError(msg) {
  console.error(msg);
  showLoading(false);
  const err = document.getElementById('errorBox');
  if (err) {
    err.textContent = msg;
    err.style.display = 'block';
  }
}
function hideError() {
  const err = document.getElementById('errorBox');
  if (err) err.style.display = 'none';
}
