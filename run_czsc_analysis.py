import os
import glob
import pandas as pd
from datetime import datetime

try:
    from czsc import CZSC, RawBar, Freq
except ImportError:
    print("ERROR: Please install czsc (pip install czsc)")
    exit(1)

def load_data(symbol):
    files = glob.glob(f"data/{symbol}/*_5m.csv")
    if not files:
        return None
    
    dfs = [pd.read_csv(f) for f in files]
    df = pd.concat(dfs).drop_duplicates(subset=['dt']).sort_values('dt')
    return df

def run_analysis(symbol):
    df = load_data(symbol)
    if df is None or df.empty:
        print(f"No data for {symbol}")
        return

    bars = []
    for _, row in df.iterrows():
        b = RawBar(
            symbol=row['symbol'],
            dt=pd.to_datetime(row['dt']),
            freq=Freq.F5,
            open=row['open'],
            close=row['close'],
            high=row['high'],
            low=row['low'],
            vol=row['vol'],
            amount=row['amount']
        )
        bars.append(b)

    c = CZSC(bars)
    
    print(f"\n========== {symbol} 5m CZSC Analysis ==========")
    print(f"Data points: {len(c.bars_raw)}")
    print(f"Detected Bi (笔) count: {len(c.bi_list)}")
    
    if c.bi_list:
        last_bi = c.bi_list[-1]
        print(f"Latest Bi Direction: {last_bi.direction}")
        print(f"Latest Bi bounds: High {last_bi.high} | Low {last_bi.low}")
    
    print("================================================\n")

if __name__ == "__main__":
    for sym in ["AAPL", "TSLA", "QQQ"]:
        run_analysis(sym)
