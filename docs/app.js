/**
 * CZSC 美股量化分析平台 - 核心逻辑
 * 数据源：GitHub Raw (zhangjing02/StockDataSave)
 */

// ============================================================
// 配置
// ============================================================
const CONFIG = {
  REPO_RAW: 'https://raw.githubusercontent.com/zhangjing02/StockDataSave/main',
  REPO_OWNER: 'zhangjing02',
  REPO_NAME: 'StockDataSave',
  SYMBOLS_STOCKS: ['AAPL', 'TSLA', 'MSFT', 'NVDA'],
  SYMBOLS_ETFS: ['SPY', 'QQQ'],
  DEFAULT_SYMBOL: 'AAPL',
  DEFAULT_TF: '5m',
};

// ============================================================
// 全局状态
// ============================================================
const state = {
  currentSymbol: CONFIG.DEFAULT_SYMBOL,
  currentTF: CONFIG.DEFAULT_TF,
  chart: null,
  candleSeries: null,
  volumeSeries: null,
  priceCache: {},  // symbol -> last price info
};

// ============================================================
// 工具函数
// ============================================================

/** 获取 UTC 偏移的当前日期字符串 YYYY-MM-DD */
function todayStr() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

/** 解析 CSV 文本 → [{time, open, high, low, close, volume}] */
function parseCSV(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    if (cols.length < 7) continue;
    // cols: symbol, dt, open, close, high, low, vol, amount
    const dtStr = cols[1].trim();      // "2026-03-02 14:30:00"
    const open   = parseFloat(cols[2]);
    const close  = parseFloat(cols[3]);
    const high   = parseFloat(cols[4]);
    const low    = parseFloat(cols[5]);
    const vol    = parseFloat(cols[6]);
    if (isNaN(open) || isNaN(close)) continue;
    // Convert dt → Unix timestamp (UTC)
    const ts = Math.floor(new Date(dtStr + 'Z').getTime() / 1000);
    rows.push({ time: ts, open, high, low, close, value: vol });
  }
  // Sort ascending by time
  rows.sort((a, b) => a.time - b.time);
  return rows;
}

/** 生成从 startMonth 到 endMonth 的月份列表 (格式 YYYY-MM) */
function monthRange(startYM, endYM) {
  const result = [];
  let [sy, sm] = startYM.split('-').map(Number);
  const [ey, em] = endYM.split('-').map(Number);
  while (sy < ey || (sy === ey && sm <= em)) {
    result.push(`${sy}-${String(sm).padStart(2, '0')}`);
    sm++;
    if (sm > 12) { sm = 1; sy++; }
  }
  return result;
}

/** 格式化数字 */
function fmt(n, decimals = 2) {
  if (n === undefined || n === null || isNaN(n)) return '—';
  return n.toFixed(decimals);
}

function fmtVol(v) {
  if (!v || isNaN(v)) return '—';
  if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K';
  return v.toFixed(0);
}

// ============================================================
// 数据加载
// ============================================================

/**
 * 拉取某标的的全部月份 CSV 并合并
 * 5m 数据：data/{symbol}/{YYYY-MM}_5m.csv
 */
async function fetchAllData(symbol, tf) {
  // 从 2026-02 起（Actions 第一次跑的时间）到当前月
  const start = '2026-02';
  const nowD  = new Date();
  const end   = `${nowD.getUTCFullYear()}-${String(nowD.getUTCMonth() + 1).padStart(2, '0')}`;
  const months = monthRange(start, end);

  const suffix = tf === '5m' ? '_5m' : '_1d';
  const fetches = months.map(m =>
    fetch(`${CONFIG.REPO_RAW}/data/${symbol}/${m}${suffix}.csv`)
      .then(r => r.ok ? r.text() : '')
      .catch(() => '')
  );

  const texts = await Promise.all(fetches);
  let allRows = [];
  for (const txt of texts) {
    if (txt) allRows = allRows.concat(parseCSV(txt));
  }

  // 去重并排序（按 time）
  const seen = new Set();
  const deduped = allRows.filter(r => {
    if (seen.has(r.time)) return false;
    seen.add(r.time);
    return true;
  });
  deduped.sort((a, b) => a.time - b.time);
  return deduped;
}

// ============================================================
// 图表初始化
// ============================================================

function initChart() {
  const container = document.getElementById('chartContainer');
  const { width, height } = container.getBoundingClientRect();

  state.chart = LightweightCharts.createChart(container, {
    width,
    height,
    layout: {
      background: { color: '#0d1117' },
      textColor:  '#8b949e',
      fontFamily: 'Inter, sans-serif',
    },
    grid: {
      vertLines: { color: '#161b22' },
      horzLines: { color: '#161b22' },
    },
    crosshair: {
      mode: LightweightCharts.CrosshairMode.Normal,
      vertLine: { color: '#333d4c', labelBackgroundColor: '#21262d' },
      horzLine: { color: '#333d4c', labelBackgroundColor: '#21262d' },
    },
    rightPriceScale: {
      borderColor: '#21262d',
      textColor: '#8b949e',
    },
    timeScale: {
      borderColor: '#21262d',
      timeVisible: true,
      secondsVisible: false,
      tickMarkFormatter: (time) => {
        const d = new Date(time * 1000);
        return `${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}`;
      },
    },
    handleScroll: true,
    handleScale:  true,
  });

  // 蜡烛图
  state.candleSeries = state.chart.addCandlestickSeries({
    upColor:          '#3fb950',
    downColor:        '#f85149',
    borderUpColor:    '#3fb950',
    borderDownColor:  '#f85149',
    wickUpColor:      '#3fb950',
    wickDownColor:    '#f85149',
  });

  // 成交量（柱状，置于底部 20%）
  state.volumeSeries = state.chart.addHistogramSeries({
    color:         '#388bfd',
    priceFormat:   { type: 'volume' },
    priceScaleId:  'volume',
    scaleMargins:  { top: 0.85, bottom: 0 },
  });
  state.chart.priceScale('volume').applyOptions({
    scaleMargins: { top: 0.85, bottom: 0 },
    borderVisible: false,
  });

  // 十字线移动时更新右上角价格显示
  state.chart.subscribeCrosshairMove(param => {
    if (!param.time || !param.seriesData) return;
    const bar = param.seriesData.get(state.candleSeries);
    if (!bar) return;
    document.getElementById('priceValue').textContent = fmt(bar.close);
    document.getElementById('statOpen').textContent   = fmt(bar.open);
    document.getElementById('statHigh').textContent   = fmt(bar.high);
    document.getElementById('statLow').textContent    = fmt(bar.low);
    const volBar = param.seriesData.get(state.volumeSeries);
    document.getElementById('statVol').textContent    = volBar ? fmtVol(volBar.value) : '—';
  });

  // 响应式
  const ro = new ResizeObserver(() => {
    const { width: w, height: h } = container.getBoundingClientRect();
    state.chart.applyOptions({ width: w, height: h });
  });
  ro.observe(container);
}

// ============================================================
// 渲染数据
// ============================================================

async function loadChart(symbol, tf) {
  const overlay = document.getElementById('loadingOverlay');
  const errBox  = document.getElementById('errorBox');
  overlay.style.display = 'flex';
  errBox.style.display  = 'none';

  try {
    const rows = await fetchAllData(symbol, tf);

    if (!rows.length) {
      throw new Error(`未找到 ${symbol} 的行情数据（${tf}）。`);
    }

    // 拆分 candles / volume
    const candles = rows.map(r => ({
      time:  r.time,
      open:  r.open,
      high:  r.high,
      low:   r.low,
      close: r.close,
    }));
    const volumes = rows.map(r => ({
      time:  r.time,
      value: r.value,
      color: r.close >= r.open ? 'rgba(63,185,80,0.4)' : 'rgba(248,81,73,0.4)',
    }));

    state.candleSeries.setData(candles);
    state.volumeSeries.setData(volumes);
    state.chart.timeScale().fitContent();

    // 最新 bar 统计
    const last = rows[rows.length - 1];
    const first = rows[0];
    const chg   = ((last.close - first.open) / first.open * 100);

    document.getElementById('symbolName').textContent  = symbol;
    document.getElementById('symbolInfo').textContent  = `${getFullName(symbol)} · ${tf}`;
    document.getElementById('priceValue').textContent  = fmt(last.close);
    document.getElementById('statOpen').textContent    = fmt(last.open);
    document.getElementById('statHigh').textContent    = fmt(last.high);
    document.getElementById('statLow').textContent     = fmt(last.low);
    document.getElementById('statVol').textContent     = fmtVol(last.value);
    document.getElementById('statCount').textContent   = rows.length.toLocaleString() + ' 条';

    const chgEl = document.getElementById('priceChange');
    chgEl.textContent = `${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%`;
    chgEl.className = 'price-change ' + (chg >= 0 ? 'up' : 'down');

    // 缓存价格给侧边栏
    state.priceCache[symbol] = { price: last.close, chg };
    updateSidebarPrices();

  } catch (e) {
    console.error(e);
    errBox.style.display = 'block';
    errBox.textContent   = `⚠️ ${e.message}`;
  } finally {
    overlay.style.display = 'none';
  }
}

// ============================================================
// 侧边栏
// ============================================================

function getFullName(sym) {
  const map = {
    AAPL: 'Apple Inc.',
    TSLA: 'Tesla Inc.',
    MSFT: 'Microsoft Corp.',
    NVDA: 'NVIDIA Corp.',
    SPY:  'S&P 500 ETF',
    QQQ:  'Nasdaq 100 ETF',
  };
  return map[sym] || sym;
}

function buildSidebar(symbols, containerId, isETF = false) {
  const el = document.getElementById(containerId);
  el.innerHTML = '';
  for (const sym of symbols) {
    const item = document.createElement('div');
    item.className = 'stock-item' + (sym === state.currentSymbol ? ' active' : '');
    item.id = `stock-item-${sym}`;
    item.onclick = () => selectSymbol(sym);
    item.innerHTML = `
      <span class="stock-symbol">${sym}</span>
      <span class="stock-price" id="price-${sym}">—</span>
    `;
    el.appendChild(item);
  }
}

function updateSidebarPrices() {
  for (const [sym, info] of Object.entries(state.priceCache)) {
    const el = document.getElementById(`price-${sym}`);
    if (!el) continue;
    el.textContent = `$${fmt(info.price)}`;
    el.className = 'stock-price ' + (info.chg >= 0 ? 'up' : 'down');
  }
}

function selectSymbol(sym) {
  // Active highlight
  document.querySelectorAll('.stock-item').forEach(el => el.classList.remove('active'));
  const item = document.getElementById(`stock-item-${sym}`);
  if (item) item.classList.add('active');

  state.currentSymbol = sym;
  loadChart(sym, state.currentTF);
}

// ============================================================
// 时间周期切换
// ============================================================

function switchTimeframe(tf) {
  state.currentTF = tf;
  document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
  event.target.classList.add('active');
  loadChart(state.currentSymbol, tf);
}

// ============================================================
// Tab 切换
// ============================================================

function switchTab(tab) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab' + tab.charAt(0).toUpperCase() + tab.slice(1)).classList.add('active');
  event.target.classList.add('active');

  if (tab === 'news') {
    const input = document.getElementById('newsDateInput');
    if (!input.value) {
      input.value = todayStr();
      loadNews(input.value);
    }
  }
}

// ============================================================
// 新闻模块
// ============================================================

async function loadNews(dateStr) {
  if (!dateStr) return;
  const container = document.getElementById('newsContent');
  container.innerHTML = '<div class="news-loading">⏳ 正在加载新闻...</div>';

  const url = `${CONFIG.REPO_RAW}/data/news/${dateStr}.md`;
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('该日期暂无新闻数据。');
    const md = await resp.text();
    container.innerHTML = renderNewsMarkdown(md);
  } catch (e) {
    container.innerHTML = `<div class="news-empty">📭 ${e.message}</div>`;
  }
}

/**
 * 将新闻 Markdown 渲染为 HTML
 * 格式：## 标题、- 条目
 */
function renderNewsMarkdown(md) {
  const lines = md.split('\n');
  let html = '';
  let inSection = false;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (line.startsWith('# ')) {
      // 主标题：忽略（已有页面标题）
      continue;
    }

    if (line.startsWith('## ')) {
      if (inSection) html += '</div>';
      const title = line.replace('## ', '');
      html += `<div class="news-section"><div class="news-section-title">${title}</div>`;
      inSection = true;
      continue;
    }

    if (line.startsWith('- ') || line.startsWith('* ')) {
      const text = line.replace(/^[-*]\s+/, '');
      html += `<div class="news-item">
        <span class="news-bullet">›</span>
        <span class="news-text">${escapeHtml(text)}</span>
      </div>`;
    }
  }

  if (inSection) html += '</div>';
  return html || '<div class="news-empty">📭 无法解析新闻内容。</div>';
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ============================================================
// 市场状态（简单判断：美东时间 09:30~16:00 工作日）
// ============================================================

function updateMarketStatus() {
  const now = new Date();
  // 美东时间偏移：EST = UTC-5, EDT = UTC-4
  const etOffset = isDST(now) ? -4 : -5;
  const etHour   = (now.getUTCHours() + 24 + etOffset) % 24;
  const etMin    = now.getUTCMinutes();
  const etDay    = now.getUTCDay(); // 0=Sun
  const etTotal  = etHour * 60 + etMin;

  const isWeekday = etDay >= 1 && etDay <= 5;
  const isOpen    = isWeekday && etTotal >= 9 * 60 + 30 && etTotal < 16 * 60;

  const dot  = document.querySelector('.dot');
  const text = document.getElementById('marketStatusText');

  if (isOpen) {
    dot.classList.remove('closed');
    text.textContent = '美股交易中';
  } else {
    dot.classList.add('closed');
    const hh = String(etHour).padStart(2, '0');
    const mm = String(etMin).padStart(2, '0');
    text.textContent = `市场已收盘 (ET ${hh}:${mm})`;
  }
}

function isDST(date) {
  // 简版 DST：3月第2个周日到11月第1个周日
  const year = date.getUTCFullYear();
  const marchStart  = new Date(Date.UTC(year, 2, 14 - (new Date(Date.UTC(year, 2, 1)).getUTCDay() + 6) % 7, 7));
  const novEnd      = new Date(Date.UTC(year, 10, 7  - (new Date(Date.UTC(year, 10, 1)).getUTCDay() + 6) % 7, 6));
  return date >= marchStart && date < novEnd;
}

// ============================================================
// 入口
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  // 构建侧边栏
  buildSidebar(CONFIG.SYMBOLS_STOCKS, 'stockList');
  buildSidebar(CONFIG.SYMBOLS_ETFS,   'etfList', true);

  // 初始化图表
  initChart();

  // 加载默认标的
  loadChart(CONFIG.DEFAULT_SYMBOL, CONFIG.DEFAULT_TF);

  // 市场状态
  updateMarketStatus();
  setInterval(updateMarketStatus, 60_000);

  // 新闻日期默认今天
  document.getElementById('newsDateInput').max = todayStr();
});
