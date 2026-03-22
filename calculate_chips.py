import pandas as pd
import numpy as np
import os
import json
import glob

DATA_DIR = "data"
CHIPS_DIR = os.path.join(DATA_DIR, "chips")
os.makedirs(CHIPS_DIR, exist_ok=True)

def calculate_volume_profile(ticker, interval="1m", bins=100):
    """
    计算给定标的的成交量分布 (筹码分布)
    """
    csv_path = os.path.join(DATA_DIR, f"{ticker}_{interval}.csv")
    if not os.path.exists(csv_path):
        # Fallback to daily if 1m is not available, but precision will be lower
        csv_path = os.path.join(DATA_DIR, f"{ticker}_1d.csv")
        if not os.path.exists(csv_path):
            print(f"No data for {ticker}")
            return None

    print(f"Calculating Chips for {ticker} using {csv_path}...")
    try:
        df = pd.read_csv(csv_path)
        if df.empty: return None
        
        # Ensure column names are correct
        # yfinance/Tiingo might have different casings
        df.columns = [c.capitalize() for c in df.columns]
        
        # We use High/Low/Close avg or just Close for volume assignment
        # For better accuracy with EOD data, one could distribute volume across H-L range
        # But for 1m data, using the median or close is sufficient
        prices = df['Close'].values
        volumes = df['Volume'].values
        
        min_p, max_p = np.min(prices), np.max(prices)
        if min_p == max_p: return None
        
        # Define Bins
        bin_edges = np.linspace(min_p, max_p, bins + 1)
        
        # Digitizing prices into bins
        bin_indices = np.digitize(prices, bin_edges) - 1
        # Correct indices out of bounds (should only happen for exact max price)
        bin_indices[bin_indices == bins] = bins - 1
        
        # Accumulate volume per bin
        profile = np.zeros(bins)
        for i in range(len(prices)):
            profile[bin_indices[i]] += volumes[i]
            
        total_volume = np.sum(profile)
        if total_volume == 0: return None
        
        # Prepare result
        result_bins = []
        for i in range(bins):
            if profile[i] > 0:
                result_bins.append({
                    "price": float((bin_edges[i] + bin_edges[i+1]) / 2),
                    "vol": float(profile[i]),
                    "pct": float(profile[i] / total_volume)
                })
        
        # Find Valued Area High/Low and POC (Point of Control)
        poc_idx = np.argmax(profile)
        poc_price = (bin_edges[poc_idx] + bin_edges[poc_idx+1]) / 2
        
        return {
            "symbol": ticker,
            "bins": result_bins,
            "poc": float(poc_price),
            "range": [float(min_p), float(max_p)],
            "last_update": pd.Timestamp.now().strftime("%Y-%m-%d %H:%M:%S")
        }
        
    except Exception as e:
        print(f"Error calculating chips for {ticker}: {e}")
        return None

def main():
    # Find all CSV files that could be used
    files = glob.glob(os.path.join(DATA_DIR, "*_1m.csv"))
    if not files:
        files = glob.glob(os.path.join(DATA_DIR, "*_1d.csv"))
        
    tickers = list(set([os.path.basename(f).split("_")[0] for f in files]))
    print(f"Processing {len(tickers)} tickers for chips distribution...")
    
    for ticker in tickers:
        profile = calculate_volume_profile(ticker)
        if profile:
            output_path = os.path.join(CHIPS_DIR, f"{ticker}_chips.json")
            with open(output_path, "w", encoding="utf-8") as f:
                json.dump(profile, f, indent=2)
            print(f"  Saved chips to {output_path}")

if __name__ == "__main__":
    main()
