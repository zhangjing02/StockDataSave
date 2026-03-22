# 🕯️ 缠论美股分析仪（Chanlun US Stock Dashboard）

基于**缠中说禅（缠论）**理论对美股市场进行技术分析的量化研究项目。以 [waditu/czsc](https://github.com/waditu/czsc) 为技术底层，自动识别分型、笔、线段、中枢，并通过前端可视化界面展示分析结果。

---

## 🎯 项目目标

1. **自动化数据采集**：每个交易日自动抓取美股/ETF/加密货币数据
2. **缠论结构识别**：自动计算分型、笔、线段、中枢等核心要素
3. **买卖点标注**：在 K 线图上标注潜在买卖点，辅助研判
4. **多周期分析**：支持日线、周线、月线等多个时间维度
5. **Web 可视化**：通过轻量级 HTML 前端实时展示分析结果

---

## 🏗️ 项目架构

```
StockDataSave/
├── index.html              # 前端入口页面（部署在 Vercel）
├── app.js                  # 前端逻辑：图表渲染 + 信号展示
├── style.css               # 样式文件
│
├── us_data_fetcher.py      # 数据抓取脚本（yfinance / Tiingo API）
├── run_czsc_analysis.py    # 缠论分析脚本（调用 czsc 库）
├── news_fetcher.py         # 新闻资讯抓取脚本
├── create_mock_signals.py  # 本地调试用模拟数据生成
│
├── server.py               # 本地开发用简易 HTTP 服务
├── vercel.json             # Vercel 部署配置
├── requirements.txt        # Python 依赖
├── watch_list.json         # 监控标的列表（股票/ETF/加密货币）
│
├── data/                   # 数据目录（由 Action 自动生成，见下文）
│   ├── AAPL_1d.csv         # 原始 K 线数据（每标的每周期一个 CSV）
│   ├── AAPL_1d_czsc.json   # 缠论分析结果（JSON）
│   ├── news.json           # 最新资讯
│   └── ...
│
└── .github/workflows/
    └── daily_update.yml    # GitHub Actions 自动化工作流
```

### 监控标的（`watch_list.json`）

| 类别 | 数量 | 代表标的 |
|------|------|----------|
| 美股 | 35 只 | AAPL、NVDA、TSLA、META、MSFT... |
| ETF | 8 只 | SPY、QQQ、SMH、ARKK... |
| 加密 | 10 个 | BTC-USD、ETH-USD、SOL-USD... |

---

## 📊 数据流说明

```
每个工作日 UTC 21:00（美东 17:00，美股收盘后）
           ↓
[GitHub Actions] daily_update.yml 触发
           ↓
① us_data_fetcher.py  →  下载全部标的 1d/1wk/1mo 数据  →  data/*.csv
② run_czsc_analysis.py →  对每个 CSV 执行缠论分析       →  data/*_czsc.json
③ news_fetcher.py      →  抓取相关资讯                  →  data/news.json
           ↓
推送到 data-sync 分支（⚠️ 不是 main）
           ↓
前端通过 fetch() 直接读取 GitHub raw 文件（data-sync 分支）
```

**数据格式（`*_czsc.json` 示例）：**
```json
{
  "symbol": "AAPL",
  "interval": "1d",
  "updated_at": "2026-03-22T21:00:00Z",
  "bars": [...],
  "fractals": [...],
  "segments": [...],
  "zhongshus": [...],
  "markers": [...]
}
```

---

## 🌿 Git 分支策略

本项目使用**双分支设计**，彻底避免代码推送与数据同步产生 Git 冲突。

| 分支 | 用途 | 谁来写 |
|------|------|--------|
| `main` | 代码（HTML/JS/Python 脚本）| 开发者手动推送 |
| `data-sync` | 数据文件（`data/` 目录）| GitHub Actions 自动生成（force push） |

### 为什么这样设计？

**问题根因**：如果 Action 触发于 `main` 的 push 且又向 `main` 推送数据，则
当开发者同时在推送代码时会产生 **Git 冲突**（两者同时写同一分支）。

**解决方案**：
- `daily_update.yml` **不再**监听 `push` 事件，只按定时计划（`schedule`）或手动触发
- Action 的数据提交全部强制推送（`--force`）到 `data-sync` 分支
- 前端从 `data-sync` 分支读取数据，与 `main` 的代码更新互不干扰

### Vercel 部署

Vercel 直接连接 **`main` 分支**，每次开发者推送代码后自动触发前端重新部署。前端是纯静态页面，通过 `fetch()` 读取远程数据，无需服务器。

---

## 🚀 快速开始

### 本地开发

```bash
# 1. 安装 Python 依赖
pip install -r requirements.txt
pip install czsc yfinance  # 额外依赖

# 2. 拉取数据（需要 Tiingo API Key，可选）
export TIINGO_API_KEY=your_key_here
python us_data_fetcher.py

# 3. 运行缠论分析
python run_czsc_analysis.py

# 4. 启动本地服务查看结果
python server.py
# 访问 http://localhost:8080
```

### 手动触发数据更新

GitHub → Actions → `Daily Stock Data Update` → `Run workflow`

---

## 📈 当前功能进度

| 功能模块 | 状态 | 说明 |
|---------|------|------|
| 多标的数据抓取 | ✅ 完成 | yfinance + Tiingo 双数据源 |
| 分型识别 | ✅ 完成 | 调用 czsc 库自动识别 |
| 笔识别 | ✅ 完成 | 支持日线/周线/月线 |
| 线段识别 | ✅ 完成 | 基础实现 |
| 中枢识别 | ✅ 完成 | 含 ZG/ZD/GG/DD 四维价格 |
| 基础买卖点 | ✅ 完成 | 笔尾部简单标记 |
| **MACD 背驰判断** | 🔲 规划中 | Phase 1 目标 |
| **1/2/3 类买卖点分类** | 🔲 规划中 | Phase 1 目标 |
| 多周期信号联立 | 🔲 规划中 | Phase 2 目标 |
| 信号-事件-交易体系 | 🔲 规划中 | Phase 3 目标 |
| K 线图前端展示 | ✅ 完成 | Lightweight Charts |
| 资讯面板 | ✅ 完成 | 自动抓取 |

---

## 📚 研究计划

- [🔬 Phase 1 研究计划（2026-03-22）](docs/czsc_phase1_plan.md)
  — 缠论分析深度对齐 czsc 项目，补全 MACD 背驰与买卖点分类

---

## 🔗 相关资源

- [czsc 官方仓库](https://github.com/waditu/czsc)
- [缠论原文](https://github.com/waditu/czsc#%E7%BC%A0%E8%AE%BA%E5%8E%9F%E6%96%87)
- [czsc 飞书文档](https://s0cqcxuy3p.feishu.cn/wiki/wikcn3gB1MKl3ClpLnboHM1QgKf)
