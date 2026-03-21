import yfinance as yf
import pandas as pd
import os
import json
import time
from datetime import datetime, timedelta
import requests

# Configuration
WATCHLIST_PATH = "watch_list.json"
DATA_DIR = "data"
os.makedirs(DATA_DIR, exist_ok=True)

# Timeframes to fetch
# format: (interval, period)
TIMEFRAMES = [
    ("1m", "7d"),    # 分时 / 5日 (Intraday)
    ("1d", "5y"),    # 日K (Daily)
    ("1wk", "max"),  # 周K (Weekly)
    ("1mo", "max"),  # 月K (Monthly)
    ("3mo", "max"),  # 季K (Quarterly)
    ("1y", "max")    # 年K (Yearly - will be resampled from 1mo)
]

TIINGO_API_KEY = os.environ.get("TIINGO_API_KEY")

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

def fetch_via_tiingo(ticker, interval, period):
    """Fallback / Complementary fetcher via Tiingo API"""
    if not TIINGO_API_KEY:
        return None
    
    print(f"  Attempting Tiingo for {ticker} ({interval})...")
    try:
        # Tiingo resampleFreq: 1min, 5min, daily, etc.
        freq_map = {"1m": "1min", "5m": "5min", "1d": "daily"}
        if interval not in freq_map:
            return None
        
        # Crypto symbols in Tiingo: btcusd instead of BTC-USD
        is_crypto = "-" in ticker
        tiingo_ticker = ticker.replace("-", "").lower() if is_crypto else ticker.lower()
        
        endpoint = "crypto" if is_crypto else "iex"
        url = f"https://api.tiingo.com/tiingo/{endpoint}/{tiingo_ticker}/prices"
        
        # Calculate startDate based on period
        days = 2 if period == "5d" else 60 if period == "60d" else 730
        start_date = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")
        
        params = {
            "token": TIINGO_API_KEY,
            "startDate": start_date,
            "resampleFreq": freq_map[interval],
            "format": "json"
        }
        
        response = requests.get(url, params=params)
        if response.status_code != 200:
            print(f"    Tiingo API Error: {response.status_code}")
            return None
            
        data = response.json()
        if not data:
            return None
            
        # Convert to DataFrame
        df = pd.DataFrame(data)
        # Tiingo fields: date, open, high, low, close, volume...
        df['date'] = pd.to_datetime(df['date'])
        df.set_index('date', inplace=True)
        # Rename columns to match yfinance
        col_map = {c: c.capitalize() for c in df.columns}
        df.rename(columns=col_map, inplace=True)
        
        return df
    except Exception as e:
        print(f"    Tiingo error: {e}")
        return None

def fetch_data(ticker, interval, period):
    print(f"Fetching {ticker} ({interval})...")
    filename = os.path.join(DATA_DIR, f"{ticker}_{interval}.csv")
    
    try:
        # Avoid rate limits for yfinance
        time.sleep(0.3)
        
        target_interval = interval
        if interval in ["3mo", "1y"]:
            target_interval = "1mo"
            
        # 1. Primary: yfinance
        df = yf.download(ticker, period=period, interval=target_interval, progress=False)
        
        if df.empty or len(df) < 5:
            # 2. Secondary: Tiingo
            t_df = fetch_via_tiingo(ticker, target_interval, period)
            if t_df is not None and not t_df.empty:
                df = t_df
                print("    Used Tiingo data source.")
            else:
                if df.empty:
                    print(f"  Empty data for {ticker}")
                    return False
            
        # Standardize columns
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.get_level_values(0)
            
        # Clean data
        df = df.dropna(subset=['Open', 'High', 'Low', 'Close'])

        # Resample for 3mo and 1y if fetched as 1mo
        if interval == "3mo":
            df = df.resample('3ME').agg({
                'Open': 'first', 'High': 'max', 'Low': 'min', 'Close': 'last', 'Volume': 'sum'
            }).dropna()
        elif interval == "1y":
            df = df.resample('Y').agg({
                'Open': 'first', 'High': 'max', 'Low': 'min', 'Close': 'last', 'Volume': 'sum'
            }).dropna()
        
        # Save path: data/{ticker}_{interval}.csv
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
