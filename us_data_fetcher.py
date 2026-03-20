import yfinance as yf
import pandas as pd
import os
import json
import time
from datetime import datetime, timedelta

# Configuration
WATCHLIST_PATH = "watch_list.json"
DATA_DIR = "data"
os.makedirs(DATA_DIR, exist_ok=True)

# Timeframes to fetch
# format: (interval, period)
TIMEFRAMES = [
    ("5m", "60d"),   # 5 min (max 60d for yfinance)
    ("1d", "2y"),    # Daily (2 years as requested)
    ("1wk", "2y"),   # Weekly
    ("1mo", "2y"),   # Monthly
    ("3mo", "5y")    # Quarterly
]

def load_watchlist():
    try:
        if not os.path.exists(WATCHLIST_PATH):
            return ["SPY", "QQQ", "AAPL", "MSFT", "NVDA", "TSLA"]
        with open(WATCHLIST_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
            tickers = []
            # Support both new and old watchlist formats
            if isinstance(data, list):
                for category in data:
                    for item in category.get('items', []):
                        tickers.append(item['symbol'])
            elif isinstance(data, dict):
                tickers = data.get('stocks', []) + data.get('etfs', []) + data.get('crypto', [])
            return list(set(tickers))
    except Exception as e:
        print(f"Error loading watchlist: {e}")
        return ["SPY", "QQQ", "AAPL", "MSFT", "NVDA", "TSLA"]

def fetch_data(ticker, interval, period):
    print(f"Fetching {ticker} ({interval})...")
    try:
        # Avoid rate limits
        time.sleep(0.5)
        
        # Download data
        df = yf.download(ticker, period=period, interval=interval, progress=False)
        
        if df.empty:
            print(f"  Empty data for {ticker}")
            return False
            
        # Standardize columns (yfinance sometimes returns MultiIndex)
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.get_level_values(0)
            
        # Clean data: drop rows with NaN in core columns
        df = df.dropna(subset=['Open', 'High', 'Low', 'Close'])
        
        # Save path: data/{ticker}_{interval}.csv
        filename = os.path.join(DATA_DIR, f"{ticker}_{interval}.csv")
        df.to_csv(filename)
        print(f"  Saved {len(df)} rows to {filename}")
        return True
    except Exception as e:
        print(f"  Error fetching {ticker}: {e}")
        return False

def main():
    tickers = load_watchlist()
    print(f"Total tickers to process: {len(tickers)}")
    
    # Track statistics
    stats = {"success": 0, "failed": 0}
    
    for ticker in tickers:
        for interval, period in TIMEFRAMES:
            success = fetch_data(ticker, interval, period)
            if success:
                stats["success"] += 1
            else:
                stats["failed"] += 1
                
    print(f"\nFetch complete!")
    print(f"Success: {stats['success']} | Failed: {stats['failed']}")

if __name__ == "__main__":
    main()
