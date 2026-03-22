import pandas as pd
import os
import json
import glob
try:
    from czsc import CZSC as CzscIter, RawBar
except ImportError:
    from czsc.analyze import CZSC as CzscIter
    from czsc.objects import RawBar
from datetime import datetime

# Configuration
DATA_DIR = "data"
SIGNALS_DIR = os.path.join(DATA_DIR, "analysis")
os.makedirs(SIGNALS_DIR, exist_ok=True)

def analyze_ticker(csv_path):
    filename = os.path.basename(csv_path)
    # Expected format: AAPL_1d.csv
    try:
        parts = filename.replace(".csv", "").split("_")
        if len(parts) < 2: return
        symbol = parts[0]
        interval = parts[1]
    except:
        return

    print(f"Analyzing {symbol} ({interval})...")
    
    try:
        # Load CSV
        df = pd.read_csv(csv_path)
        if df.empty or len(df) < 50: return # Need some data to analyze

        # Find columns
        cols = df.columns
        date_col = next((c for c in cols if "Date" in c or "dt" in c or c == "Unnamed: 0"), None)
        
        # Prepare bars for CZSC
        bars = []
        for _, row in df.iterrows():
            try:
                dt_str = str(row[date_col])
                # Convert to datetime object if possible, then back to ISO or timestamp
                dt = pd.to_datetime(dt_str)
                
                bar = RawBar(
                    symbol=symbol,
                    dt=dt,
                    open=float(row['Open']),
                    close=float(row['Close']),
                    high=float(row['High']),
                    low=float(row['Low']),
                    vol=float(row['Volume']),
                    amount=0 # Optional
                )
                bars.append(bar)
            except:
                continue

        if not bars: return

        # Perform Analysis
        ci = CzscIter(bars)
        
        # Extract Fractals (分型)
        fx_list = []
        for fx in ci.fx_list:
            fx_list.append({
                "dt": fx.dt.strftime('%Y-%m-%d %H:%M:%S'),
                "mark": str(fx.mark), # d/g (bottom/top)
                "high": fx.high,
                "low": fx.low
            })

        # Extract Segments (笔)
        bi_list = []
        for bi in ci.bi_list:
            bi_list.append({
                "start_dt": bi.start_dt.strftime('%Y-%m-%d %H:%M:%S'),
                "end_dt": bi.end_dt.strftime('%Y-%m-%d %H:%M:%S'),
                "direction": "up" if str(bi.direction).lower() in ['up', '1', 'g'] else "down",
                "high": float(bi.high),
                "low": float(bi.low)
            })

        # 提取线段 (Duan)
        xd_list = []
        try:
            source_xd = getattr(ci, 'xd_list', [])
            for xd in source_xd:
                xd_list.append({
                    "start_dt": xd.start_dt.strftime('%Y-%m-%d %H:%M:%S'),
                    "end_dt": xd.end_dt.strftime('%Y-%m-%d %H:%M:%S'),
                    "direction": "up" if str(xd.direction).lower() in ['up', '1', 'g'] else "down",
                    "high": float(xd.high),
                    "low": float(xd.low)
                })
        except: pass

        # 提取中枢 (ZhongShu)
        zs_list = []
        try:
            # 提取笔中枢
            source_zs = getattr(ci, 'bi_zs_list', getattr(ci, 'zs_list', []))
            for zs in source_zs:
                zg = getattr(zs, 'zg', 0)
                zd = getattr(zs, 'zd', 0)
                zs_list.append({
                    "start_dt": zs.s_dt.strftime('%Y-%m-%d %H:%M:%S') if hasattr(zs, 's_dt') else "",
                    "end_dt": zs.e_dt.strftime('%Y-%m-%d %H:%M:%S') if (hasattr(zs, 'e_dt') and zs.e_dt) else "Running",
                    "zg": float(zg) if zg is not None else 0.0,
                    "zd": float(zd) if zd is not None else 0.0,
                    "gg": float(getattr(zs, 'gg', zg)) if getattr(zs, 'gg', zg) is not None else 0.0,
                    "dd": float(getattr(zs, 'dd', zd)) if getattr(zs, 'dd', zd) is not None else 0.0
                })
        except: pass
        
        # 提取买卖点标记 (Markers) - 移除未来函数
        markers = []
        try:
            # 在缠论中，笔的结束点（最高/最低点）只有在后续走势满足分型+长度规则后才能被确认。
            # 为了避免“未来函数”，我们将标记放在“确认点（Confirmation Time）”而非“极值点（Peak/Trough Time）”。
            # 这里简单起见，我们将标记在笔结束后的第 5 根 K 线（缠论标准笔的基本确认周期）显示。
            for i, bi in enumerate(ci.bi_list):
                # 获取该笔结束后的数据流，寻找确认发生的时机
                # 实际 CZSC 会有特定的信号字典，这里我们做一个非未来的偏移
                confirm_idx = -1
                for j, bar in enumerate(ci.bars):
                    if bar.dt > bi.end_dt:
                        # 找到第一个后续 Bar (实际上需要 4-5 根确认)
                        # 为了严谨，我们取笔结束时间 + 5根 Bar 的时间作为执行点
                        conf_idx = j + 4
                        if conf_idx < len(ci.bars):
                            confirm_dt = ci.bars[conf_idx].dt
                            is_buy = str(bi.direction).lower() in ['down', '-1', 'd']
                            markers.append({
                                "time": confirm_dt.strftime('%Y-%m-%d %H:%M:%S'),
                                "peak_time": bi.end_dt.strftime('%Y-%m-%d %H:%M:%S'), # 记录极值点供参考
                                "position": "belowBar" if is_buy else "aboveBar",
                                "color": "#00FFD1" if is_buy else "#FF5E5E",
                                "shape": "arrowUp" if is_buy else "arrowDown",
                                "text": "B ★" if is_buy else "S ★",
                                "type": "Buy1_Confirmed" if is_buy else "Sell1_Confirmed",
                                "size": 2
                            })
                            break
        except Exception as e:
            print(f"  Marker extraction (Non-Future) failed: {e}")

        # Save Results
        num_fx = len(fx_list)
        num_bi = len(bi_list)
        
        result = {
            "symbol": symbol,
            "interval": interval,
            "last_update": datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            "fractals": fx_list,
            "bi": bi_list,
            "segments": xd_list,
            "zhongshu": zs_list,
            "markers": markers
        }

        output_file = os.path.join(SIGNALS_DIR, f"{symbol}_{interval}_signals.json")
        with open(output_file, "w", encoding="utf-8") as f:
            json.dump(result, f, indent=2)
            
    except Exception as e:
        print(f"  Error analyzing {filename}: {e}")


def main():
    csv_files = [os.path.join(DATA_DIR, "AAPL_1d.csv")]
    if not os.path.exists(csv_files[0]):
        csv_files = glob.glob(os.path.join(DATA_DIR, "*.csv"))[:10] # Fallback to first 10
    
    print(f"Found {len(csv_files)} data files to analyze.")
    
    for f in csv_files:
        analyze_ticker(f)

if __name__ == "__main__":
    main()
