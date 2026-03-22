import os
import time
import json
import asyncio
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import pandas as pd
from datetime import datetime

app = FastAPI(title="Chanlun Quant Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Simulated calculation delay for processing complex signal strategy
async def calculate_signals(symbol: str, tf: str):
    csv_path = os.path.join("data", f"{symbol}_{tf}.csv")
    
    if not os.path.exists(csv_path):
        return {"error": f"Data file {csv_path} not found"}
        
    try:
        df = pd.read_csv(csv_path)
        if df.empty:
            return {"error": "Empty data"}
            
        date_col = df.columns[0]
        markers = []
        bi = []
        
        step = 12 if tf in ['1d', '1wk'] else 6
        
        for i in range(0, len(df) - step, step):
            start_row = df.iloc[i]
            end_row = df.iloc[i+step]
            
            direction = 1 if (i // step) % 2 == 0 else -1
            dt_start = str(start_row[date_col]).split(" ")[0]
            dt_end = str(end_row[date_col]).split(" ")[0]
            
            bi.append({
                "start_dt": dt_start,
                "end_dt": dt_end,
                "direction": direction,
                "high": float(max(start_row['High'], end_row['High'])),
                "low": float(min(start_row['Low'], end_row['Low']))
            })
            
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
            
        return {
            "symbol": symbol,
            "interval": tf,
            "last_update": datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            "bi": bi,
            "markers": markers
        }
    except Exception as e:
        return {"error": str(e)}

@app.post("/api/run_strategy")
async def run_strategy(request: Request):
    payload = await request.json()
    symbol = payload.get("symbol", "AAPL")
    tf = payload.get("timeframe", "1d")
    
    # Simulate heavy calculation workload
    await asyncio.sleep(1.5)
    
    # Calculate the signals
    result = await calculate_signals(symbol, tf)
    
    if "error" in result:
        return JSONResponse(status_code=400, content={"message": result["error"]})
        
    return JSONResponse(content={"status": "success", "data": result})

# Mount the static directory (the current working directory)
app.mount("/", StaticFiles(directory=".", html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="0.0.0.0", port=8000, reload=True)
