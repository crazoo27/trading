# trading

## GoldPanel (MT5) – panel analisa XAUUSD

Panel atas chart untuk trade emas, diilhamkan dari panel "AI" yang selalu keluar dalam video promo.
Versi ni **tak ada AI dan tak buka trade sendiri**. Dia baca chart, kira confluence, dan cadangkan plan.

Fail: `MQL5/Indicators/GoldPanel/GoldPanel.mq5`

### Apa yang ada

| Tab / fungsi | Penerangan |
|---|---|
| Header | Equity, floating P/L, margin level, status market, ticker news USD impak tinggi seterusnya |
| **SIGNAL** (OmniScore) | Skor -6 hingga +6 dari 6 faktor: trend H4 (EMA50), EMA20 vs EMA50, RSI(14), MACD, posisi dalam julat 20 bar, breakout Asia range. Skor ≥ 3 → BELI, ≤ -3 → JUAL. Entry/SL/TP1/TP2 ikut ATR. |
| **INDIKATOR** | Preset Scalping (M5), Intraday (M15), Swing (H1). On/off: Sesi Trading, Asia Range/Killzone, HTF Candles, News Events, Candle Timer, Plan Entry/SL/TP |
| **MARKET** | Bid/ask, spread, range hari ni, ATR, volatiliti (tinggi/normal/rendah), sesi aktif, Asia high/low, masa server, countdown candle H4 |
| **INFO** | Cara guna + amaran |
| Atas chart | Kotak sesi Asia/London/NY, killzone, garisan Asia high/low, kotak candle H4, garisan news, garisan Entry/SL/TP, timer candle |

Signal **ditahan** 30 minit sebelum dan selepas news USD impak tinggi.

### Cara pasang

1. Buka MT5 → **File → Open Data Folder** → masuk `MQL5/Indicators/`
2. Copy folder `GoldPanel` (yang ada `GoldPanel.mq5`) ke situ
3. Tekan **F4** untuk buka MetaEditor → buka `GoldPanel.mq5` → tekan **F7** (Compile). Pastikan `0 errors`
4. Balik MT5 → Navigator → Indicators → seret **GoldPanel** ke chart XAUUSD (M5 / M15 paling sesuai)
5. Kalau masa sesi nampak lari, set `Offset server broker dari GMT` dalam input (contoh broker GMT+2 → isi `2`)

### Input penting

- Jam sesi dan killzone (dalam **GMT**). Waktu musim panas/sejuk UK dan US berubah sejam, jadi laraskan ikut keperluan
- `Skor minimum` (default 3 dari 6)
- `TP1` / `TP2` dalam gandaan risiko (default 1R / 2R)
- `Tahan signal +/- minit sekitar news` (default 30)

### Amaran

Ni alat analisa, bukan mesin duit. Tak ada indicator yang menang 80% secara konsisten dalam semua keadaan market.
Test di **akaun demo** sekurang-kurangnya 2–4 minggu, catat setiap trade, dan pakai risiko 1–2% sahaja setiap entry.
