import pandas as pd
import os
import json
import glob
try:
    from czsc import CZSC as CzscIter, RawBar
    try:
        from czsc import Freq
    except Exception:
        Freq = None
except ImportError:
    from czsc.analyze import CZSC as CzscIter
    from czsc.objects import RawBar
    try:
        from czsc.objects import Freq
    except Exception:
        Freq = None
from datetime import datetime

# Configuration
DATA_DIR = "data"
SIGNALS_DIR = os.path.join(DATA_DIR, "analysis")
os.makedirs(SIGNALS_DIR, exist_ok=True)


def resolve_freq(interval):
    if Freq is None:
        return None

    name_map = {
        "1m": ["F1", "M1", "Min1"],
        "5m": ["F5", "M5", "Min5"],
        "1d": ["D", "Day"],
        "1wk": ["W", "Week"],
        "1mo": ["M", "Month"],
        "3mo": ["Q", "Quarter"],
        "1y": ["Y", "Year"]
    }

    for name in name_map.get(interval, []):
        if hasattr(Freq, name):
            return getattr(Freq, name)

    # Fallback: scan enum values by string representation.
    try:
        keywords = {
            "1m": ["1m", "1min", "minute"],
            "5m": ["5m", "5min"],
            "1d": ["1d", "day"],
            "1wk": ["1w", "week"],
            "1mo": ["1mo", "month"],
            "3mo": ["3mo", "quarter"],
            "1y": ["1y", "year"]
        }
        for item in Freq:
            text = f"{item} {getattr(item, 'value', '')}".lower()
            if any(k in text for k in keywords.get(interval, [])):
                return item
    except Exception:
        pass

    return None


def make_raw_bar(symbol, interval, idx, dt, o, c, h, l, v):
    base = {
        "symbol": symbol,
        "dt": dt,
        "open": o,
        "close": c,
        "high": h,
        "low": l,
        "vol": v,
        "amount": 0
    }
    # Legacy constructors
    try:
        return RawBar(**base)
    except TypeError:
        pass

    # Newer constructors often require id + freq
    freq = resolve_freq(interval)
    try:
        return RawBar(id=int(idx), freq=freq, **base)
    except TypeError:
        if freq is not None:
            return RawBar(id=int(idx), freq=str(freq), **base)
        raise


def normalize_direction(direction_obj):
    text = str(getattr(direction_obj, "value", direction_obj)).lower()
    return "up" if text in {"up", "1", "g", "long"} else "down"


def to_dt_str(value):
    if value is None:
        return ""
    try:
        if hasattr(value, "strftime"):
            return value.strftime('%Y-%m-%d %H:%M:%S')
        return pd.to_datetime(value).strftime('%Y-%m-%d %H:%M:%S')
    except Exception:
        return str(value)


def first_attr(obj, names, default=None):
    for name in names:
        if hasattr(obj, name):
            val = getattr(obj, name)
            if val is not None:
                return val
    return default


def first_float(obj, names, default=None):
    value = first_attr(obj, names, None)
    if value is None:
        return default
    try:
        return float(value)
    except Exception:
        return default


def get_dt_from_bar(bar):
    return first_attr(bar, ["dt", "datetime", "time"], None)


def extract_bi_bounds(bi):
    start_dt = first_attr(bi, ["start_dt", "sdt", "s_dt"], None)
    end_dt = first_attr(bi, ["end_dt", "edt", "e_dt"], None)
    if start_dt is None:
        start_dt = first_attr(first_attr(bi, ["fx_a", "start_fx"], None), ["dt"], None)
    if end_dt is None:
        end_dt = first_attr(first_attr(bi, ["fx_b", "end_fx"], None), ["dt"], None)
    if start_dt is None or end_dt is None:
        bars = first_attr(bi, ["bars"], [])
        if bars:
            if start_dt is None:
                start_dt = get_dt_from_bar(bars[0])
            if end_dt is None:
                end_dt = get_dt_from_bar(bars[-1])
    return start_dt, end_dt

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

        # Find columns (case-insensitive)
        cols = list(df.columns)
        col_map = {str(c).strip().lower(): c for c in cols}
        date_col = None
        for k in ["date", "datetime", "dt", "timestamp", "unnamed: 0"]:
            if k in col_map:
                date_col = col_map[k]
                break
        if date_col is None:
            for c in cols:
                lc = str(c).strip().lower()
                if "date" in lc or lc.endswith("dt"):
                    date_col = c
                    break
        if date_col is None:
            print(f"  Skip {filename}: date column not found. columns={cols[:8]}")
            return

        open_col = col_map.get("open")
        high_col = col_map.get("high")
        low_col = col_map.get("low")
        close_col = col_map.get("close")
        volume_col = col_map.get("volume")
        if not all([open_col, high_col, low_col, close_col]):
            print(f"  Skip {filename}: OHLC columns missing. columns={cols[:8]}")
            return
        
        # Prepare bars for CZSC
        bars = []
        row_errors = 0
        for ridx, row in df.iterrows():
            try:
                dt_str = str(row[date_col])
                # Convert to datetime object if possible, then back to ISO or timestamp
                dt = pd.to_datetime(dt_str)

                bar = make_raw_bar(
                    symbol=symbol,
                    interval=interval,
                    idx=ridx,
                    dt=dt,
                    o=float(row[open_col]),
                    c=float(row[close_col]),
                    h=float(row[high_col]),
                    l=float(row[low_col]),
                    v=float(row[volume_col]) if volume_col else 0.0
                )
                bars.append(bar)
            except Exception as e:
                row_errors += 1
                if row_errors <= 3:
                    print(f"  Row parse error for {filename} at idx={ridx}: {e}")
                continue

        if not bars:
            if row_errors:
                print(f"  Skip {filename}: all rows failed to convert to RawBar ({row_errors} errors).")
            return
        bars = sorted(bars, key=lambda x: x.dt)

        # Perform Analysis
        ci = CzscIter(bars)
        
        # Extract Fractals (åˆ†åž‹)
        fx_list = []
        for fx in ci.fx_list:
            fx_list.append({
                "dt": fx.dt.strftime('%Y-%m-%d %H:%M:%S'),
                "mark": str(fx.mark), # d/g (bottom/top)
                "high": fx.high,
                "low": fx.low
            })

        # Extract Segments (ç¬”)
        bi_list = []
        for bi in ci.bi_list:
            start_dt, end_dt = extract_bi_bounds(bi)
            if start_dt is None or end_dt is None:
                continue
            direction = normalize_direction(getattr(bi, "direction", ""))
            is_up = direction == "up"
            high_v = first_float(bi, ["high", "gg"], None)
            low_v = first_float(bi, ["low", "dd"], None)
            if high_v is None or low_v is None:
                bi_bars = first_attr(bi, ["bars"], [])
                if bi_bars:
                    highs = [first_float(x, ["high"], None) for x in bi_bars]
                    lows = [first_float(x, ["low"], None) for x in bi_bars]
                    highs = [x for x in highs if x is not None]
                    lows = [x for x in lows if x is not None]
                    if highs and lows:
                        high_v = max(highs)
                        low_v = min(lows)
            if high_v is None or low_v is None:
                continue
            bi_list.append({
                "start_dt": to_dt_str(start_dt),
                "end_dt": to_dt_str(end_dt),
                "direction": direction,
                "start_v": low_v if is_up else high_v,
                "end_v": high_v if is_up else low_v,
                "high": high_v,
                "low": low_v
            })

        # æå–çº¿æ®µ (Duan)
        xd_list = []
        try:
            source_xd = getattr(ci, 'xd_list', [])
            for xd in source_xd:
                xd_start = first_attr(xd, ["start_dt", "sdt", "s_dt"], None)
                xd_end = first_attr(xd, ["end_dt", "edt", "e_dt"], None)
                if xd_start is None:
                    xd_start = first_attr(first_attr(xd, ["fx_a", "start_fx"], None), ["dt"], None)
                if xd_end is None:
                    xd_end = first_attr(first_attr(xd, ["fx_b", "end_fx"], None), ["dt"], None)
                xd_high = first_float(xd, ["high", "gg"], None)
                xd_low = first_float(xd, ["low", "dd"], None)
                if xd_start is None or xd_end is None or xd_high is None or xd_low is None:
                    continue
                xd_list.append({
                    "start_dt": to_dt_str(xd_start),
                    "end_dt": to_dt_str(xd_end),
                    "direction": normalize_direction(getattr(xd, "direction", "")),
                    "high": xd_high,
                    "low": xd_low
                })
        except Exception:
            pass

        # æå–ä¸­æž¢ (ZhongShu)
        zs_list = []
        try:
            # æå–ç¬”ä¸­æž¢
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
        
        # æå–ä¹°å–ç‚¹æ ‡è®° (Markers) - ç§»é™¤æœªæ¥å‡½æ•°
        markers = []
        try:
            source_bars = getattr(ci, "bars", getattr(ci, "bars_raw", []))
            # åœ¨ç¼ è®ºä¸­ï¼Œç¬”çš„ç»“æŸç‚¹ï¼ˆæœ€é«˜/æœ€ä½Žç‚¹ï¼‰åªæœ‰åœ¨åŽç»­èµ°åŠ¿æ»¡è¶³åˆ†åž‹+é•¿åº¦è§„åˆ™åŽæ‰èƒ½è¢«ç¡®è®¤ã€‚
            # ä¸ºäº†é¿å…â€œæœªæ¥å‡½æ•°â€ï¼Œæˆ‘ä»¬å°†æ ‡è®°æ”¾åœ¨â€œç¡®è®¤ç‚¹ï¼ˆConfirmation Timeï¼‰â€è€Œéžâ€œæžå€¼ç‚¹ï¼ˆPeak/Trough Timeï¼‰â€ã€‚
            # è¿™é‡Œç®€å•èµ·è§ï¼Œæˆ‘ä»¬å°†æ ‡è®°åœ¨ç¬”ç»“æŸåŽçš„ç¬¬ 5 æ ¹ K çº¿ï¼ˆç¼ è®ºæ ‡å‡†ç¬”çš„åŸºæœ¬ç¡®è®¤å‘¨æœŸï¼‰æ˜¾ç¤ºã€‚
            for i, bi in enumerate(ci.bi_list):
                _, bi_end_dt = extract_bi_bounds(bi)
                if bi_end_dt is None:
                    continue
                # èŽ·å–è¯¥ç¬”ç»“æŸåŽçš„æ•°æ®æµï¼Œå¯»æ‰¾ç¡®è®¤å‘ç”Ÿçš„æ—¶æœº
                # å®žé™… CZSC ä¼šæœ‰ç‰¹å®šçš„ä¿¡å·å­—å…¸ï¼Œè¿™é‡Œæˆ‘ä»¬åšä¸€ä¸ªéžæœªæ¥çš„åç§»
                confirm_idx = -1
                for j, bar in enumerate(source_bars):
                    bar_dt = get_dt_from_bar(bar)
                    if bar_dt is None:
                        continue
                    if bar_dt > bi_end_dt:
                        # æ‰¾åˆ°ç¬¬ä¸€ä¸ªåŽç»­ Bar (å®žé™…ä¸Šéœ€è¦ 4-5 æ ¹ç¡®è®¤)
                        # ä¸ºäº†ä¸¥è°¨ï¼Œæˆ‘ä»¬å–ç¬”ç»“æŸæ—¶é—´ + 5æ ¹ Bar çš„æ—¶é—´ä½œä¸ºæ‰§è¡Œç‚¹
                        conf_idx = j + 4
                        if conf_idx < len(source_bars):
                            confirm_dt = get_dt_from_bar(source_bars[conf_idx])
                            if confirm_dt is None:
                                continue
                            is_buy = normalize_direction(getattr(bi, "direction", "")) == "down"
                            markers.append({
                                "time": to_dt_str(confirm_dt),
                                "peak_time": to_dt_str(bi_end_dt), # è®°å½•æžå€¼ç‚¹ä¾›å‚è€ƒ
                                "position": "belowBar" if is_buy else "aboveBar",
                                "color": "#00FFD1" if is_buy else "#FF5E5E",
                                "shape": "arrowUp" if is_buy else "arrowDown",
                                "text": "B *" if is_buy else "S *",
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
            "last_update": bars[-1].dt.strftime('%Y-%m-%d %H:%M:%S'),
            "generated_at": datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
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
    # Find all CSV files in DATA_DIR
    csv_files = glob.glob(os.path.join(DATA_DIR, "*.csv"))
    
    if not csv_files:
        print("No data files found in data/ directory.")
        return
        
    print(f"Found {len(csv_files)} data files to analyze in {DATA_DIR}.")
    
    # Filter out files that might have been created by accident or are not target timeframe data
    target_intervals = {"1m", "1d", "1wk", "1mo"}
    valid_files = []
    for f in csv_files:
        name = os.path.basename(f).replace(".csv", "")
        parts = name.split("_")
        if len(parts) < 2:
            continue
        if parts[1] in target_intervals:
            valid_files.append(f)
    
    for f in valid_files:
        analyze_ticker(f)

if __name__ == "__main__":
    main()

