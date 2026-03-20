import os
from datetime import datetime
import yfinance as yf
from deep_translator import GoogleTranslator

# Configuration
TICKERS = ["SPY", "QQQ", "MSFT", "TSLA", "NVDA", "AAPL"]

# Ensure directory exists
os.makedirs("data/news", exist_ok=True)

today_str = datetime.now().strftime('%Y-%m-%d')
filename = f"data/news/{today_str}.md"

# Translator
translator = GoogleTranslator(source='auto', target='zh-CN')

def translate_text(text):
    if not text:
        return ""
    try:
        if len(text) > 4000:
            text = text[:4000] + "..."
        translated = translator.translate(text)
        return translated if translated else text
    except Exception as e:
        print(f"Translation error: {e}")
        return text

def fetch_and_translate_news(ticker, section_title):
    print(f"Fetching {section_title}...")
    try:
        tkr = yf.Ticker(ticker)
        articles = tkr.news
    except Exception as e:
        print(f"Failed to fetch news for {ticker}: {e}")
        articles = []
    
    if not articles:
        return f"## {section_title}\n\n*本日未抓取到相关新闻*\n\n"
        
    markdown_content = f"## {section_title}\n\n"
    
    # We'll take top 5 news per ticker to avoid rate limits / huge files
    for i, article in enumerate(articles[:5]):
        content = article.get('content', {})
        if not content:
            # Fallback for alternative structures some yfinance versions return
            content = article
            
        pub_date = content.get('pubDate', '')
        title = content.get('title', '')
        description = content.get('summary', '')
        # Fallback if URL is missing
        link = content.get('clickThroughUrl') or content.get('url') or link
        
        provider = content.get('provider', {}).get('displayName', 'News')
        
        print(f"  Translating piece {i+1} for {ticker}: {title[:30]}...")
        zh_title = translate_text(title)
        zh_desc = translate_text(description)
        
        markdown_content += f"### {zh_title}\n"
        markdown_content += f"> **发布时间:** {pub_date} | **来源:** {provider}\n>\n"
        markdown_content += f"> **原文标题:** {title}\n\n"
        if zh_desc:
            markdown_content += f"{zh_desc}\n\n"
        markdown_content += f"[🔗 阅读原文]({link})\n\n---\n\n"
        
    return markdown_content

def main():
    markdown_output = f"# 美股与经济新闻简报 ({today_str})\n\n"
    markdown_output += f"**数据来源:** Yahoo Finance\n\n"
    
    # 1. Macro / Economy News (Represented by SPY & QQQ)
    markdown_output += fetch_and_translate_news("SPY", "🌍 宏观市场综合新闻 (SPY 标普500)")
    markdown_output += fetch_and_translate_news("QQQ", "🌍 科技股大盘新闻 (QQQ 纳斯达克)")
    
    # 2. Watchlist News
    for tk in ["MSFT", "TSLA", "NVDA", "AAPL"]:
        markdown_output += fetch_and_translate_news(tk, f"📈 个股新闻: {tk}")

    # Save to file
    with open(filename, "w", encoding="utf-8") as f:
        f.write(markdown_output)
        
    print(f"Successfully generated news report: {filename}")

if __name__ == "__main__":
    main()
