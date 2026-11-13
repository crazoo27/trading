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
- **Alert pada garisan & zon**: pilih garisan mendatar, trend line, ray atau zon, tekan 🔔 Alert. Notifikasi bila harga sentuh/pecah garisan atau masuk zon (juga untuk pair lain dalam watchlist)
- Signal auto (EMA20/50 cross ikut EMA200, RSI keluar 30/70), alert harga, jurnal (win rate, jumlah R, P/L)
- Notifikasi: toast + bunyi + notifikasi browser

## Analisis (tab Analisis)

Analisis berasaskan peraturan, ikut cara trader berpengalaman berfikir. **Bukan ramalan dan bukan jaminan untung.**

- **Multi-timeframe**: trend TF semasa + 2 timeframe lebih besar (cth 15m → 1h & 4h). Bila bercanggah, tiada setup
- **Struktur pasaran**: swing high/low, Higher High/Higher Low atau Lower High/Lower Low, break of structure
- **Zon support/resistance auto** dari kelompok swing (makin banyak sentuhan, makin kukuh), dipapar atas chart
- **Pelan**: entry di zon (bukan kejar harga), SL di sebalik zon + 0.5 ATR, TP di zon seterusnya, R:R dan saiz posisi
- **Senarai semak 7 faktor + gred A/B/C**. Keputusan: SETUP, PASANG LIMIT (tunggu harga datang), atau TUNGGU (dengan sebab)
- **Backtest**: 4 strategi pada data yang dimuat; masuk pada harga buka candle seterusnya, SL dikira dulu kalau SL & TP dalam candle sama, yuran ditolak. Tunjuk win rate, purata R, profit factor, drawdown, konsistensi dua separuh tempoh, dan perbandingan dengan beli & simpan. Diuji: pada data random walk semua strategi rugi selepas yuran (tiada "edge palsu")
- **Had rugi harian** (Tetapan): bila rugi hari ini capai had (default 3R), setup baru perlu pengesahan

## Prestasi

Diukur pada CPU phone simulasi (4x lebih perlahan), latency rangkaian 250 ms:

| | Sebelum | Selepas |
|---|---|---|
| Chart pertama (lawatan pertama) | 3.75 s | 1.2 s |
| Buka semula app | 3.75 s | 0.9 s |
| Kos setiap tick harga | 4.4 ms | 0.02 ms |
| Kelancaran pada 50 tick/saat | 27 fps, 27 frame tersekat | 58 fps, 0 tersekat |

- **Indikator inkremental**: setiap indikator ialah "stepper"; setiap tick cuma kira candle terakhir, bukan semua candle
- **Lukisan dihadkan** kepada 10 kali sesaat untuk tick harga, dan berhenti terus bila app di latar belakang; panel sisi 4 kali sesaat, hanya tab yang dibuka
- **Muat turun selari**: semua halaman candle diminta serentak, dan permintaan dimulakan dalam `<head>` sebelum skrip chart siap dimuat
- **Cache**: service worker simpan fail app (buka serta-merta, boleh buka offline); 600 candle terakhir disimpan untuk setiap pair/timeframe
- **Sambung semula pintar**: watchdog kesan sambungan yang mati senyap; bila app kembali aktif, data ditarik semula serta-merta

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
- Pemantauan jalan **selagi tab terbuka**. Aktifkan notifikasi browser di Tetapan. Bila app dibuka semula selepas phone dikunci, candle yang terlepas disemak balik supaya TP/SL yang kena tetap direkod (untuk pair yang sedang dibuka).
- Kalau tiada sumber data dapat dicapai dan tiada chart tersimpan, app tukar ke **mod demo** (data simulasi). Kalau ada chart tersimpan, ia kekal dipapar dan app cuba sambung semula sendiri.
- App ni untuk analisis & rancang. Ia **tak** letak order sebenar di exchange.
- Chart dikuasakan oleh [Lightweight Charts](https://github.com/tradingview/lightweight-charts) (Apache-2.0), dalam `lib/`.
