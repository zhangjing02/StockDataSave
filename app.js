// ============================================================
//  CZSC 美股量化平台 - Premium UI Integration
// ============================================================

const CONFIG = {
  RAW_BASE: 'https://raw.githubusercontent.com/zhangjing02/StockDataSave/main',
  LOCAL_BASE: '.', // Default for relative path
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
  wlCategory: 'stocks', // NEW: watchlist category
  searchKeyword: '',
  mainTab: 'chart', // NEW: current main tab
};

let pyodide = null;
let isPyodideLoading = false;

let chart = null;
let candleSeries, volumeSeries, emaSeries, smaSeries, areaSeries;
let currentTF = '1m'; 
let currentSymbol = 'AAPL';
let signalSeriesList = [];

let chartReady;
let resolveChartReady;
chartReady = new Promise(resolve => { resolveChartReady = resolve; });

// ── Init ─────────────────────────────────────────────────
function bootstrap() {
  onSelectSymbol(state.symbol); // Initializes header text
  initChart();
  loadChartData(state.symbol, state.tf);
  
  // Set default script
  const editor = document.getElementById('pythonEditor');
  if (editor) {
    editor.innerText = `# 示例：计算自定义指标并返回图表
# data_json 包含当前行情数据 (Open, High, Low, Close, Volume)
import pandas as pd
import json

# 1. 计算 5 周期简单移动平均线
df['SMA_5'] = df['Close'].rolling(window=5).mean()

# 2. 构造返回给主图的结果
# type: 'line', name: 指标名称, color: 线条颜色, data: 数值列表
results = [
    {
        "type": "line",
        "name": "Custom SMA 5",
        "color": "#f1c40f",
        "data": df['SMA_5'].tolist()
    }
]`;
  }
}

if (document.readyState === 'loading') { window.addEventListener('DOMContentLoaded', bootstrap); } 
else { bootstrap(); }

// ── Asset Selection Logic (Search Dropdown as Selector) ────────────────
function onSearchFocus() {
  renderSearchDropdown('');
}

function onSearchInput(val) {
  state.searchKeyword = (val || '').toLowerCase();
  renderSearchDropdown(state.searchKeyword);
}

function renderSearchDropdown(query = '') {
  const dd = document.getElementById('searchDropdown');
  if (!dd) return;
  dd.innerHTML = '';
  dd.style.display = 'block';

  const categories = [
    { id: 'stocks', label: '热门股票' },
    { id: 'etfs', label: '精选 ETF' },
    { id: 'crypto', label: '加密货币' }
  ];

  let hasResults = false;

  categories.forEach(cat => {
    const list = CONFIG[cat.id] || [];
    const filtered = list.filter(s => {
      const name = CONFIG.names[s] || '';
      return !query || s.toLowerCase().includes(query) || name.toLowerCase().includes(query);
    });

    if (filtered.length > 0) {
      hasResults = true;
      const title = document.createElement('div');
      title.className = 'search-cat-title';
      title.innerText = cat.label;
      dd.appendChild(title);

      filtered.forEach(sym => {
        const item = document.createElement('div');
        item.className = 'search-item';
        item.onclick = () => {
          onSelectSymbol(sym);
          hideSearchDropdown();
        };
        item.innerHTML = `
          <div class="name">${sym}</div>
          <div class="sub">${CONFIG.names[sym] || ''}</div>
        `;
        dd.appendChild(item);
      });
    }
  });

  if (!hasResults) {
    dd.innerHTML = '<div style="padding:16px; color:#666; font-size:13px; text-align:center;">未找到匹配资产</div>';
  }
}

function hideSearchDropdown() {
  const dd = document.getElementById('searchDropdown');
  if (dd) dd.style.display = 'none';
  document.getElementById('symbolSearch').value = '';
}

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
  const box = document.querySelector('.search-box');
  if (box && !box.contains(e.target)) {
    hideSearchDropdown();
  }
});

// ── Watchlist & Search Logic ─────────────────────────────
// ── End of search logic ───────────────────────────────────

function onSelectSymbol(sym) {
  state.symbol = sym;
  currentSymbol = sym;
  
  // Update header and title
  const name = CONFIG.names[sym] || sym;
  const headerSymbolName = document.getElementById('headerSymbolName');
  if (headerSymbolName) headerSymbolName.innerText = `${name} (${sym})`;
  
  loadChartData(state.symbol, state.tf);
}

function switchMainTab(tabId) {
  state.mainTab = tabId;
  const tabs = document.querySelectorAll('.chart-tab-content');
  const navItems = document.querySelectorAll('.nav-item');
  
  tabs.forEach(t => t.style.display = 'none');
  navItems.forEach(n => n.classList.remove('active'));
  
  document.getElementById('tab' + tabId.charAt(0).toUpperCase() + tabId.slice(1)).style.display = 'block';
  // Match nav item index
  const navIndexMap = { 'chart': 0, 'lab': 1, 'news': 2 };
  if(navItems[navIndexMap[tabId]]) navItems[navIndexMap[tabId]].classList.add('active');
  
  if(tabId === 'chart') {
    // Refresh chart size
    setTimeout(() => {
      if(chart) chart.applyOptions({ width: document.getElementById('chartContainer').clientWidth });
    }, 100);
  }
}

async function loadPyodideRuntime() {
  if (pyodide) return pyodide;
  if (isPyodideLoading) return new Promise(resolve => {
    const check = setInterval(() => { if(pyodide) { clearInterval(check); resolve(pyodide); } }, 100);
  });

  isPyodideLoading = true;
  const consoleEl = document.getElementById('labConsole');
  consoleEl.innerHTML = '<div><i class="fas fa-spinner fa-spin"></i> 正在初始化 Python 运行时 (Pyodide)...</div>';
  
  try {
    pyodide = await loadPyodide();
    consoleEl.innerHTML += '<div><i class="fas fa-check"></i> 运行时已加载，正在安装依赖 (pandas, numpy)...</div>';
    await pyodide.loadPackage(['pandas', 'numpy']);
    consoleEl.innerHTML += '<div><i class="fas fa-check"></i> 准备就绪，可以执行脚本。</div>';
    isPyodideLoading = false;
    return pyodide;
  } catch (err) {
    consoleEl.innerHTML += `<div style="color:var(--accent-red)">❌ 初始化失败: ${err.message}</div>`;
    isPyodideLoading = false;
    throw err;
  }
}

async function runCustomPython() {
  const code = document.getElementById('pythonEditor').innerText;
  const consoleEl = document.getElementById('labConsole');
  consoleEl.innerHTML = '<div><i class="fas fa-play"></i> 脚本执行中...</div>';
  
  try {
    const py = await loadPyodideRuntime();
    
    // Prepare data - convert current price data to JSON/Dict for Python
    // We use the last 500 points for performance
    const chartData = getVisibleData(); // Helper to get latest loaded data
    if (!chartData || chartData.length === 0) {
      throw new Error("无可用行情数据，请先在行情中心加载资产。");
    }

    // Inject data into Python environment
    py.globals.set('data_json', JSON.stringify(chartData));
    
    const wrapperCode = `
import pandas as pd
import json
import io

df = pd.read_json(io.StringIO(data_json))
# Ensure columns are standard
df.columns = [c.capitalize() for c in df.columns]

# User code start
${code}
# User code end

# Return results as JSON
json.dumps(results if 'results' in locals() else [])
    `;

    const resultJson = await py.runPythonAsync(wrapperCode);
    const results = JSON.parse(resultJson);
    
    consoleEl.innerHTML += '<div><i class="fas fa-check"></i> 执行成功!</div>';
    renderLabResults(results);
    
  } catch (err) {
    consoleEl.innerHTML += `<div style="color:var(--accent-red)">❌ 执行错误: ${err.message}</div>`;
    console.error(err);
  }
}

function getVisibleData() {
  // Try to extract data from current active series
  // This is a simplified version, in real app we'd keep original data in state
  return currentPriceData || []; // We'll update loadChartData to save this
}

let currentPriceData = []; // Buffer for Pyodide

function renderLabResults(results) {
  if (!chart || !results || !Array.isArray(results)) return;
  
  // Clear old lab indicators if any
  if (state.labSeriesList) {
    state.labSeriesList.forEach(s => chart.removeSeries(s));
  }
  state.labSeriesList = [];

  results.forEach(res => {
    if (res.type === 'line') {
      const series = chart.addLineSeries({
        color: res.color || '#00F5D4',
        lineWidth: 2,
        title: res.name
      });
      // Map data back to timestamps
      const data = res.data.map((val, i) => ({
        time: currentPriceData[i].time,
        value: val
      })).filter(d => d.value !== null && d.value !== undefined);
      
      series.setData(data);
      state.labSeriesList.push(series);
    }
  });

  // Switch back to chart to show results
  setTimeout(() => switchMainTab('chart'), 500);
}

function switchTF(tf, btn) {
  state.tf = tf;
  currentTF = tf;
  document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  
  // Toggle Visibility: If 1m or 5d, show line chart. Else show candlestick.
  if (tf === '1m' || tf === '5d') {
    if(candleSeries) candleSeries.applyOptions({ visible: false });
    if(areaSeries) areaSeries.applyOptions({ visible: true });
    if(emaSeries) emaSeries.applyOptions({ visible: false });
    if(smaSeries) smaSeries.applyOptions({ visible: false });
  } else {
    if(candleSeries) candleSeries.applyOptions({ visible: true });
    if(areaSeries) areaSeries.applyOptions({ visible: false });
    if(emaSeries) emaSeries.applyOptions({ visible: true });
    if(smaSeries) smaSeries.applyOptions({ visible: true });
  }
  
  loadChartData(state.symbol, state.tf);
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

    // Added Area series for "分时"
    areaSeries = chart.addAreaSeries({
      topColor: 'rgba(0, 245, 212, 0.4)',
      bottomColor: 'rgba(0, 245, 212, 0.0)',
      lineColor: '#00F5D4',
      lineWidth: 2,
    });
    areaSeries.applyOptions({ visible: false });

    // MAs per prototype
    emaSeries = chart.addLineSeries({ color: '#fca311', lineWidth: 2, crosshairMarkerVisible: false, priceLineVisible: false, lastValueVisible: false });
    smaSeries = chart.addLineSeries({ color: '#7a5af8', lineWidth: 2, crosshairMarkerVisible: false, priceLineVisible: false, lastValueVisible: false });

    window.addEventListener('resize', () => {
      if (chart && container) {
        chart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
        // Redraw chips on resize
        loadChips(state.symbol);
      }
    });
    
    resolveChartReady();
  } catch (err) { console.error('Error creating chart:', err); }
}

async function loadChartData(symbol, tf) {
  showLoading(true);
  hideError();

  let fetchTf = tf;
  // Mapping for frontend TFs to CSV suffixes
  if (tf === '5d' || tf === '1m') fetchTf = '1m';
  else if (tf === '1wk') fetchTf = '1wk';
  else if (tf === '3mo') fetchTf = '3mo';
  else if (tf === '1y') fetchTf = '1y';
  else if (tf === '1mo') fetchTf = '1mo';
  else fetchTf = '1d';

  try {
    let data = await fetchPriceData(symbol, fetchTf);
    if (!data || data.length === 0) {
      if(tf !== '1d') {
          // fallback to 1d
          data = await fetchPriceData(symbol, '1d');
      }
      if(!data || data.length === 0) {
          showError(`⚠️ No data found for ${symbol}.`);
          return;
      }
    }

    await renderChart(data, tf);
    currentPriceData = data; // Save for Lab
    updateStats(symbol, data);
    await loadSignals(symbol, fetchTf);
    await loadChips(symbol); // New: Load Volume Profile

  } catch (e) {
    showError(`❌ Failed to load: ${e.message}`);
  } finally {
    showLoading(false);
  }
}

async function fetchPriceData(symbol, tf) {
  // Mapping for frontend TFs to CSV suffixes
  let fetchInterval = tf;
  if(tf === '5d') fetchInterval = '1m';
  
  const url = `${CONFIG.RAW_BASE}/${CONFIG.DATA_PATH}/${symbol}_${fetchInterval}.csv`;
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
    
    // Better date parsing constraint for YYYY-MM-DD formats
    let ts;
    try { 
      let cleanStr = timeStr.replace(' ','T');
      if (!cleanStr.includes('T')) cleanStr += 'T00:00:00Z';
      else if (!cleanStr.includes('+') && !cleanStr.endsWith('Z')) cleanStr += 'Z';
      
      ts = Math.floor(new Date(cleanStr).getTime() / 1000); 
    } catch(e) { continue; }
    
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

/** 
 * Unified Signal Generation (EMA/SMA Crossover)
 * Used by both loadSignals (visual) and runBacktest (engine)
 */
function getTrendSignals(data) {
  if (data.length < 50) return [];
  const ema20 = calculateEMA(data, 20);
  const sma50 = calculateSMA(data, 50);
  const emaMap = {}; ema20.forEach(x => emaMap[x.time] = x.value);
  const smaMap = {}; sma50.forEach(x => smaMap[x.time] = x.value);
  
  let markers = [];
  let prevAbove = null;
  
  data.forEach(bar => {
    const e = emaMap[bar.time], s = smaMap[bar.time];
    if (e == null || s == null) return;
    const above = e > s;
    if (prevAbove !== null && above !== prevAbove) {
       markers.push({
         time: bar.time,
         position: above ? 'belowBar' : 'aboveBar',
         color: above ? '#00FFD1' : '#FF5E5E',
         shape: above ? 'arrowUp' : 'arrowDown',
         text: above ? 'BUY ★' : 'SELL ★',
         size: 2, // Larger markers
         type: above ? 'Buy1' : 'Sell1'
       });
    }
    prevAbove = above;
  });
  return markers;
}

async function renderChart(data, tf) {
  await chartReady;

  if (!candleSeries || !volumeSeries || !chart) return;
  let processedData = [...data];
  if (tf === '5d') {
     processedData = processedData.slice(-5 * 390); // ~5 days
  } else if (tf === '1m') {
     processedData = processedData.slice(-390); // ~1 day
  }

  // Update Series
  if (tf === '1m' || tf === '5d') {
    areaSeries.setData(processedData.map(d => ({ time: d.time, value: d.close })));
    candleSeries.setData([]);
  } else {
    candleSeries.setData(processedData);
    areaSeries.setData([]);
  }
  
  volumeSeries.setData(processedData.map(d => ({
    time: d.time,
    value: d.value,
    color: d.close >= d.open ? 'rgba(0, 245, 212, 0.4)' : 'rgba(255, 159, 159, 0.4)'
  })));
  
  const emaData = calculateEMA(processedData, 20);
  const smaData = calculateSMA(processedData, 50);

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
  
  // 1. Clear existing
  signalSeriesList.forEach(s => chart.removeSeries(s));
  signalSeriesList = [];
  candleSeries.setMarkers([]);

  const cb = document.getElementById('toggleChanlunBtn');
  if (cb && !cb.checked) return;

  // 2. Load JSON
  const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  const url = isLocal 
    ? `${CONFIG.LOCAL_BASE}/${CONFIG.DATA_PATH}/analysis/${symbol}_${tf}_signals.json`
    : `${CONFIG.RAW_BASE}/${CONFIG.DATA_PATH}/analysis/${symbol}_${tf}_signals.json`;
    
  let loaded = false;
  console.log(`[Signals] Fetching from ${isLocal ? 'LOCAL' : 'REMOTE'}: ${url}`);

  try {
    const res = await fetch(url);
    if (res.ok) {
      const s = await res.json();
      if (s.bi && s.bi.length > 0) {
        const ser = chart.addLineSeries({ 
          color: '#60a5fa', lineWidth: 1, lastValueVisible: false, priceLineVisible: false,
          lineStyle: LightweightCharts.LineStyle.Dashed 
        });
        signalSeriesList.push(ser);
        const pts = [];
        s.bi.forEach(b => {
          const t1 = parseDt(b.start_dt), t2 = parseDt(b.end_dt);
          if (t1) pts.push({ time: t1, value: b.direction == 1 ? b.low : b.high });
          if (t2) pts.push({ time: t2, value: b.direction == 1 ? b.high : b.low });
        });
        ser.setData(uniqueByTime(pts));
      }
      if (s.markers && s.markers.length > 0) {
        candleSeries.setMarkers(s.markers);
        loaded = true;
      }
    }
  } catch (e) {
    console.warn('[Signals] JSON Load error:', e);
  }

  // 3. No Fallback (Removed as per user request to avoid interference)
  if (!loaded) {
    console.log(`[Signals] No Chanlun signals found for ${symbol}_${tf}.`);
    // Previously we had a fallback here, now we just keep the markers empty.
  }
}

// ── Volume Profile (Chips) Subsystem ───────────────────
async function loadChips(symbol) {
  const container = document.getElementById('chartContainer');
  let canvas = document.getElementById('chipsCanvas');
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = 'chipsCanvas';
    canvas.style.position = 'absolute';
    canvas.style.right = '0';
    canvas.style.top = '0';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '5';
    container.appendChild(canvas);
  }

  // Handle Resize
  canvas.width = container.clientWidth;
  canvas.height = container.clientHeight;

  const url = `${CONFIG.RAW_BASE}/${CONFIG.DATA_PATH}/analysis/${symbol}_1d_chips.json`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
       clearChips();
       return;
    }
    const chips = await res.json();
    renderChips(chips);
  } catch (e) {
    console.warn('[Chips] Load error:', e);
    clearChips();
  }
}

function clearChips() {
  const canvas = document.getElementById('chipsCanvas');
  if (canvas) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
}

function renderChips(data) {
  const canvas = document.getElementById('chipsCanvas');
  if (!canvas || !data || !data.levels || data.levels.length === 0) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (!candleSeries || !chart) return;

  const width = canvas.width;
  const height = canvas.height;
  const maxVol = Math.max(...data.levels.map(l => l.volume));
  
  // Volume profile usually takes right 15-20% of the chart
  const chipWidth = width * 0.2; 
  const startX = width - chipWidth - 60; // Offset from right scale

  ctx.fillStyle = 'rgba(0, 245, 212, 0.15)'; // Mint theme
  ctx.strokeStyle = 'rgba(0, 245, 212, 0.4)';

  data.levels.forEach(level => {
    // Coordinate conversion from price to Y pixels
    const y = candleSeries.priceToCoordinate(level.price);
    if (y === null) return;

    const barWidth = (level.volume / maxVol) * chipWidth;
    
    // Draw horizontal bar
    ctx.fillRect(startX + (chipWidth - barWidth), y - 2, barWidth, 4);
  });
  
  // Label: Value Area / POC (Optional highlight)
  const pocLevel = data.levels.reduce((prev, curr) => (prev.volume > curr.volume) ? prev : curr);
  const pocY = candleSeries.priceToCoordinate(pocLevel.price);
  if (pocY !== null) {
      ctx.beginPath();
      ctx.moveTo(startX, pocY);
      ctx.lineTo(width - 60, pocY);
      ctx.strokeStyle = '#fca311';
      ctx.setLineDash([5, 5]);
      ctx.stroke();
      ctx.setLineDash([]);
  }
}

// Handler for the sidebar strategy toggle
function toggleChanlunIndicators(checked) {
  loadSignals(state.symbol, state.tf);
}

function parseDt(str) {
  if (!str) return null;
  let cleanStr = str.replace(' ','T');
  if (!cleanStr.includes('T')) cleanStr += 'T00:00:00Z';
  else if (!cleanStr.includes('+') && !cleanStr.endsWith('Z')) cleanStr += 'Z';
  const d = new Date(cleanStr);
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
  
  // Improved Daily Change Logic:
  // We need current price vs start-of-session price.
  // For simplicity, if we have enough data (at least 2 bars), we use the one before last as 'previous' reference.
  // In a real pro app, we'd fetch the specific 'Prev Close'.
  let prevClose = last.open; 
  if (data.length > 1) {
    prevClose = data[data.length - 2].close;
  }
  
  const chg = (((last.close - prevClose) / prevClose) * 100).toFixed(2);
  const isUp = last.close >= prevClose;
  
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
  
  // Sync with main header (redundant but safe)
  const headerName = document.getElementById('headerSymbolName');
  if (headerName) {
    headerName.innerHTML = `${sym}: ${priceStr} <span class="wl-chg ${isUp?'up':'down'}" style="font-size:14px; margin-left:12px;">${chgStr}</span>`;
  }
}
// ── Backtest Engine (JS Port of Python BacktestEngine) ──
/**
 * Core backtest runner - ported from Python BacktestEngine
 * @param {Array} klineData  - Array of {time, open, high, low, close, value} objects (sorted asc by time unix ts)
 * @param {Array} signals    - Array of {time, type} where type is 'Buy1'|'Buy2'|'Sell1'|'Sell2'
 * @param {Object} config    - { initialCapital, commissionRate, direction }
 */
function runBacktestEngine(klineData, signals, config) {
  const { initialCapital = 100000, commissionRate = 0.001, direction = 'long_only' } = config;
  if (!klineData || klineData.length < 2) return { error: '数据不足，无法回测' };

  // Build signal lookup map: unixTs -> target position (1=long, -1=short, 0=flat)
  const signalMap = {};
  signals.forEach(sig => {
    const t = typeof sig.time === 'number' ? sig.time : parseDt(sig.time);
    if (!t) return;
    const isBuy  = sig.type && (sig.type.startsWith('Buy')  || sig.type.startsWith('buy'));
    const isSell = sig.type && (sig.type.startsWith('Sell') || sig.type.startsWith('sell'));
    if (isBuy)  signalMap[t] = 1;
    if (isSell) signalMap[t] = -1;
  });

  // Apply direction filter
  const applyDirection = (pos) => {
    if (direction === 'long_only')  return pos > 0  ? pos : 0;
    if (direction === 'short_only') return pos < 0  ? pos : 0;
    return pos;
  };

  // Simulate
  let cash = initialCapital;
  const equityArr   = [];
  const dateArr     = [];
  const trades      = [];
  let currentPos    = 0;
  let sharesHeld    = 0;

  klineData.forEach((bar) => {
    const price    = bar.close;
    const rawSig   = signalMap[bar.time];
    const targetPos = rawSig !== undefined ? applyDirection(rawSig) : currentPos;

    if (targetPos !== currentPos) {
      // Close existing position first
      if (currentPos !== 0) {
        const revenue = sharesHeld * price;
        const fee = Math.abs(revenue) * commissionRate;
        cash += revenue - fee;
        if (trades.length > 0 && trades[trades.length - 1].status === 'open') {
          const t = trades[trades.length - 1];
          t.exitTime  = bar.time;
          t.exitPrice = price;
          t.exitFee   = fee;
          // Fixed profit calculation: (Price - EntryPrice) * Shares - Fees
          t.profit    = (t.type === 'long') ? (sharesHeld * (price - t.entryPrice) - (t.entryFee + fee)) : (Math.abs(sharesHeld) * (t.entryPrice - price) - (t.entryFee + fee));
          t.profitPct = t.profit / t.entryCash;
          t.status    = 'closed';
        }
      }
      // Open new position
      if (targetPos !== 0) {
        const fee  = cash * commissionRate;
        const avail = cash - fee;
        sharesHeld = targetPos > 0 ? avail / price : -(avail / price);
        cash      -= sharesHeld * price;
        trades.push({
          type:       targetPos > 0 ? 'long' : 'short',
          entryTime:  bar.time,
          entryPrice: price,
          entryFee:   fee,
          entryCash:  avail,
          shares:     sharesHeld,
          status:     'open'
        });
      } else {
        sharesHeld = 0;
      }
      currentPos = targetPos;
    }

    equityArr.push(cash + sharesHeld * price);
    dateArr.push(bar.time);
  });

  // ─── Performance Metrics ───────────────────────────────────
  const closedTrades = trades.filter(t => t.status === 'closed');
  const initCap  = initialCapital;
  const finalCap = equityArr[equityArr.length - 1];

  const cumReturn = (finalCap / initCap) - 1;
  const deltaDays = (dateArr[dateArr.length - 1] - dateArr[0]) / 86400;
  const years     = deltaDays > 0 ? deltaDays / 365.25 : 0;
  const cagr      = years > 0 && finalCap > 0 ? Math.pow(finalCap / initCap, 1 / years) - 1 : 0;

  // Max Drawdown
  let peak = equityArr[0], mdd = 0, mddStartIdx = 0, mddEndIdx = 0, tempPeak = 0;
  for (let i = 0; i < equityArr.length; i++) {
    if (equityArr[i] > peak) { peak = equityArr[i]; tempPeak = i; }
    const dd = (equityArr[i] - peak) / peak;
    if (dd < mdd) { mdd = dd; mddStartIdx = tempPeak; mddEndIdx = i; }
  }

  // Sharpe ratio (annualized, risk-free = 0)
  const dailyRets = [];
  for (let i = 1; i < equityArr.length; i++) {
    dailyRets.push((equityArr[i] - equityArr[i-1]) / equityArr[i-1]);
  }
  const meanRet = dailyRets.reduce((a,b) => a+b, 0) / (dailyRets.length || 1);
  const stdRet  = Math.sqrt(dailyRets.reduce((s,r) => s + (r - meanRet)**2, 0) / (dailyRets.length || 1));
  const sharpe  = stdRet !== 0 ? (meanRet / stdRet) * Math.sqrt(252) : 0;

  // Trade stats
  const winners   = closedTrades.filter(t => t.profit > 0);
  const losers    = closedTrades.filter(t => t.profit <= 0);
  const winRate   = closedTrades.length > 0 ? winners.length / closedTrades.length : 0;
  const grossProfit = winners.reduce((s,t) => s + t.profit, 0);
  const grossLoss   = Math.abs(losers.reduce((s,t) => s + t.profit, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? 999 : 0);

  // Advanced Stats
  let maxSingleProfit = 0, maxSingleProfitDate = 0;
  let maxSingleLoss = 0, maxSingleLossDate = 0;
  
  closedTrades.forEach(t => {
    if (t.profitPct > maxSingleProfit) { maxSingleProfit = t.profitPct; maxSingleProfitDate = t.exitTime; }
    if (t.profitPct < maxSingleLoss) { maxSingleLoss = t.profitPct; maxSingleLossDate = t.exitTime; }
  });

  return {
    cumReturn, cagr, mdd,
    mddStartDate: dateArr[mddStartIdx],
    mddEndDate:   dateArr[mddEndIdx],
    sharpe, winRate, profitFactor,
    maxSingleProfit, maxSingleProfitDate,
    maxSingleLoss, maxSingleLossDate,
    totalTrades:  closedTrades.length,
    initialCapital: initCap,
    finalCapital:   finalCap,
    trades: closedTrades,
    equity: equityArr.map((v, i) => ({ time: dateArr[i], value: v }))
  };
}

function fmtPct(n) { return (n >= 0 ? '+' : '') + (n * 100).toFixed(2) + '%'; }
function fmtTs(ts) {
  if (!ts) return '--';
  const d = new Date(ts * 1000);
  return d.toISOString().slice(0, 10);
}

async function runBacktest() {
  const btn = document.getElementById('backtestRunBtn') || document.querySelector('.backtest-btn');
  if (btn) { btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 回测中...'; btn.disabled = true; }

  const resPanel = document.getElementById('backtestResults');
  if (resPanel) resPanel.innerHTML = '<div class="sr-empty"><i class="fas fa-spinner fa-spin"></i><div>正在加载数据与策略信号...</div></div>';

  try {
    // ── 1. Load OHLCV Data ──
    const sym = currentSymbol || 'AAPL';
    const tf  = (currentTF === '1m' || currentTF === '5d') ? '1d' : currentTF;
    let data  = [];
    const csvUrl = `${CONFIG.RAW_BASE}/${CONFIG.DATA_PATH}/${sym}_${tf}.csv`;
    const res = await fetch(csvUrl);
    if (res.ok) data = parseCSV(await res.text());

    if (!data.length) {
      if (resPanel) resPanel.innerHTML = '<div class="sr-empty">未找到该标的历史数据，请先点击侧边栏标的加载行情。</div>';
      if (btn) { btn.innerHTML = '<i class="fas fa-play"></i> 开始回测'; btn.disabled = false; }
      return;
    }

    // ── 2. Apply Date Range Filter ──
    const startVal = document.getElementById('bt-start-date')?.value;
    const endVal   = document.getElementById('bt-end-date')?.value  || new Date().toISOString().slice(0, 10);
    const startTs  = startVal ? Math.floor(new Date(startVal).getTime() / 1000) : 0;
    const endTs    = Math.floor(new Date(endVal).getTime() / 1000) + 86400;
    const filtered = data.filter(d => d.time >= startTs && d.time <= endTs);

    if (filtered.length < 5) {
      if (resPanel) resPanel.innerHTML = '<div class="sr-empty">日期区间内数据不足 (至少需要5根K线)，请扩大范围。</div>';
      if (btn) { btn.innerHTML = '<i class="fas fa-play"></i> 开始回测'; btn.disabled = false; }
      return;
    }

    // ── 3. Call FastAPI Backend for Signals ──
    let sigData = [];
    let isCzscUsed = false;
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

    // Show Loading Progress
    const loadingEl = document.getElementById('bt-loading');
    if (loadingEl) loadingEl.style.display = 'block';

    try {
      if (isLocal) {
        // Dynamic Calculation via FastAPI
        const apiRes = await fetch(`${CONFIG.LOCAL_BASE}/api/run_strategy`, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({ symbol: sym, timeframe: tf })
        });
        if (apiRes.ok) {
          const resp = await apiRes.json();
          if (resp.status === 'success') {
            sigData = resp.data.markers || [];
            isCzscUsed = sigData.length > 0;
          } else {
            console.error(resp.message);
          }
        }
      } else {
        // Fallback for Github Pages static version
        const sigUrl = `${CONFIG.RAW_BASE}/${CONFIG.DATA_PATH}/analysis/${sym}_${tf}_signals.json`;
        const sigRes = await fetch(sigUrl);
        if (sigRes.ok) {
          const sj = await sigRes.json();
          sigData = sj.markers || [];
          isCzscUsed = sigData.length > 0;
        }
      }
    } catch(e) {
      console.error(e);
    } finally {
      if (loadingEl) loadingEl.style.display = 'none';
    }

    // Fallback logic removed as per user request.
    // We only use sigData if it was successfully loaded from the JSON analysis metadata.

    // ── 4. Run Engine ──
    const capital    = parseFloat(document.getElementById('bt-capital')?.value || 100000);
    const commission = parseFloat(document.getElementById('bt-commission')?.value || 0.1) / 100;
    const direction  = document.getElementById('bt-direction')?.value || 'long_only';

    const result = runBacktestEngine(filtered, sigData, {
      initialCapital: capital,
      commissionRate: commission,
      direction
    });

    if (result.error) {
      if (resPanel) resPanel.innerHTML = `<div class="sr-empty">${result.error}</div>`;
      if (btn) { btn.innerHTML = '<i class="fas fa-play"></i> 开始回测'; btn.disabled = false; }
      return;
    }

    // ── 5. Render Markers on chart ──
    if (candleSeries && result.trades.length > 0) {
      const markers = [];
      result.trades.forEach(t => {
        markers.push({ time: t.entryTime, position: 'belowBar', color: '#00F5D4', shape: 'arrowUp',   text: `B@${t.entryPrice.toFixed(2)}` });
        if (t.exitTime) markers.push({ time: t.exitTime,  position: 'aboveBar', color: '#FF9F9F', shape: 'arrowDown', text: `S(${fmtPct(t.profitPct)})` });
      });
      markers.sort((a,b) => a.time - b.time);
      try { candleSeries.setMarkers(markers); } catch(e) {}
    }

    // ── 6. Render Results Panel ──
    const inclusion = document.getElementById('s-inclusion')?.value || 'None';
    const biType = document.getElementById('s-bi-type')?.value || 'Standard';
    
    const signalNote = isCzscUsed
      ? `✨ 采用缠论信号回测 (参数: ${inclusion}, ${biType})`
      : `⚠️ 未发现缠论预分析信号，已自动切换至 EMA(20)/SMA(50) 趋势系统进行基准回测。`;

    const cards = [
      { label: '累计收益率',   val: fmtPct(result.cumReturn),  cls: result.cumReturn >= 0 ? 'positive':'negative' },
      { label: '年化收益率',   val: fmtPct(result.cagr),       cls: result.cagr >= 0 ? 'positive':'negative' },
      { label: '最大回撤',     val: fmtPct(result.mdd),        cls: 'negative' },
      { label: '夏普比率',     val: result.sharpe.toFixed(2),  cls: result.sharpe >= 1 ? 'positive': result.sharpe >= 0 ? '' : 'negative' },
      { label: '胜率',         val: fmtPct(result.winRate),    cls: result.winRate >= 0.5 ? 'positive' : 'negative' },
      { label: '盈亏比',       val: result.profitFactor === 999 ? '∞' : result.profitFactor.toFixed(2), cls: result.profitFactor >= 1.5 ? 'positive' : 'negative' },
      { label: '最大单笔盈利', val: fmtPct(result.maxSingleProfit), cls: 'positive' },
      { label: '总交易次数',   val: result.totalTrades + ' 次',  cls: '' },
    ];
    
    const cardsHtml = cards.map(c => `
      <div class="sr-card">
        <div class="sr-label">${c.label}</div>
        <div class="sr-val ${c.cls}">${c.val}</div>
      </div>
    `).join('');

    const mddRange = result.totalTrades > 0
      ? `最大回撤周期: ${fmtTs(result.mddStartDate)} ➔ ${fmtTs(result.mddEndDate)}`
      : '';
    const maxProfitTs = result.maxSingleProfitDate ? `单笔最佳成交日: ${fmtTs(result.maxSingleProfitDate)}` : '';

    resPanel.innerHTML = `
      <div class="sr-header-info">
        <h3>📊 策略回测报告 · ${sym} <span class="sr-period">${fmtTs(filtered[0].time)} ~ ${fmtTs(filtered[filtered.length-1].time)}</span></h3>
        <div class="sr-note">${signalNote}</div>
      </div>
      <div class="sr-grid">${cardsHtml}</div>
      <div class="sr-meta-row">
        <span><i class="far fa-calendar-check"></i> ${mddRange}</span>
        <span><i class="far fa-star"></i> ${maxProfitTs}</span>
      </div>
      <div class="sr-chart-section">
        <div class="sr-chart-header">
          <span class="sr-chart-title"><i class="fas fa-chart-area"></i> 累计资产净值曲线 (Equity Curve)</span>
          <span class="sr-capital-info">初始: $${result.initialCapital.toLocaleString()} ➔ 最终: $${result.finalCapital.toLocaleString()}</span>
        </div>
        <div id="equityChartContainer" class="equity-chart-box"></div>
      </div>
    `;

    // ── 7. Render equity curve ──
    renderEquityCurve(result.equity, result.initialCapital);

  } catch(err) {
    console.error('Backtest error:', err);
    if (resPanel) resPanel.innerHTML = `<div class="sr-empty">回测执行出错: ${err.message}</div>`;
  } finally {
    if (btn) { btn.innerHTML = '<i class="fas fa-play"></i> 开始回测'; btn.disabled = false; }
  }
}

function renderEquityCurve(equityData, initialCapital) {
  const container = document.getElementById('equityChartContainer');
  if (!container || !equityData || !equityData.length) return;

  try {
    const eqChart = LightweightCharts.createChart(container, {
      width:  container.clientWidth || 400,
      height: 220,
      layout: {
        background: { type: 'solid', color: 'rgba(0,0,0,0)' },
        textColor: 'rgba(255,255,255,0.5)',
        fontFamily: "'Inter', sans-serif"
      },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.04)' },
        horzLines: { color: 'rgba(255,255,255,0.04)' }
      },
      timeScale: { borderVisible: false },
      rightPriceScale: { borderVisible: false },
      handleScroll: false,
      handleScale: false
    });

    const areaSer = eqChart.addAreaSeries({
      lineColor: '#2196F3',
      topColor:  'rgba(33,150,243,0.35)',
      bottomColor: 'rgba(33,150,243,0.0)',
      lineWidth: 2
    });
    // Add baseline
    const baselineSer = eqChart.addLineSeries({
      color: 'rgba(255,255,255,0.2)',
      lineWidth: 1,
      lineStyle: 2, // dashed
      lastValueVisible: false,
      priceLineVisible: false
    });

    const baselineData = equityData.map(d => ({ time: d.time, value: initialCapital }));
    areaSer.setData(equityData);
    baselineSer.setData(baselineData);
    eqChart.timeScale().fitContent();

    // Resize observer
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        eqChart.resize(entry.contentRect.width, 220);
      }
    });
    ro.observe(container);
  } catch(e) {
    console.error('Equity chart error:', e);
  }
}

// ── Overlay Controls ──
function toggleChanlunIndicators(checked) {
  if (checked) {
    loadSignals(currentSymbol, currentTF);
  } else {
    signalSeriesList.forEach(s => chart.removeSeries(s));
    signalSeriesList = [];
    if (candleSeries) {
      try { candleSeries.setMarkers([]); } catch(e){}
    }
  }
}

function openStrategyOverlay() {
  const el = document.getElementById('strategyOverlay');
  if (el) el.classList.add('active');
}

function closeStrategyOverlay() {
  const el = document.getElementById('strategyOverlay');
  if (el) el.classList.remove('active');
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
