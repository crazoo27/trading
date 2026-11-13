# TradeDesk

App trading berasaskan web: pantau chart **real-time** dan bina setup trade **secara live**. Engine dia pantau setiap setup dan bagi notifikasi bila entry, TP atau SL kena.

## Cara guna

Tak perlu install apa-apa. Cuma servekan folder ni:

```bash
python3 -m http.server 8000
# buka http://localhost:8000
```

(Boleh juga deploy ke GitHub Pages / Netlify / Vercel sebagai static site. Bila dah ada link, boleh buka kat phone.)

## Fungsi

| Bahagian | Apa dia buat |
|---|---|
| **Chart live** | Candlestick + volume dari Binance WebSocket, timeframe 1m–1d, EMA 20/50/200, RSI 14 |
| **Watchlist** | BTC, ETH, SOL, BNB, XRP, PAXG (≈ emas). Tambah pair lain di ⚙ |
| **Setup builder** | Long/Short, entry limit/stop atau market. Tekan 🎯 lepas tu klik atas chart untuk set Entry/SL/TP |
| **Kalkulator risiko** | Kira saiz posisi ikut modal & risk %, R:R, nilai posisi, amaran leverage & R:R < 1 |
| **⚡ Cadang setup** | Auto isi setup guna trend EMA200 + SL 1.5×ATR, TP 1.5R / 3R |
| **Pemantau setup** | Pending → Aktif → TP1 (50% tutup, SL ke breakeven) → TP2 / SL. P/L live dalam R dan $ |
| **Signal auto** | EMA20/50 cross (ikut arah EMA200) dan RSI keluar dari zon 30/70, ditanda atas chart + notifikasi |
| **Alert harga** | Notifikasi bila harga sentuh paras yang ditetapkan |
| **Jurnal** | Win rate, jumlah R, P/L, sejarah setup |

## Nota

- Semua data disimpan dalam `localStorage` browser sahaja.
- Pemantauan jalan **selagi tab terbuka**. Tekan "Aktifkan notifikasi browser" di ⚙ supaya dapat notifikasi walaupun tab di belakang.
- Kalau Binance tak dapat dicapai, app tukar automatik ke **mod demo** (data simulasi).
- App ni untuk pantau & rancang. Ia **tak** letak order sebenar di broker/exchange.
