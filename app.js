// ============================================================
//  CZSC 美股量化平台 - Premium UI Integration
// ============================================================

const CONFIG = {
  RAW_BASE: 'https://raw.githubusercontent.com/zhangjing02/StockDataSave/main',
  DATA_PATH: 'data',

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
  searchKeyword: ''
};

let chart = null;
let candleSeries = null;
let volumeSeries = null;
let emaSeries = null;
let smaSeries = null;
let signalSeriesList = [];

let chartReady;
let resolveChartReady;
chartReady = new Promise(resolve => { resolveChartReady = resolve; });

// ── Init ─────────────────────────────────────────────────
function bootstrap() {
  renderWatchlist();
  onSelectSymbol(state.symbol); // Initializes header text
  initChart();
  loadChart();
}

if (document.readyState === 'loading') { window.addEventListener('DOMContentLoaded', bootstrap); } 
else { bootstrap(); }

// ── Watchlist & Search Logic ─────────────────────────────
function onSearchInput(val) {
  state.searchKeyword = (val || '').toLowerCase();
  
  // Also filter sidebar instead of just dropdown
  renderWatchlist(state.searchKeyword);

  // Still show dropdown if they are actively typing for quick hits
  const dd = document.getElementById('searchDropdown');
  if (!dd) return;
  dd.innerHTML = '';
  
  if(!val.trim()) {
    dd.style.display = 'none';
    return;
  }
  
  const allSymbols = [...CONFIG.stocks, ...CONFIG.etfs, ...CONFIG.crypto];
  const filtered = allSymbols.filter(s => {
    const name = CONFIG.names[s] || '';
    return s.toLowerCase().includes(state.searchKeyword) || name.toLowerCase().includes(state.searchKeyword);
  });

  if (filtered.length > 0) {
    dd.style.display = 'block';
    filtered.slice(0, 10).forEach(sym => {
      const item = document.createElement('div');
      item.className = 'search-item';
      item.onclick = () => { onSelectSymbol(sym); dd.style.display='none'; document.getElementById('symbolSearch').value=''; };
      item.innerHTML = `
        <span class="name">${sym}</span>
        <span class="sub">${CONFIG.names[sym] || ''}</span>
      `;
      dd.appendChild(item);
    });
  } else {
    dd.style.display = 'none';
  }
}

function renderWatchlist(query = '') {
  const container = document.getElementById('watchlistContainer');
  if(!container) return;
  container.innerHTML = '';
  
  const allSymbols = [...CONFIG.stocks, ...CONFIG.etfs, ...CONFIG.crypto];
  const q = query.toLowerCase();
  
  // Render up to 50 active items for performance
  let renderedCount = 0;
  
  allSymbols.forEach(sym => {
    if(renderedCount >= 60 && !q) return; // Limit initial render if no search

    const name = CONFIG.names[sym] || '';
    if(q && !sym.toLowerCase().includes(q) && !name.toLowerCase().includes(q)) return;
    
    renderedCount++;
    const item = document.createElement('div');
    item.className = 'wl-item' + (sym === state.symbol ? ' active' : '');
    item.onclick = () => onSelectSymbol(sym);
    
    item.innerHTML = `
        <div class="wl-left">
            <span class="wl-ticker">${sym}</span>
            <span class="wl-name">${name}</span>
        </div>
        <div class="wl-right">
            <span class="wl-price" id="wl-p-${sym}">---</span>
            <span class="wl-chg flat" id="wl-c-${sym}">---</span>
        </div>
    `;
    container.appendChild(item);
  });
}

function onSelectSymbol(sym) {
  state.symbol = sym;
  renderWatchlist(state.searchKeyword); // refresh active state
  
  const hTitle = document.getElementById('headerSymbolName');
  if (hTitle) hTitle.innerHTML = `${CONFIG.names[sym] || sym} (${sym}) <i class="fas fa-chevron-down" style="margin-left:8px; font-size:10px;"></i>`;
  
  loadChart();
}

function switchTF(tf, btn) {
  state.tf = tf;
  document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  loadChart();
}

// ── Chart Subsystem ──────────────────────────────────────
function initChart() {
  const container = document.getElementById('chartContainer');
  if (!container) return;

  try {
    chart = LightweightCharts.createChart(container, {
      width:  container.clientWidth || 800,
      height: container.clientHeight || 500,
      layout: { 
        background: { type: 'solid', color: 'transparent' }, 
        textColor: 'rgba(255, 255, 255, 0.45)', // More subtle axis text
        fontFamily: "'Inter', sans-serif"
      },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.02)' }, // Ultra subtle grid
        horzLines: { color: 'rgba(255, 255, 255, 0.02)' }
      },
      crosshair: { 
        mode: LightweightCharts.CrosshairMode.Normal,
        vertLine: { color: 'rgba(255, 255, 255, 0.2)', labelBackgroundColor: '#1e293b' },
        horzLine: { color: 'rgba(255, 255, 255, 0.2)', labelBackgroundColor: '#1e293b' }
      },
      rightPriceScale: { borderColor: 'rgba(255, 255, 255, 0.05)' },
      timeScale: { 
        borderColor: 'rgba(255, 255, 255, 0.05)', 
        timeVisible: true, 
        secondsVisible: false
      }
    });

    candleSeries = chart.addCandlestickSeries({
      upColor: '#00F5D4', wickUpColor: '#00F5D4',
      downColor: '#FF9F9F', wickDownColor: '#FF9F9F',
      borderVisible: false
    });

    volumeSeries = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'v-scale'
    });
    
    // Explicitly fix the volume scale overlapping and proportions
    chart.priceScale('v-scale').applyOptions({
      visible: false,
      scaleMargins: { top: 0.82, bottom: 0 },
    });

    // MAs
    // MAs per prototype
    emaSeries = chart.addLineSeries({ color: '#fca311', lineWidth: 2, crosshairMarkerVisible: false, priceLineVisible: false, lastValueVisible: false });
    smaSeries = chart.addLineSeries({ color: '#7a5af8', lineWidth: 2, crosshairMarkerVisible: false, priceLineVisible: false, lastValueVisible: false });

    window.addEventListener('resize', () => {
      if (chart && container) {
        chart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
      }
    });
    
    resolveChartReady();
  } catch (err) { console.error('Error creating chart:', err); }
}

async function loadChart() {
  showLoading(true);
  hideError();

  const sym = state.symbol;
  let tf  = state.tf;
  
  let fetchTf = tf;
  if (tf === '1mo') fetchTf = '1mo'; // Placeholder for higher resolution scaling if needed
  if (tf === '1wk') fetchTf = '1d';  // We'll aggregate weekly from daily if desired, currently using direct fetching if files exist.
  // Generally, just fetch whatever config requested. The backend has ['1m', '1d'] reliably.
  if(!['1m','1d','1mo','1wk'].includes(tf)) fetchTf = '1d';

  try {
    let data = await fetchPriceData(sym, fetchTf);
    if (!data || data.length === 0) {
      if(tf !== '1d') {
          // fallback to 1d
          data = await fetchPriceData(sym, '1d');
      }
      if(!data || data.length === 0) {
          showError(`⚠️ No data found for ${sym}.`);
          return;
      }
    }

    renderChart(data);
    updateStats(sym, data);
    loadSignals(sym, fetchTf);

  } catch (e) {
    showError(`❌ Failed to load: ${e.message}`);
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
    
    let ts;
    try { ts = Math.floor(new Date(timeStr.replace(' ','T') + (timeStr.includes('+') || timeStr.includes('Z') ? '' : 'Z')).getTime() / 1000); } 
    catch(e) { continue; }
    
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

// Math logic for Indicators
function calculateSMA(data, period) {
    const res = [];
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
        sum += data[i].close;
        if (i >= period) sum -= data[i - period].close;
        if (i >= period - 1) res.push({ time: data[i].time, value: sum / period });
    }
    return res;
}

function calculateEMA(data, period) {
    const res = [];
    if(data.length === 0) return res;
    const k = 2 / (period + 1);
    let ema = data[0].close;
    for (let i = 0; i < data.length; i++) {
        if(i > 0) ema = (data[i].close - ema) * k + ema;
        if (i >= period - 1) res.push({ time: data[i].time, value: ema });
    }
    return res;
}

async function renderChart(data) {
  await chartReady;

  if (!candleSeries || !volumeSeries || !chart) return;
  candleSeries.setData(data);
  const volumes = data.map(d => ({
    time: d.time,
    value: d.value,
    color: d.close >= d.open ? 'rgba(16, 185, 129, 0.4)' : 'rgba(239, 68, 68, 0.4)'
  }));
  volumeSeries.setData(volumes);
  
  const emaData = calculateEMA(data, 20);
  const smaData = calculateSMA(data, 50);

  // Set MA data
  if(emaSeries) emaSeries.setData(emaData);
  if(smaSeries) smaSeries.setData(smaData);

  // Update Indicator Pills with latest values
  const latestEma = emaData.length ? emaData[emaData.length-1].value.toFixed(2) : '--';
  const latestSma = smaData.length ? smaData[smaData.length-1].value.toFixed(2) : '--';
  const emaEl = document.querySelector('.c-ema');
  const smaEl = document.querySelector('.c-sma');
  if(emaEl) emaEl.textContent = `EMA (20): ${latestEma}`;
  if(smaEl) smaEl.textContent = `SMA (50): ${latestSma}`;

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
      const ser = chart.addLineSeries({ color:'#60a5fa', lineWidth:1, lastValueVisible:false, priceLineVisible:false });
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
  
  const priceStr = '$' + (last.close || 0).toFixed(last.close < 1 ? 4 : 2);
  const chgStr = `${isUp?'+':''}${chg}%`;

  // Update Top Stats Cards
  setStat('qPrice', priceStr);
  const qSub = document.getElementById('qSubPrice');
  if(qSub) {
      qSub.textContent = chgStr;
      qSub.className = 's-sub ' + (isUp ? 'up' : 'down');
  }
  
  setStat('qChg', chgStr, isUp ? 'up' : 'down');
  setStat('qHigh', '$' + (Math.max(...data.map(d=>d.high||0)) || 0).toFixed(2));
  setStat('qLow',  '$' + (Math.min(...data.map(d=>d.low||0)) || 0).toFixed(2));
  
  // Update Chart Title Ticker
  setStat('cTicker', `${sym}: ${priceStr}`);
  
  // Inject change percentage pill next to ticker if we want exactly like prototype
  const tickerEl = document.getElementById('cTicker');
  if(tickerEl) {
      tickerEl.innerHTML = `${sym}: ${priceStr} <span class="wl-chg ${isUp?'up':'down'}" style="font-size:14px; margin-left:12px; vertical-align:middle;">${chgStr}</span>`;
  }
  
  // Also push to the active sidebar item
  const wlPrice = document.getElementById(`wl-p-${sym}`);
  const wlChg = document.getElementById(`wl-c-${sym}`);
  if (wlPrice) wlPrice.textContent = priceStr;
  if (wlChg) {
      wlChg.textContent = chgStr;
      wlChg.className = 'wl-chg ' + (isUp ? 'up' : 'down');
  }
}

function setStat(id, val, cls) {
  const el = document.getElementById(id);
  if (el) { 
      el.textContent = val; 
      if(cls) el.className = el.dataset.origClass ? el.dataset.origClass + ' ' + cls : (el.closest('.s-val') ? 's-val ' + cls : 'i-val ' + cls); 
  }
}

function showLoading(s) {
  const el = document.getElementById('loadingOverlay');
  if (el) el.style.display = s ? 'flex' : 'none';
}
function showError(msg) {
  showLoading(false);
  const err = document.getElementById('errorBox');
  if (err) { err.textContent = msg; err.style.display = 'block'; }
}
function hideError() {
  const err = document.getElementById('errorBox');
  if (err) err.style.display = 'none';
}
