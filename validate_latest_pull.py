import argparse
import csv
import json
import os
import re
import sys
from datetime import date, datetime


TARGET_INTERVALS = ("1m", "1d", "1wk", "1mo")
MIN_ROWS_BY_INTERVAL = {
    "1m": 100,
    "1d": 50,
    "1wk": 20,
    "1mo": 12,
}
DEFAULT_MAX_LAG_BY_INTERVAL = {
    "1m": 3,
    "1d": 3,
    "1wk": 10,
    "1mo": 40,
}
REQUIRED_SIGNAL_KEYS = {
    "symbol",
    "interval",
    "last_update",
    "generated_at",
    "fractals",
    "bi",
    "segments",
    "zhongshu",
    "markers",
}
LEGACY_SIGNAL_KEYS = {
    "symbol",
    "interval",
    "last_update",
    "bi",
    "markers",
}


def _parse_args():
    parser = argparse.ArgumentParser(
        description="Validate latest generated data and analysis outputs."
    )
    parser.add_argument(
        "--base-dir",
        default=os.path.dirname(os.path.abspath(__file__)),
        help="Project root directory containing watch_list.json and data/",
    )
    parser.add_argument(
        "--max-lag-days",
        type=int,
        default=-1,
        help="Override max lag days for all intervals; -1 uses interval defaults.",
    )
    parser.add_argument(
        "--skip-news-check",
        action="store_true",
        help="Skip strict news markdown existence check.",
    )
    return parser.parse_args()


def _dedup_keep_order(items):
    seen = set()
    result = []
    for x in items:
        if x in seen:
            continue
        seen.add(x)
        result.append(x)
    return result


def _load_watchlist(watchlist_path):
    with open(watchlist_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    tickers = []
    if isinstance(data, dict):
        tickers.extend(data.get("stocks", []))
        tickers.extend(data.get("etfs", []))
        tickers.extend(data.get("crypto", []))
    elif isinstance(data, list):
        for category in data:
            if isinstance(category, dict):
                for item in category.get("items", []):
                    if isinstance(item, dict) and item.get("symbol"):
                        tickers.append(item["symbol"])
    else:
        raise ValueError("watch_list.json has unsupported structure.")

    tickers = [str(x).strip() for x in tickers if str(x).strip()]
    return _dedup_keep_order(tickers)


def _parse_date(raw_value):
    if raw_value is None:
        return None

    s = str(raw_value).strip()
    if not s:
        return None

    if s.endswith("Z"):
        s = s[:-1] + "+00:00"

    dt = None
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        pass

    if dt is None:
        formats = (
            "%Y-%m-%d",
            "%Y-%m-%d %H:%M:%S",
            "%Y-%m-%d %H:%M:%S.%f",
            "%Y/%m/%d",
            "%Y/%m/%d %H:%M:%S",
        )
        for fmt in formats:
            try:
                dt = datetime.strptime(s, fmt)
                break
            except ValueError:
                continue

    if dt is None:
        try:
            dt = datetime.utcfromtimestamp(float(s))
        except Exception:
            return None

    return dt.date()


def _read_csv_summary(csv_path):
    with open(csv_path, "r", encoding="utf-8-sig", errors="ignore", newline="") as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames or []
        if not fieldnames:
            return {"error": "CSV has no header row"}

        original_fields = list(fieldnames)
        normalized = {str(c).strip().lower(): c for c in original_fields}

        date_col = None
        for key in ("date", "datetime", "dt", "timestamp", "unnamed: 0", ""):
            if key in normalized:
                date_col = normalized[key]
                break
        if date_col is None:
            date_col = original_fields[0]

        required_ohlc = ("open", "high", "low", "close")
        missing_ohlc = [c for c in required_ohlc if c not in normalized]

        row_count = 0
        latest_dt = None
        for row in reader:
            row_count += 1
            d = _parse_date(row.get(date_col))
            if d and (latest_dt is None or d > latest_dt):
                latest_dt = d

        return {
            "fieldnames": original_fields,
            "missing_ohlc": missing_ohlc,
            "rows": row_count,
            "latest_date": latest_dt,
        }


def _read_signal_summary(signal_path):
    with open(signal_path, "r", encoding="utf-8") as f:
        payload = json.load(f)

    if not isinstance(payload, dict):
        return {"error": "Signal JSON root is not an object"}

    missing = [k for k in REQUIRED_SIGNAL_KEYS if k not in payload]
    is_legacy = False
    if missing:
        is_legacy = all(k in payload for k in LEGACY_SIGNAL_KEYS)
    return {
        "missing_keys": missing,
        "is_legacy": is_legacy,
        "symbol": payload.get("symbol"),
        "interval": payload.get("interval"),
        "last_update": _parse_date(payload.get("last_update")),
    }


def _get_lag_limit(interval, ticker, default_map):
    # Tiingo crypto 1m feed can lag behind stock intraday feed by a few days.
    if interval == "1m" and "-" in ticker:
        return max(default_map[interval], 7)
    return default_map[interval]


def _collect_generated_pairs(paths, pattern):
    pairs = set()
    for p in paths:
        name = os.path.basename(p)
        m = pattern.match(name)
        if not m:
            continue
        pairs.add((m.group("ticker"), m.group("interval")))
    return pairs


def main():
    args = _parse_args()

    base_dir = os.path.abspath(args.base_dir)
    watchlist_path = os.path.join(base_dir, "watch_list.json")
    data_dir = os.path.join(base_dir, "data")
    signals_dir = os.path.join(data_dir, "analysis")
    news_dir = os.path.join(data_dir, "news")
    market_info_path = os.path.join(data_dir, "market_info.json")

    errors = []
    warnings = []
    checks = []

    if not os.path.isfile(watchlist_path):
        print(f"[FAIL] watch_list.json not found: {watchlist_path}")
        return 1
    if not os.path.isdir(data_dir):
        print(f"[FAIL] data directory not found: {data_dir}")
        return 1

    tickers = _load_watchlist(watchlist_path)
    if not tickers:
        print("[FAIL] No tickers loaded from watch_list.json")
        return 1

    expected_pairs = {(ticker, interval) for ticker in tickers for interval in TARGET_INTERVALS}
    max_lag_by_interval = dict(DEFAULT_MAX_LAG_BY_INTERVAL)
    if args.max_lag_days >= 0:
        for k in max_lag_by_interval:
            max_lag_by_interval[k] = args.max_lag_days

    csv_paths = [
        os.path.join(data_dir, x)
        for x in os.listdir(data_dir)
        if x.lower().endswith(".csv") and os.path.isfile(os.path.join(data_dir, x))
    ]
    signal_paths = []
    if os.path.isdir(signals_dir):
        signal_paths = [
            os.path.join(signals_dir, x)
            for x in os.listdir(signals_dir)
            if x.lower().endswith("_signals.json")
            and os.path.isfile(os.path.join(signals_dir, x))
        ]

    csv_pattern = re.compile(r"^(?P<ticker>.+)_(?P<interval>1m|1d|1wk|1mo)\.csv$")
    signal_pattern = re.compile(r"^(?P<ticker>.+)_(?P<interval>1m|1d|1wk|1mo)_signals\.json$")

    csv_pairs = _collect_generated_pairs(csv_paths, csv_pattern)
    signal_pairs = _collect_generated_pairs(signal_paths, signal_pattern)

    missing_csv_pairs = sorted(expected_pairs - csv_pairs)
    missing_signal_pairs = sorted(expected_pairs - signal_pairs)

    if missing_csv_pairs:
        errors.append(f"Missing CSV files for {len(missing_csv_pairs)} ticker-interval pairs")
    if missing_signal_pairs:
        errors.append(
            f"Missing signal JSON files for {len(missing_signal_pairs)} ticker-interval pairs"
        )

    latest_by_pair = {}
    for ticker, interval in sorted(expected_pairs):
        csv_path = os.path.join(data_dir, f"{ticker}_{interval}.csv")
        if not os.path.isfile(csv_path):
            continue
        summary = _read_csv_summary(csv_path)
        if summary.get("error"):
            errors.append(f"{ticker}_{interval}.csv invalid: {summary['error']}")
            continue
        if summary["missing_ohlc"]:
            errors.append(
                f"{ticker}_{interval}.csv missing OHLC columns: {summary['missing_ohlc']}"
            )
        min_rows = MIN_ROWS_BY_INTERVAL.get(interval, 10)
        if summary["rows"] < min_rows:
            errors.append(
                f"{ticker}_{interval}.csv has too few rows: {summary['rows']} < {min_rows}"
            )
        if summary["latest_date"] is None:
            errors.append(f"{ticker}_{interval}.csv has no parsable date value")
        latest_by_pair[(ticker, interval)] = summary["latest_date"]

    interval_ref_date = {}
    for interval in TARGET_INTERVALS:
        dates = [v for (t, i), v in latest_by_pair.items() if i == interval and v is not None]
        if not dates:
            errors.append(f"No valid latest date found for interval {interval}")
            continue
        interval_ref_date[interval] = max(dates)

    for (ticker, interval), latest_dt in sorted(latest_by_pair.items()):
        if latest_dt is None:
            continue
        ref_dt = interval_ref_date.get(interval)
        if ref_dt is None:
            continue
        lag = (ref_dt - latest_dt).days
        limit = _get_lag_limit(interval, ticker, max_lag_by_interval)
        if lag > limit:
            errors.append(
                f"{ticker}_{interval}.csv is stale by {lag} days "
                f"(latest={latest_dt}, ref={ref_dt}, limit={limit})"
            )

    for ticker, interval in sorted(expected_pairs):
        signal_path = os.path.join(signals_dir, f"{ticker}_{interval}_signals.json")
        if not os.path.isfile(signal_path):
            continue
        summary = _read_signal_summary(signal_path)
        if summary.get("error"):
            errors.append(f"{ticker}_{interval}_signals.json invalid: {summary['error']}")
            continue
        if summary["missing_keys"]:
            if summary["is_legacy"]:
                warnings.append(
                    f"{ticker}_{interval}_signals.json uses legacy schema; "
                    "consider regenerating with current analyzer format"
                )
            else:
                errors.append(
                    f"{ticker}_{interval}_signals.json missing keys: {summary['missing_keys']}"
                )
        if summary.get("symbol") and summary["symbol"] != ticker:
            errors.append(
                f"{ticker}_{interval}_signals.json symbol mismatch: {summary['symbol']}"
            )
        if summary.get("interval") and summary["interval"] != interval:
            errors.append(
                f"{ticker}_{interval}_signals.json interval mismatch: {summary['interval']}"
            )
        csv_latest = latest_by_pair.get((ticker, interval))
        sig_latest = summary.get("last_update")
        if csv_latest and sig_latest:
            lag = abs((csv_latest - sig_latest).days)
            limit = _get_lag_limit(interval, ticker, max_lag_by_interval)
            if lag > limit:
                errors.append(
                    f"{ticker}_{interval} signal last_update mismatch: "
                    f"csv={csv_latest}, signal={sig_latest}, limit={limit}"
                )

    if not os.path.isfile(market_info_path):
        errors.append("market_info.json is missing")
    else:
        try:
            with open(market_info_path, "r", encoding="utf-8") as f:
                market_info = json.load(f)
            if not isinstance(market_info, dict):
                errors.append("market_info.json root is not an object")
            else:
                missing_market = [t for t in tickers if t not in market_info]
                if missing_market:
                    errors.append(
                        f"market_info.json missing {len(missing_market)} tickers (e.g. {missing_market[:5]})"
                    )
        except Exception as e:
            errors.append(f"Failed to parse market_info.json: {e}")

    daily_ref = interval_ref_date.get("1d")
    if daily_ref and not args.skip_news_check:
        news_dates = []
        if os.path.isdir(news_dir):
            for name in os.listdir(news_dir):
                if not name.endswith(".md"):
                    continue
                d = _parse_date(name.replace(".md", ""))
                if d:
                    news_dates.append((d, os.path.join(news_dir, name)))
        if not news_dates:
            errors.append("No markdown news file found under data/news")
        else:
            latest_news_date, latest_news_path = max(news_dates, key=lambda x: x[0])
            if abs((latest_news_date - daily_ref).days) > 1:
                errors.append(
                    f"Latest news date {latest_news_date} not aligned with daily ref {daily_ref}"
                )
            if os.path.getsize(latest_news_path) < 100:
                errors.append(f"News file is too small: {os.path.basename(latest_news_path)}")
    elif args.skip_news_check:
        warnings.append("News check skipped by flag")

    checks.append(f"tickers={len(tickers)}")
    checks.append(f"expected_pairs={len(expected_pairs)}")
    checks.append(f"csv_pairs={len(csv_pairs)}")
    checks.append(f"signal_pairs={len(signal_pairs)}")
    checks.append(f"daily_ref={daily_ref if daily_ref else 'N/A'}")
    checks.append(
        "interval_refs="
        + ", ".join(
            f"{k}:{v}" for k, v in sorted(interval_ref_date.items(), key=lambda x: x[0])
        )
    )
    checks.append(
        "lag_limits="
        + ", ".join(
            f"{k}:{v}" for k, v in sorted(max_lag_by_interval.items(), key=lambda x: x[0])
        )
    )

    print("=== Latest Pull Validation Report ===")
    for c in checks:
        print(f"[CHECK] {c}")

    if warnings:
        for w in warnings:
            print(f"[WARN] {w}")

    if errors:
        print(f"[FAIL] Validation failed with {len(errors)} issue(s):")
        for idx, err in enumerate(errors, start=1):
            print(f"  {idx}. {err}")
        return 1

    print("[PASS] Validation passed. Generated data is consistent with expectations.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
