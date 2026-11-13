# TradeDesk

Platform charting berasaskan web untuk pantau chart **real-time**, lukis analisis, dan bina setup trade yang dipantau secara automatik. Tak perlu install apa-apa.

```bash
python3 -m http.server 8000
# buka http://localhost:8000
```

Boleh juga deploy sebagai static site (GitHub Pages / Netlify / Vercel) supaya boleh buka kat phone.

## Fungsi

**Chart**
- Data live Binance spot melalui WebSocket. Timeframe 1m hingga 1w, sejarah 1000 candle
- Jenis chart: Candle, Candle kosong, Bar, Heikin Ashi, Garisan, Kawasan
- Skala harga normal / % / log, countdown tutup candle, butang » ke candle terkini, snapshot PNG, skrin penuh
- Cari pair: tekan butang simbol atau terus taip nama pair (cth `sol`) kat mana-mana

**Indikator** (ƒx). Boleh tambah banyak kali, ubah tempoh/warna, sorok, buang
- Atas chart: EMA, SMA, Bollinger Bands, VWAP, Supertrend, Volume
- Panel sendiri: RSI, MACD, Stochastic, ATR. Saiz panel boleh diubah dengan tarik garis pemisah

**Drawing tools** (bar kiri). Lukisan disimpan ikut pair dan kekal bila tukar timeframe
- Trend line, Ray, Garisan mendatar (dengan label harga), Garisan menegak, Kotak/zon, Fibonacci retracement, Ukur julat, Teks
- **Long / Short position**: kotak target/stop yang boleh ditarik, dengan R:R dan saiz lot ikut modal & risk %. Tekan **▶ Pantau setup** untuk terus jadikan setup
- Magnet (lekat ke OHLC), sorok semua, padam semua, undo (Ctrl+Z), padam terpilih (Del)

**Untuk pengguna Malaysia / phone**
- Paparan wang dalam **RM** (kadar USD→MYR live, boleh ubah sendiri) atau USD
- **Mod akaun spot** (cth Luno): sorok Short, amaran bila trend turun
- Sumber data auto: Binance → OKX → Coinbase (Binance disekat di sesetengah network)
- Boleh dipasang ke home screen (ikon app, skrin penuh), panduan muncul bila pilih tool

**Setup & pemantauan**
- Setup builder: entry/SL/TP1/TP2, kalkulator saiz posisi, amaran R:R < 1 dan leverage
- ⚡ Cadang setup: trend EMA200 + SL 1.5×ATR, TP 1.5R / 3R
- Setup dipantau live: Tunggu entry → Aktif → TP1 (50% tutup, SL ke breakeven) → TP2 / SL, dengan P/L dalam R dan $
- Signal auto (EMA20/50 cross ikut EMA200, RSI keluar 30/70), alert harga, jurnal (win rate, jumlah R, P/L)
- Notifikasi: toast + bunyi + notifikasi browser

## Shortcut

| Kekunci | Fungsi |
|---|---|
| Taip huruf/nombor | Cari pair |
| Esc | Batal tool / tutup dialog |
| Del | Padam lukisan terpilih |
| Ctrl+Z | Undo lukisan |
| Alt+T / H / V / F / R / L / S | Trend / Mendatar / Menegak / Fib / Kotak / Long / Short |

## Nota

- Semua data (lukisan, indikator, setup, jurnal) disimpan dalam `localStorage` browser sahaja.
- Pemantauan jalan **selagi tab terbuka**. Aktifkan notifikasi browser di Tetapan.
- Kalau Binance tak dapat dicapai, app tukar automatik ke **mod demo** (data simulasi).
- App ni untuk analisis & rancang. Ia **tak** letak order sebenar di exchange.
- Chart dikuasakan oleh [Lightweight Charts](https://github.com/tradingview/lightweight-charts) (Apache-2.0), dalam `lib/`.
