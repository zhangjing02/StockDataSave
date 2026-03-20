import pandas as pd
import os
import json
import glob
from czsc.analyze import CzscIter
from czsc.objects import RawBar

# Configuration
DATA_DIR = "data"
SIGNALS_DIR = "signals"
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
                "direction": str(bi.direction), # d/g
                "high": bi.high,
                "low": bi.low
            })

        # Save Results
        num_fx = len(fx_list)
        num_bi = len(bi_list)
        
        result = {
            "symbol": symbol,
            "interval": interval,
            "last_update": datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            "fractals": fx_list[max(0, num_fx - 150):], 
            "bi": bi_list[max(0, num_bi - 80):]
        }

        output_file = os.path.join(SIGNALS_DIR, f"{symbol}_{interval}_signals.json")
        with open(output_file, "w", encoding="utf-8") as f:
            json.dump(result, f, indent=2)
            
    except Exception as e:
        print(f"  Error analyzing {filename}: {e}")

from datetime import datetime

def main():
    csv_files = glob.glob(os.path.join(DATA_DIR, "*.csv"))
    print(f"Found {len(csv_files)} data files to analyze.")
    
    for f in csv_files:
        analyze_ticker(f)

if __name__ == "__main__":
    main()
