import json
import os
import pandas as pd
import glob
from datetime import datetime

DATA_DIR = "data"
SIGNALS_DIR = os.path.join(DATA_DIR, "analysis")
os.makedirs(SIGNALS_DIR, exist_ok=True)

def generate_signals_for_all():
    # Find all CSV files in data/
    csv_files = glob.glob(os.path.join(DATA_DIR, "*.csv"))
    print(f"Found {len(csv_files)} files to process.")
    
    for csv_path in csv_files:
        filename = os.path.basename(csv_path)
        # Expecting format: SYMBOL_INTERVAL.csv, e.g., AAPL_1d.csv
        parts = filename.replace(".csv", "").split("_")
        if len(parts) < 2: continue
        
        symbol = parts[0]
        tf = parts[1]
        
        try:
            df = pd.read_csv(csv_path)
            if df.empty: continue
            
            # Ensure Date column is clean
            date_col = df.columns[0] # Usually 'Date'
            
            markers = []
            bi = []
            
            # Simple Structural Mock (to replace missing CZSC analysis locally)
            # Use fixed step to simulate 'Bi' (Stroke)
            step = 12 if tf in ['1d', '1wk'] else 6
            
            for i in range(0, len(df) - step, step):
                start_row = df.iloc[i]
                end_row = df.iloc[i+step]
                
                # Bi Logic
                direction = 1 if (i // step) % 2 == 0 else -1
                
                # Use standard YYYY-MM-DD for consistency
                dt_start = str(start_row[date_col]).split(" ")[0]
                dt_end = str(end_row[date_col]).split(" ")[0]
                
                bi.append({
                    "start_dt": dt_start,
                    "end_dt": dt_end,
                    "direction": direction,
                    "high": float(max(start_row['High'], end_row['High'])),
                    "low": float(min(start_row['Low'], end_row['Low']))
                })
                
                # Signal Confirmation (Non-Future: confirmed after 5 bars)
                conf_idx = min(i + step + 5, len(df) - 1)
                conf_row = df.iloc[conf_idx]
                dt_conf = str(conf_row[date_col]).split(" ")[0]
                
                is_buy = direction == -1
                markers.append({
                    "time": dt_conf,
                    "peak_time": dt_end,
                    "position": "belowBar" if is_buy else "aboveBar",
                    "color": "#00FFD1" if is_buy else "#FF5E5E",
                    "shape": "arrowUp" if is_buy else "arrowDown",
                    "text": ("B" if is_buy else "S") + " (Conf)",
                    "type": "Buy1" if is_buy else "Sell1",
                    "size": 2
                })

            result = {
                "symbol": symbol,
                "interval": tf,
                "last_update": datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                "bi": bi,
                "markers": markers
            }
            
            output_file = os.path.join(SIGNALS_DIR, f"{symbol}_{tf}_signals.json")
            with open(output_file, "w") as f:
                json.dump(result, f, indent=2)
            print(f"  Processed {filename} -> {len(markers)} markers")
            
        except Exception as e:
            print(f"  Error processing {filename}: {e}")

if __name__ == "__main__":
    generate_signals_for_all()
