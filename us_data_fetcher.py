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
MARKET_INFO_PATH = os.path.join(DATA_DIR, "market_info.json")
os.makedirs(DATA_DIR, exist_ok=True)

# Timeframes to fetch
# format: (interval, period)
TIMEFRAMES = [
    ("1m", "7d"),    # 分时 / 7日 (Tiingo IEX 1min)
    ("1d", "5y"),    # 日K (Daily)
    ("1wk", "max"),  # 周K (Weekly)
    ("1mo", "max")   # 月K (Monthly)
]

# Parse multiple Tiingo API keys from environment variable (comma separated)
env_keys = os.getenv("TIINGO_API_KEY", "")
if env_keys:
    TIINGO_API_KEYS = [k.strip() for k in env_keys.split(",") if k.strip()]
else:
    # Fallback to hardcoded keys
    TIINGO_API_KEYS = [
        "b9c4877fd73b86f21957995f7411f482ce962b33",
        "e54c2593c7cc8b885c72d7b54411447e5f6b72ea",
        "3c0cf0de5c4187736d9c4262201ebd5415a8ce3f"
    ]

class TiingoClient:
    def __init__(self, api_keys):
        self.api_keys = api_keys
        self.current_key_idx = 0
        self.key_status = {key: {"requests": 0, "last_429": None} for key in api_keys}

    def get_current_key(self):
        if not self.api_keys:
            return None
        return self.api_keys[self.current_key_idx]

    def switch_to_next_key(self):
        if len(self.api_keys) <= 1:
            return False
        old_key = self.get_current_key()
        self.current_key_idx = (self.current_key_idx + 1) % len(self.api_keys)
        new_key = self.get_current_key()
        print(f"      [Tiingo] Rate limit hit for key ...{old_key[-8:]}. Switching to key ...{new_key[-8:]}")
        return True

    def request(self, url, params, max_retries=3):
        retries = 0
        wait_time = 60 # Default wait time for 429

        while retries < max_retries:
            key = self.get_current_key()
            if not key:
                return None
            
            params["token"] = key
            try:
                response = requests.get(url, params=params, timeout=15)
                self.key_status[key]["requests"] += 1
                
                if response.status_code == 200:
                    return response.json()
                
                if response.status_code == 429:
                    print(f"      [Tiingo] 429 Too Many Requests for key ...{key[-8:]}")
                    if self.switch_to_next_key():
                        # If we have more keys, try the next one immediately
                        continue
                    else:
                        # Only one key or all keys tried, need to wait
                        print(f"      [Tiingo] All keys limited. Sleeping for {wait_time}s...")
                        time.sleep(wait_time)
                        wait_time *= 2 # Exponential backoff
                        retries += 1
                        continue
                
                print(f"      [Tiingo] API Error: {response.status_code} - {response.text}")
                return None
            except Exception as e:
                print(f"      [Tiingo] Connection Error: {e}")
                retries += 1
                time.sleep(5)
        
        return None

# Initialize Tiingo Client
tiingo_client = TiingoClient(TIINGO_API_KEYS)

def load_watchlist():
    try:
        if not os.path.exists(WATCHLIST_PATH):
            return ["SPY", "QQQ", "AAPL", "MSFT", "NVDA", "TSLA"]
        with open(WATCHLIST_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
            tickers = []
            if isinstance(data, list):
                for category in data:
                    for item in category.get('items', []):
                        tickers.append(item['symbol'])
            elif isinstance(data, dict):
                tickers = data.get('stocks', []) + data.get('etfs', []) + data.get('crypto', [])
            
            # Preserve order while removing duplicates
            seen = set()
            return [x for x in tickers if not (x in seen or seen.add(x))]
    except Exception as e:
        print(f"Error loading watchlist: {e}")
        return ["SPY", "QQQ", "AAPL", "MSFT", "NVDA", "TSLA"]

def fetch_via_tiingo(ticker, interval, period):
    """Fallback / Complementary fetcher via Tiingo API with Key Rotation"""
    if not TIINGO_API_KEYS:
        return None
    
    print(f"  Attempting Tiingo for {ticker} ({interval})...")
    try:
        freq_map = {"1m": "1min", "5m": "5min", "1d": "1day", "1wk": "1week", "1mo": "1month"}
        if interval not in freq_map:
            return None
        
        is_crypto = "-" in ticker
        tiingo_ticker = ticker.replace("-", "").lower() if is_crypto else ticker.upper()
        
        if is_crypto:
            endpoint = "crypto/prices"
        elif interval == "1m":
            endpoint = "iex"
        else:
            endpoint = "daily"

        url = f"https://api.tiingo.com/tiingo/{endpoint}"
        if not is_crypto:
            url = f"{url}/{tiingo_ticker}/prices"
        
        days = 7 if interval == "1m" else 730
        start_date = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")
        
        params = {
            "startDate": start_date,
            "format": "json"
        }
        if endpoint != "daily":
            params["resampleFreq"] = freq_map.get(interval, "1min" if endpoint == "iex" else "1day")
        
        if is_crypto:
            params["tickers"] = tiingo_ticker
        
        data = tiingo_client.request(url, params)
        if not data:
            return None
        
        if is_crypto and isinstance(data, list) and len(data) > 0:
            data = data[0].get('priceData', [])
            
        df = pd.DataFrame(data)
        if df.empty: return None
        
        df['date'] = pd.to_datetime(df['date'])
        df.set_index('date', inplace=True)
        # Using a safer column capitalization that doesn't mess with PascalCase from mapping later
        df.columns = [str(c).lower() for c in df.columns]
        
        return df
    except Exception as e:
        print(f"    Tiingo error: {e}")
        return None

def standardize_df(df, ticker):
    """Normalize columns and handle MultiIndex if present"""
    if df is None or df.empty:
        return df
        
    # Handle yfinance 0.2.x MultiIndex (e.g. ('Close', 'AAPL'))
    if isinstance(df.columns, pd.MultiIndex):
        # We expect (Metric, Ticker) - drop the Ticker level
        if ticker in df.columns.get_level_values(1):
            df = df.xs(ticker, level=1, axis=1)
        else:
            # Fallback: flatten to the metric names
            df.columns = df.columns.get_level_values(0)
            
    # Standardize column casing and names
    mapping = {
        'adjclose': 'AdjClose',
        'adjhigh': 'AdjHigh',
        'adjlow': 'AdjClose', # Oops, common typo check
        'adjlow': 'AdjLow',
        'adjopen': 'AdjOpen',
        'adjvolume': 'AdjVolume',
        'adj close': 'AdjClose',
        'adj high': 'AdjHigh',
        'adj low': 'AdjLow',
        'adj open': 'AdjOpen',
        'adj volume': 'AdjVolume'
    }
    # First convert all to lowercase for case-insensitive matching
    orig_cols = {c.lower(): c for c in df.columns}
    rename_cols = {}
    for lower_name, target in mapping.items():
        if lower_name in orig_cols:
            rename_cols[orig_cols[lower_name]] = target
            
    # Also capitalize standard OHLCV
    for lower_name in ['open', 'high', 'low', 'close', 'volume']:
        if lower_name in orig_cols:
            rename_cols[orig_cols[lower_name]] = lower_name.capitalize()

    df = df.rename(columns=rename_cols)
    
    # Clean up (no duplicates, sorted index, no NaNs in OHLC)
    if 'Open' in df.columns:
        df = df.dropna(subset=['Open', 'High', 'Low', 'Close'], how='any')
    
    df = df[~df.index.duplicated(keep='last')]
    df = df.sort_index()
    
    return df

def validate_data(df, ticker, interval):
    """Basic sanity check for fetched data"""
    if df is None or df.empty:
        print(f"    [Validation] Empty data for {ticker}")
        return False
        
    # Check if we have too many columns (sign of MultiIndex failure)
    if len(df.columns) > 15:
        print(f"    [Validation] Too many columns ({len(df.columns)}) for {ticker}")
        return False
        
    # Check for zeros in OHLC (major tickers shouldn't be zero)
    if all(c in df.columns for c in ['Open', 'Close']):
        zero_rows = (df[['Open', 'Close']] == 0).any(axis=1).sum()
        if zero_rows > len(df) * 0.2: # More than 20% zeros is suspicious
            print(f"    [Validation] High zero-count ({zero_rows}/{len(df)}) for {ticker}")
            # We don't fail here yet because some small stocks might have it, but it's logged
            
    return True

def fetch_data(ticker, interval, period, force=False):
    print(f"Fetching {ticker} ({interval})...")
    filename = os.path.join(DATA_DIR, f"{ticker}_{interval}.csv")
    
    # Check if we need to fetch
    if not force and os.path.exists(filename):
        mod_time = datetime.fromtimestamp(os.path.getmtime(filename))
        if datetime.now() - mod_time < timedelta(hours=4):
            print(f"  Skipping {ticker} ({interval}) - updated within 4 hours.")
            return True
            
    try:
        # Avoid rate limits
        time.sleep(0.5)
        
        target_interval = interval
        if interval in ["3mo", "1y"]:
            target_interval = "1mo"
            
        # 1. Fetching Logic
        if interval == "1m":
            df = fetch_via_tiingo(ticker, interval, period)
            if df is not None and not df.empty:
                print("    Used Tiingo for 1m data.")
            else:
                df = yf.download(ticker, period=period, interval=interval, progress=False, auto_adjust=False)
        else:
            # For Daily/Weekly/Monthly: try yfinance first
            df = None
            try:
                # Use auto_adjust=False to get consistent Close vs Adj Close
                df = yf.download(ticker, period=period, interval=target_interval, progress=False, auto_adjust=False)
                if df is None or df.empty or len(df) < 1:
                     print(f"    yfinance returned empty for {ticker} ({interval}).")
                     df = None # trigger fallback
            except Exception as e:
                print(f"    yfinance raised exception for {ticker}: {e}.")
                df = None
                
            if df is None:
                print(f"    Falling back to Tiingo for {ticker} ({interval})...")
                df = fetch_via_tiingo(ticker, target_interval, period)
        
        # 2. Standardize and Validate
        df = standardize_df(df, ticker)
        
        if not validate_data(df, ticker, interval):
            print(f"  Validation failed for {ticker}")
            return False
            
        # 3. Post-process for resampled intervals
        if interval == "3mo":
            df = df.resample('3ME').agg({
                'Open': 'first', 'High': 'max', 'Low': 'min', 'Close': 'last', 'Volume': 'sum'
            }).dropna()
        elif interval == "1y":
            df = df.resample('Y').agg({
                'Open': 'first', 'High': 'max', 'Low': 'min', 'Close': 'last', 'Volume': 'sum'
            }).dropna()
        
        # 4. Save
        df.to_csv(filename)
        print(f"  Successfully updated {len(df)} rows to {filename}")
        return True
    except Exception as e:
        print(f"  Error fetching {ticker}: {e}")
        return False

def fetch_market_info(tickers):
    """Fetch metadata like floatShares for each ticker"""
    print(f"\nFetching market info for {len(tickers)} tickers...")
    market_info = {}
    
    # Load existing to avoid redundant calls
    if os.path.exists(MARKET_INFO_PATH):
        try:
            with open(MARKET_INFO_PATH, "r", encoding="utf-8") as f:
                market_info = json.load(f)
        except: pass

    for ticker in tickers:
        # Crypto: use hardcoded fallback or attempt to skip yf.info which is expensive
        if "-" in ticker:
            market_info[ticker] = {"floatShares": None, "type": "crypto"}
            continue
            
        # Only fetch if missing or older than 7 days
        # (floatShares doesn't change daily)
        if ticker in market_info and "last_update" in market_info[ticker]:
            last_upd = datetime.strptime(market_info[ticker]["last_update"], "%Y-%m-%d")
            if (datetime.now() - last_upd).days < 7:
                print(f"  Skipping market info for {ticker} (Recent Enough)")
                continue

        try:
            print(f"  Fetching info for {ticker}...")
            t = yf.Ticker(ticker)
            info = t.info
            market_info[ticker] = {
                "floatShares": info.get("floatShares"),
                "totalShares": info.get("sharesOutstanding"),
                "shortName": info.get("shortName"),
                "type": "stock",
                "last_update": datetime.now().strftime("%Y-%m-%d")
            }
            time.sleep(0.5) # Anti-rate limit
        except Exception as e:
            print(f"  Error fetching info for {ticker}: {e}")
            if ticker not in market_info:
                market_info[ticker] = {"floatShares": None, "last_update": datetime.now().strftime("%Y-%m-%d")}

    with open(MARKET_INFO_PATH, "w", encoding="utf-8") as f:
        json.dump(market_info, f, indent=2)
    print(f"  Market info saved to {MARKET_INFO_PATH}")

def main():
    watchlist = load_watchlist()
    
    # 2. Command line arguments
    import sys
    args = sys.argv[1:]
    force_all = "--force" in args
    
    # Filter tickers if --tickers provided
    if "--tickers" in args:
        idx = args.index("--tickers")
        if idx + 1 < len(args):
            raw = args[idx+1].split(",")
            tickers = [t.strip().upper() for t in raw if t.strip()]
            print(f"Targeted Fetch: {tickers}")
        else:
            tickers = watchlist
    else:
        tickers = watchlist
        
    print(f"Total tickers to process: {len(tickers)}")
    
    # Track statistics
    stats = {"success": 0, "failed": 0}
    
    # 3. Fetch market info (Metadata)
    fetch_market_info(tickers)
    
    # 4. Fetch OCHLV data
    
    for ticker in tickers:
        for interval, period in TIMEFRAMES:
            success = fetch_data(ticker, interval, period, force=force_all)
            if success:
                stats["success"] += 1
            else:
                stats["failed"] += 1
                
    print(f"\nFetch complete!")
    print(f"Success: {stats['success']} | Failed: {stats['failed']}")

if __name__ == "__main__":
    main()
