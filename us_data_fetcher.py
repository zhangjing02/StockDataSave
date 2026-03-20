import os
import json
import pandas as pd
import yfinance as yf
import requests
from datetime import datetime, timedelta

DATA_DIR = "data"
WATCHLIST_FILE = "watch_list.json"
TIINGO_API_KEY = os.environ.get("TIINGO_API_KEY")

def load_watchlist():
    if not os.path.exists(WATCHLIST_FILE):
        return [], []
    with open(WATCHLIST_FILE, 'r', encoding='utf-8') as f:
        data = json.load(f)
    equity_symbols = list(set(data.get('stocks', []) + data.get('etfs', [])))
    crypto_symbols = list(set(data.get('crypto', [])))
    return equity_symbols, crypto_symbols

def ensure_dir_exists(symbol):
    path = os.path.join(DATA_DIR, symbol)
    os.makedirs(path, exist_ok=True)
    return path

def fetch_yfinance_5m(symbol):
    print(f"[{symbol}] Fetching via yfinance (5m) as fallback...")
    try:
        ticker = yf.Ticker(symbol)
        df = ticker.history(period="60d", interval="5m")
        if df is None or df.empty:
            return pd.DataFrame()
    except Exception as e:
        print(f"[{symbol}] yfinance error: {e}")
        return pd.DataFrame()
    
    df = df.reset_index()
    # Format to CZSC standards: symbol, dt, open, close, high, low, vol, amount
    if 'Datetime' in df.columns:
        df['dt'] = pd.to_datetime(df['Datetime']).dt.strftime('%Y-%m-%d %H:%M:%S')
    elif 'Date' in df.columns:
        df['dt'] = pd.to_datetime(df['Date']).dt.strftime('%Y-%m-%d %H:%M:%S')
        
    df['symbol'] = symbol
    df['open'] = df['Open']
    df['close'] = df['Close']
    df['high'] = df['High']
    df['low'] = df['Low']
    df['vol'] = df['Volume']
    df['amount'] = 0.0 # yfinance doesn't easily provide amount
    
    return df[['symbol', 'dt', 'open', 'close', 'high', 'low', 'vol', 'amount']]

def fetch_tiingo_intraday(symbol):
    if not TIINGO_API_KEY:
        print(f"[{symbol}] No Tiingo API Key found, skipping Tiingo.")
        return pd.DataFrame()
        
    print(f"[{symbol}] Fetching via Tiingo (5m)...")
    headers = {
        'Content-Type': 'application/json',
        'Authorization': f'Token {TIINGO_API_KEY}'
    }
    
    # Fetch last 30 days of intraday data (Tiingo max is limited mostly to recently without premium, but let's try 30d)
    start_date = (datetime.now() - timedelta(days=30)).strftime('%Y-%m-%d')
    url = f"https://api.tiingo.com/iex/{symbol}/prices?startDate={start_date}&resampleFreq=5min&columns=date,open,high,low,close,volume"
    
    response = requests.get(url, headers=headers)
    if response.status_code == 200:
        data = response.json()
        if not data:
            return pd.DataFrame()
        df = pd.DataFrame(data)
        df['symbol'] = symbol
        df['dt'] = pd.to_datetime(df['date']).dt.strftime('%Y-%m-%d %H:%M:%S')
        # Tiingo output columns are already lowercase: open, high, low, close, volume
        df['vol'] = df['volume']
        df['amount'] = 0.0
        return df[['symbol', 'dt', 'open', 'close', 'high', 'low', 'vol', 'amount']]
    else:
        print(f"[{symbol}] Tiingo error: {response.text}")
        return pd.DataFrame()

def process_symbol(symbol):
    sym_dir = ensure_dir_exists(symbol)
    
    # Try Tiingo first, fallback to YFinance
    df = fetch_tiingo_intraday(symbol)
    if df.empty:
         df = fetch_yfinance_5m(symbol)
         
    if df.empty:
        print(f"[{symbol}] No data retrieved.")
        return
    
    # Split by month for sharding
    df['month'] = df['dt'].str[:7] # YYYY-MM
    months = df['month'].unique()
    
    for m in months:
        m_df = df[df['month'] == m].copy()
        m_df = m_df.drop(columns=['month'])
        
        file_path = os.path.join(sym_dir, f"{m}_5m.csv")
        
        # Merge if file exists
        if os.path.exists(file_path):
            old_df = pd.read_csv(file_path)
            merged = pd.concat([old_df, m_df]).drop_duplicates(subset=['dt'], keep='last')
            merged = merged.sort_values('dt')
            merged.to_csv(file_path, index=False)
        else:
            m_df.to_csv(file_path, index=False)
            
    print(f"[{symbol}] Successfully saved/updated data spanning {len(months)} months.")

def main():
    equity_symbols, crypto_symbols = load_watchlist()
    all_symbols = equity_symbols + crypto_symbols
    print(f"Loaded {len(equity_symbols)} equity, {len(crypto_symbols)} crypto symbols.")
    
    for sym in all_symbols:
        process_symbol(sym)

if __name__ == "__main__":
    main()
