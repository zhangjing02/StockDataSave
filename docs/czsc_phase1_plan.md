# 🔬 缠论量化升级 · Phase 1 研究计划

**计划日期**：2026-03-22  
**计划人**：AI 辅助研究（基于 [waditu/czsc](https://github.com/waditu/czsc) 深度解析）  
**执行周期**：预计 1-2 周  
**状态**：🔲 规划中

---

## 背景与动机

当前项目已能通过 `czsc` 库自动识别**分型、笔、线段、中枢**，并在前端展示。但分析深度仅停留在"展示缠论结构"阶段，距离缠论真正的核心——**背驰判断与买卖点分类**——还有明显差距。

通过对 `waditu/czsc`（4.7k ⭐）官方代码和 CLAUDE.md 架构文档的深度研究，梳理出当前项目的核心缺口及补全路径。

---

## 差距分析

| 能力维度 | 当前状态 | 目标水准（czsc 标准） |
|---------|----------|----------------------|
| 分型/笔/线段识别 | ✅ 已实现 | 同级别 |
| 中枢识别 | ✅ 基础实现 | 更丰富（多阶中枢） |
| **MACD 背驰判断** | ❌ 缺失 | 相邻同向笔面积对比 |
| **1/2/3 类买卖点** | ⚠️ 仅简单标记 | 严格的类型分类 |
| 多周期信号联立 | ❌ 单周期 | 日线 + 周线联立确认 |
| 信号→事件→交易体系 | ❌ 无 | AND/OR/NOT 逻辑组合 |

---

## Phase 1 目标

> **核心目标**：让缠论分析结果**有据可依**，区分强弱买卖点。

### 目标 1：全标的全周期数据覆盖（`us_data_fetcher.py`）

- 当前：仅部分标的生成 CZSC 分析结果
- 目标：`watch_list.json` 中全部 53 个标的（股票 + ETF + 加密），全部生成 `1d`、`1wk`、`1mo` 三个周期的 `*_czsc.json`

### 目标 2：MACD 背驰信号（`run_czsc_analysis.py`）

缠论最核心的转折判断依据。实现思路：

```python
# 计算每根笔对应区间的 MACD 柱状图面积
def calc_bi_macd_area(kline_df, bi):
    mask = (df['dt'] >= bi.start_dt) & (df['dt'] <= bi.end_dt)
    return df.loc[mask, 'MACD_hist'].abs().sum()

# 相邻同向笔 MACD 面积递减 → 背驰
is_diverge = (cur_bi_area < prev_bi_area) and (cur_bi_area < prev_prev_bi_area)
```

输出字段加入 `analysis JSON`：
```json
{
  "bi_diverge": true,          // 当前笔是否背驰
  "diverge_strength": "weak"  // 背驰强度：strong / medium / weak
}
```

### 目标 3：严格的 1/2/3 类买卖点分类

| 买点类型 | 判断条件 | 信号强度 |
|---------|---------|---------|
| **B1（一类买点）** | 下跌笔出现背驰（MACD 面积收缩） | ⭐⭐⭐ 最强 |
| **B2（二类买点）** | 反弹后回调不破 B1 低点，新一笔向上启动 | ⭐⭐ 中 |
| **B3（三类买点）** | 中枢上方第一笔回调结束，不进入中枢 | ⭐ 趋势跟踪 |

卖点 S1/S2/S3 对应逻辑相反。

### 目标 4：前端信号可视化升级（`app.js`）

- B1 → 绿色大圆点
- B2 → 绿色中圆点  
- B3 → 绿色小圆点
- S1/S2/S3 → 对应红色标记
- 背驰警告 → 笔尾部加黄色闪烁提示

---

## 交付物

| 产出 | 文件 | 说明 |
|------|------|------|
| 升级版分析脚本 | `run_czsc_analysis.py` | 含 MACD 背驰 + 买卖点分类 |
| 升级版数据抓取 | `us_data_fetcher.py` | 覆盖所有标的所有周期 |
| 前端可视化升级 | `app.js` | 买卖点分类渲染 |
| 更新后数据格式 | `data/*_czsc.json` | 包含 `bi_diverge`、`signal_type` 字段 |

---

## 后续规划

- **Phase 2**（中期）：多周期信号联立 — 日线方向 + 周线大背景确认，输出 `composite_signal`
- **Phase 3**（长期）：向 `CzscTrader` 靠拢，实现真正的信号→事件→仓位权重体系

---

> [!NOTE]
> 本计划基于对 [waditu/czsc CLAUDE.md](https://github.com/waditu/czsc/blob/master/CLAUDE.md) 的深度解读，
> czsc 项目核心采用"信号(Signal) → 事件(Event) → 交易(Trade)"三层架构，本期计划是向该架构迁移的第一步。
