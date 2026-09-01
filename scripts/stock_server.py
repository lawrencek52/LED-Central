from flask import Flask, jsonify
import yfinance as yf

app = Flask(__name__)

# Define the stock tickers you want to track on your display
TICKERS = ["AAPL", "MSFT", "GOOGL", "AMZN", "TSLA", "AMD"]

@app.route('/api/stocks', methods=['GET'])
def get_stock_ticker_data():
    ticker_strings = []

    for ticker in TICKERS:
        try:
            # Fetch market data from Yahoo Finance
            stock = yf.Ticker(ticker)
            info = stock.fast_info

            price = info['last_price']
            prev_close = info['previous_close']
            change = price - prev_close
            pct_change = (change / prev_close) * 100

            # Format text with a visual directional indicator
            sign = "+" if change >= 0 else ""
            arrow = "▲" if change >= 0 else "▼"

            ticker_strings.append(f"{ticker} {price:.2f} {arrow} {sign}{pct_change:.2f}%")
        except Exception as e:
            continue

    # Combine all text strings separated by spaces for a scrolling ticker format
    full_ticker_text = "   |   ".join(ticker_strings)

    # Return the structure required by NightDriverStrip's JSON or plaintext expectations
    return jsonify({"data": full_ticker_text})

if __name__ == '__main__':
    # Run on port 5000 and bind to all network interfaces
    app.run(host='0.0.0.0', port=5000)

