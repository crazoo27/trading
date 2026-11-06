//+------------------------------------------------------------------+
//|                                                    GoldPanel.mq5 |
//|  Panel analisa XAUUSD untuk MetaTrader 5                         |
//|   - Sesi Asia / London / New York + Killzone                     |
//|   - Asia Range (high/low) & breakout                             |
//|   - Kotak candle HTF (default H4) atas timeframe kecil           |
//|   - Candle timer                                                 |
//|   - News impak tinggi (Kalendar Ekonomi MT5)                     |
//|   - OmniScore: skor confluence 6 faktor + cadangan Entry/SL/TP   |
//|  Indicator ni TIDAK buka atau tutup trade. Analisa sahaja.       |
//+------------------------------------------------------------------+
#property copyright   "GoldPanel"
#property version     "1.00"
#property description "Panel confluence XAUUSD: sesi, killzone, Asia range, candle HTF, timer, news dan OmniScore (Entry/SL/TP)."
#property description "Analisa sahaja - indicator ni tidak buka trade."
#property indicator_chart_window
#property indicator_buffers 0
#property indicator_plots   0

//--- input
input group "Panel"
input string InpPanelName     = "GOLD PANEL";  // Nama panel
input int    InpPanelX        = 10;            // Kedudukan X
input int    InpPanelY        = 25;            // Kedudukan Y

input group "Masa sesi (jam GMT)"
input int    InpGMTOffset     = 99;   // Offset server broker dari GMT (99 = auto)
input int    InpAsiaStart     = 0;    // Asia mula
input int    InpAsiaEnd       = 7;    // Asia tamat
input int    InpLondonStart   = 7;    // London mula
input int    InpLondonEnd     = 16;   // London tamat
input int    InpNYStart       = 12;   // New York mula
input int    InpNYEnd         = 21;   // New York tamat
input int    InpLondonKZStart = 7;    // London Killzone mula
input int    InpLondonKZEnd   = 10;   // London Killzone tamat
input int    InpNYKZStart     = 12;   // NY Killzone mula
input int    InpNYKZEnd       = 15;   // NY Killzone tamat
input int    InpDaysBack      = 3;    // Bilangan hari dipaparkan

input group "Candle HTF"
input ENUM_TIMEFRAMES InpHTF  = PERIOD_H4; // Timeframe besar
input int    InpHTFCount      = 10;        // Bilangan candle HTF

input group "News"
input string InpNewsCurrency  = "USD"; // Matawang news
input int    InpNewsBlockMin  = 30;    // Tahan signal +/- minit sekitar news impak tinggi

input group "OmniScore"
input int    InpMinScore      = 3;     // Skor minimum (dari 6) untuk keluar signal
input double InpRR1           = 1.0;   // TP1 (kali risiko)
input double InpRR2           = 2.0;   // TP2 (kali risiko)

//--- prefix objek
#define PFX     "GCP_"
#define PFX_P   "GCP_P_"
#define PFX_C   "GCP_C_"
#define PFX_D   "GCP_D_"
#define TMR_OBJ "GCP_X_TMR"

#define PANEL_W 360
#define PANEL_H 452

//--- warna
#define C_BG     C'7,16,32'
#define C_HEAD   C'12,36,74'
#define C_BORDER C'38,92,170'
#define C_BOX    C'16,32,60'
#define C_TXT    C'200,215,235'
#define C_DIM    C'115,135,165'
#define C_ACC    C'40,140,240'
#define C_ON     C'60,200,120'
#define C_ONTXT  C'5,30,15'
#define C_UP     C'70,210,130'
#define C_DN     C'240,90,90'
#define C_GOLD   C'230,190,80'
#define C_KZ     C'40,22,58'

//--- preset gaya trading
string          PRESET_NAME[3] = {"SCALPING", "INTRADAY", "SWING"};
ENUM_TIMEFRAMES PRESET_TF[3]   = {PERIOD_M5, PERIOD_M15, PERIOD_H1};
double          PRESET_ATR[3]  = {1.0, 1.5, 2.0};

string TABS[4]     = {"SIGNAL", "INDIKATOR", "MARKET", "INFO"};
string TOG_NAME[6] = {"Sesi Trading", "Asia Range / Killzone", "HTF Candles", "News Events", "Candle Timer", "Plan Entry/SL/TP"};
string FACTOR[6]   = {"Trend HTF (EMA50)", "Trend EMA20 vs EMA50", "Momentum RSI(14)", "MACD (12,26,9)", "Posisi julat 20 bar", "Asia Range breakout"};

//--- state
int  g_tab = 0;
int  g_preset = 1;
bool g_min = false;
bool g_tog[6];

//--- handle indicator
int hEMA20[3], hEMA50[3], hRSI[3], hMACD[3], hATR[3];
int hHTFema = INVALID_HANDLE;

//--- Asia range
bool     g_asiaOk = false;
double   g_asiaHi = 0, g_asiaLo = 0;
datetime g_asiaT1 = 0, g_asiaT2 = 0;

//--- news
bool     g_newsOk = false;
datetime g_newsT[];
string   g_newsN[];
datetime g_newsLoaded = 0;

//--- skor
struct Score
  {
   int    f[6];
   int    total;
   double entry, sl, tp1, tp2, atr;
   bool   ready;
   bool   news;
  };
Score g_sc;

datetime g_lastDraw = 0;
int      g_lastDoy  = -1;

//--- simbol unicode (elak masalah encoding fail)
string S_UP, S_DN, S_SQ, S_DOT;

//+------------------------------------------------------------------+
//| Utiliti                                                          |
//+------------------------------------------------------------------+
string TFName(ENUM_TIMEFRAMES tf)
  {
   if(tf == PERIOD_CURRENT)
      tf = (ENUM_TIMEFRAMES)_Period;
   return StringSubstr(EnumToString(tf), 7);
  }

int ServerOffset()
  {
   if(InpGMTOffset != 99)
      return InpGMTOffset;
   return (int)MathRound((double)((long)TimeTradeServer() - (long)TimeGMT()) / 3600.0);
  }

datetime TodayGMT()
  {
   return (datetime)(((long)TimeGMT() / 86400) * 86400);
  }

// Tetingkap sesi (masa server) bagi hari GMT tertentu
void SessionWindow(datetime dayGMT, int sH, int eH, datetime &t1, datetime &t2)
  {
   long off = (long)ServerOffset() * 3600;
   t1 = (datetime)((long)dayGMT + sH * 3600 + off);
   t2 = (datetime)((long)dayGMT + eH * 3600 + off);
   if(eH <= sH)
      t2 = (datetime)((long)t2 + 86400);
  }

bool InHour(int h, int s, int e)
  {
   if(s < e)
      return (h >= s && h < e);
   return (h >= s || h < e);
  }

// High/low dalam julat masa guna data M5
bool RangeHL(datetime t1, datetime t2, double &hi, double &lo)
  {
   if(t2 <= t1)
      return false;
   double h[], l[];
   int n1 = CopyHigh(_Symbol, PERIOD_M5, t1, t2, h);
   int n2 = CopyLow(_Symbol, PERIOD_M5, t1, t2, l);
   if(n1 <= 0 || n2 <= 0)
      return false;
   hi = h[ArrayMaximum(h)];
   lo = l[ArrayMinimum(l)];
   return true;
  }

bool Buf(int handle, int buffer, int shift, double &v)
  {
   double a[];
   if(handle == INVALID_HANDLE)
      return false;
   if(CopyBuffer(handle, buffer, shift, 1, a) != 1)
      return false;
   v = a[0];
   return true;
  }

string Countdown(ENUM_TIMEFRAMES tf)
  {
   long left = (long)iTime(_Symbol, tf, 0) + PeriodSeconds(tf) - (long)TimeTradeServer();
   if(left < 0)
      left = 0;
   int h = (int)(left / 3600);
   int m = (int)((left % 3600) / 60);
   int s = (int)(left % 60);
   if(h > 0)
      return StringFormat("%d:%02d:%02d", h, m, s);
   return StringFormat("%02d:%02d", m, s);
  }

string FmtShort(datetime t)
  {
   MqlDateTime d;
   TimeToStruct(t, d);
   return StringFormat("%02d.%02d %02d:%02d", d.day, d.mon, d.hour, d.min);
  }

string Money(double v)
  {
   string cur = AccountInfoString(ACCOUNT_CURRENCY);
   if(cur == "USD")
      return "$" + DoubleToString(v, 2);
   return DoubleToString(v, 2) + " " + cur;
  }

int Pts(double diff)
  {
   return (int)MathRound(MathAbs(diff) / _Point);
  }

string Px(double p)
  {
   return DoubleToString(p, _Digits);
  }

//+------------------------------------------------------------------+
//| Objek panel                                                      |
//+------------------------------------------------------------------+
void ObjBase(string n)
  {
   ObjectSetInteger(0, n, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, n, OBJPROP_HIDDEN, true);
   ObjectSetInteger(0, n, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, n, OBJPROP_BACK, false);
  }

void PRect(string n, int x, int y, int w, int h, color bg, color bd)
  {
   if(ObjectFind(0, n) < 0)
      ObjectCreate(0, n, OBJ_RECTANGLE_LABEL, 0, 0, 0);
   ObjBase(n);
   ObjectSetInteger(0, n, OBJPROP_XDISTANCE, x);
   ObjectSetInteger(0, n, OBJPROP_YDISTANCE, y);
   ObjectSetInteger(0, n, OBJPROP_XSIZE, w);
   ObjectSetInteger(0, n, OBJPROP_YSIZE, h);
   ObjectSetInteger(0, n, OBJPROP_BGCOLOR, bg);
   ObjectSetInteger(0, n, OBJPROP_BORDER_TYPE, BORDER_FLAT);
   ObjectSetInteger(0, n, OBJPROP_COLOR, bd);
   ObjectSetInteger(0, n, OBJPROP_WIDTH, 1);
   ObjectSetInteger(0, n, OBJPROP_ZORDER, 0);
  }

void PLabel(string n, int x, int y, string txt, color c, int sz = 8,
            string font = "Segoe UI", ENUM_ANCHOR_POINT anc = ANCHOR_LEFT_UPPER)
  {
   if(ObjectFind(0, n) < 0)
      ObjectCreate(0, n, OBJ_LABEL, 0, 0, 0);
   ObjBase(n);
   ObjectSetInteger(0, n, OBJPROP_XDISTANCE, x);
   ObjectSetInteger(0, n, OBJPROP_YDISTANCE, y);
   ObjectSetInteger(0, n, OBJPROP_ANCHOR, anc);
   ObjectSetString(0, n, OBJPROP_TEXT, txt);
   ObjectSetString(0, n, OBJPROP_FONT, font);
   ObjectSetInteger(0, n, OBJPROP_FONTSIZE, sz);
   ObjectSetInteger(0, n, OBJPROP_COLOR, c);
   ObjectSetInteger(0, n, OBJPROP_ZORDER, 1);
  }

void PButton(string n, int x, int y, int w, int h, string txt, color bg, color fg, int sz = 8)
  {
   if(ObjectFind(0, n) < 0)
      ObjectCreate(0, n, OBJ_BUTTON, 0, 0, 0);
   ObjBase(n);
   ObjectSetInteger(0, n, OBJPROP_XDISTANCE, x);
   ObjectSetInteger(0, n, OBJPROP_YDISTANCE, y);
   ObjectSetInteger(0, n, OBJPROP_XSIZE, w);
   ObjectSetInteger(0, n, OBJPROP_YSIZE, h);
   ObjectSetString(0, n, OBJPROP_TEXT, txt);
   ObjectSetString(0, n, OBJPROP_FONT, "Segoe UI Semibold");
   ObjectSetInteger(0, n, OBJPROP_FONTSIZE, sz);
   ObjectSetInteger(0, n, OBJPROP_COLOR, fg);
   ObjectSetInteger(0, n, OBJPROP_BGCOLOR, bg);
   ObjectSetInteger(0, n, OBJPROP_BORDER_COLOR, C_BORDER);
   ObjectSetInteger(0, n, OBJPROP_STATE, false);
   ObjectSetInteger(0, n, OBJPROP_ZORDER, 10);
  }

void SetTxt(string n, string t, color c = clrNONE)
  {
   if(ObjectFind(0, n) < 0)
      return;
   ObjectSetString(0, n, OBJPROP_TEXT, t);
   if(c != clrNONE)
      ObjectSetInteger(0, n, OBJPROP_COLOR, c);
  }

//+------------------------------------------------------------------+
//| Objek atas chart (masa/harga)                                    |
//+------------------------------------------------------------------+
void ChartBase(string n, color c, bool back)
  {
   ObjectSetInteger(0, n, OBJPROP_COLOR, c);
   ObjectSetInteger(0, n, OBJPROP_BACK, back);
   ObjectSetInteger(0, n, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, n, OBJPROP_HIDDEN, true);
  }

void RectPrice(string n, datetime t1, double p1, datetime t2, double p2, color c,
               bool fill, ENUM_LINE_STYLE st)
  {
   if(ObjectFind(0, n) < 0)
      ObjectCreate(0, n, OBJ_RECTANGLE, 0, t1, p1, t2, p2);
   else
     {
      ObjectMove(0, n, 0, t1, p1);
      ObjectMove(0, n, 1, t2, p2);
     }
   ChartBase(n, c, true);
   ObjectSetInteger(0, n, OBJPROP_STYLE, st);
   ObjectSetInteger(0, n, OBJPROP_WIDTH, 1);
   ObjectSetInteger(0, n, OBJPROP_FILL, fill);
  }

void Seg(string n, datetime t1, datetime t2, double p, color c, ENUM_LINE_STYLE st, int w = 1)
  {
   if(ObjectFind(0, n) < 0)
      ObjectCreate(0, n, OBJ_TREND, 0, t1, p, t2, p);
   else
     {
      ObjectMove(0, n, 0, t1, p);
      ObjectMove(0, n, 1, t2, p);
     }
   ChartBase(n, c, true);
   ObjectSetInteger(0, n, OBJPROP_STYLE, st);
   ObjectSetInteger(0, n, OBJPROP_WIDTH, w);
   ObjectSetInteger(0, n, OBJPROP_RAY_RIGHT, false);
   ObjectSetInteger(0, n, OBJPROP_RAY_LEFT, false);
  }

void VLine(string n, datetime t, color c)
  {
   if(ObjectFind(0, n) < 0)
      ObjectCreate(0, n, OBJ_VLINE, 0, t, 0);
   else
      ObjectMove(0, n, 0, t, 0);
   ChartBase(n, c, true);
   ObjectSetInteger(0, n, OBJPROP_STYLE, STYLE_DOT);
  }

void TextAt(string n, datetime t, double p, string txt, color c, int sz, ENUM_ANCHOR_POINT anc)
  {
   if(ObjectFind(0, n) < 0)
      ObjectCreate(0, n, OBJ_TEXT, 0, t, p);
   else
      ObjectMove(0, n, 0, t, p);
   ChartBase(n, c, false);
   ObjectSetString(0, n, OBJPROP_TEXT, txt);
   ObjectSetString(0, n, OBJPROP_FONT, "Segoe UI");
   ObjectSetInteger(0, n, OBJPROP_FONTSIZE, sz);
   ObjectSetInteger(0, n, OBJPROP_ANCHOR, anc);
  }

//+------------------------------------------------------------------+
//| Simpan / muat tetapan                                            |
//+------------------------------------------------------------------+
string GV(string k)
  {
   return "GCP_" + _Symbol + "_" + k;
  }

void SaveLayout()
  {
   GlobalVariableSet(GV("tab"), g_tab);
   GlobalVariableSet(GV("pre"), g_preset);
   GlobalVariableSet(GV("min"), g_min ? 1 : 0);
   for(int i = 0; i < 6; i++)
      GlobalVariableSet(GV("t" + IntegerToString(i)), g_tog[i] ? 1 : 0);
  }

void DefaultLayout()
  {
   g_tab = 0;
   g_preset = 1;
   g_min = false;
   for(int i = 0; i < 6; i++)
      g_tog[i] = true;
  }

void LoadLayout()
  {
   DefaultLayout();
   if(GlobalVariableCheck(GV("tab")))
      g_tab = (int)GlobalVariableGet(GV("tab"));
   if(GlobalVariableCheck(GV("pre")))
      g_preset = (int)GlobalVariableGet(GV("pre"));
   if(GlobalVariableCheck(GV("min")))
      g_min = (GlobalVariableGet(GV("min")) > 0.5);
   for(int i = 0; i < 6; i++)
     {
      string k = GV("t" + IntegerToString(i));
      if(GlobalVariableCheck(k))
         g_tog[i] = (GlobalVariableGet(k) > 0.5);
     }
   if(g_tab < 0 || g_tab > 3)
      g_tab = 0;
   if(g_preset < 0 || g_preset > 2)
      g_preset = 1;
  }

//+------------------------------------------------------------------+
//| Data: Asia range, news, skor                                     |
//+------------------------------------------------------------------+
void ComputeAsia()
  {
   g_asiaOk = false;
   datetime now = TimeTradeServer();
   datetime day0 = TodayGMT();
   for(int d = 0; d < 7; d++)
     {
      datetime t1, t2;
      SessionWindow((datetime)((long)day0 - d * 86400), InpAsiaStart, InpAsiaEnd, t1, t2);
      if(t1 > now)
         continue;
      datetime te = (t2 < now ? t2 : now);
      double hi, lo;
      if(!RangeHL(t1, (datetime)((long)te - 1), hi, lo))
         continue;
      g_asiaHi = hi;
      g_asiaLo = lo;
      g_asiaT1 = t1;
      g_asiaT2 = t2;
      g_asiaOk = true;
      return;
     }
  }

void LoadNews()
  {
   ArrayResize(g_newsT, 0);
   ArrayResize(g_newsN, 0);
   g_newsOk = false;
   datetime now = TimeTradeServer();
   MqlCalendarValue vals[];
   ResetLastError();
   if(!CalendarValueHistory(vals, (datetime)((long)now - 86400), (datetime)((long)now + 3 * 86400), NULL, InpNewsCurrency))
      return;
   g_newsOk = true;
   int n = ArraySize(vals);
   for(int i = 0; i < n; i++)
     {
      MqlCalendarEvent ev;
      if(!CalendarEventById(vals[i].event_id, ev))
         continue;
      if(ev.importance != CALENDAR_IMPORTANCE_HIGH)
         continue;
      int k = ArraySize(g_newsT);
      ArrayResize(g_newsT, k + 1);
      ArrayResize(g_newsN, k + 1);
      g_newsT[k] = vals[i].time;
      g_newsN[k] = ev.name;
     }
//--- susun ikut masa
   int m = ArraySize(g_newsT);
   for(int i = 1; i < m; i++)
      for(int j = i; j > 0 && g_newsT[j] < g_newsT[j - 1]; j--)
        {
         datetime tt = g_newsT[j];
         g_newsT[j] = g_newsT[j - 1];
         g_newsT[j - 1] = tt;
         string ss = g_newsN[j];
         g_newsN[j] = g_newsN[j - 1];
         g_newsN[j - 1] = ss;
        }
  }

bool NewsBlock()
  {
   long now = (long)TimeTradeServer();
   for(int i = 0; i < ArraySize(g_newsT); i++)
      if(MathAbs((long)g_newsT[i] - now) <= (long)InpNewsBlockMin * 60)
         return true;
   return false;
  }

string NewsTicker()
  {
   if(!g_newsOk)
      return "NEWS  Kalendar ekonomi tak tersedia pada akaun ini";
   long now = (long)TimeTradeServer();
   for(int i = 0; i < ArraySize(g_newsT); i++)
      if((long)g_newsT[i] >= now - (long)InpNewsBlockMin * 60)
        {
         string nm = g_newsN[i];
         if(StringLen(nm) > 34)
            nm = StringSubstr(nm, 0, 33) + ".";
         return "NEWS " + InpNewsCurrency + "  " + nm + "  |  " + FmtShort(g_newsT[i]);
        }
   return "NEWS " + InpNewsCurrency + "  Tiada news impak tinggi dalam 3 hari";
  }

void ComputeScore()
  {
   Score s;
   ZeroMemory(s);
   int p = g_preset;
   ENUM_TIMEFRAMES tf = PRESET_TF[p];

   double htfEma, e20, e50, rsi, macdM, macdS, atr;
   if(!Buf(hHTFema, 0, 1, htfEma) || !Buf(hEMA20[p], 0, 1, e20) || !Buf(hEMA50[p], 0, 1, e50) ||
      !Buf(hRSI[p], 0, 1, rsi) || !Buf(hMACD[p], 0, 1, macdM) || !Buf(hMACD[p], 1, 1, macdS) ||
      !Buf(hATR[p], 0, 1, atr))
     {
      g_sc = s;
      return;
     }

   double htfClose = iClose(_Symbol, InpHTF, 1);
   double c1  = iClose(_Symbol, tf, 1);
   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   if(htfClose <= 0 || c1 <= 0 || bid <= 0)
     {
      g_sc = s;
      return;
     }

//--- 1. trend HTF
   s.f[0] = (htfClose > htfEma) ? 1 : (htfClose < htfEma ? -1 : 0);
//--- 2. trend TF signal
   s.f[1] = (e20 > e50) ? 1 : (e20 < e50 ? -1 : 0);
//--- 3. momentum RSI
   s.f[2] = (rsi > 55) ? 1 : (rsi < 45 ? -1 : 0);
//--- 4. MACD
   s.f[3] = (macdM > macdS) ? 1 : (macdM < macdS ? -1 : 0);
//--- 5. posisi dalam julat 20 bar
   int ih = iHighest(_Symbol, tf, MODE_HIGH, 20, 2);
   int il = iLowest(_Symbol, tf, MODE_LOW, 20, 2);
   if(ih >= 0 && il >= 0)
     {
      double H = iHigh(_Symbol, tf, ih), L = iLow(_Symbol, tf, il);
      if(H > L)
        {
         double pos = (c1 - L) / (H - L);
         s.f[4] = (pos >= 0.66) ? 1 : (pos <= 0.33 ? -1 : 0);
        }
     }
//--- 6. Asia range breakout
   if(g_asiaOk)
      s.f[5] = (bid > g_asiaHi) ? 1 : (bid < g_asiaLo ? -1 : 0);

   s.total = 0;
   for(int i = 0; i < 6; i++)
      s.total += s.f[i];

   s.atr  = atr;
   s.news = NewsBlock();
   double risk = atr * PRESET_ATR[p];
   if(s.total >= InpMinScore)
     {
      s.entry = ask;
      s.sl  = ask - risk;
      s.tp1 = ask + risk * InpRR1;
      s.tp2 = ask + risk * InpRR2;
     }
   else
      if(s.total <= -InpMinScore)
        {
         s.entry = bid;
         s.sl  = bid + risk;
         s.tp1 = bid - risk * InpRR1;
         s.tp2 = bid - risk * InpRR2;
        }
   s.ready = true;
   g_sc = s;
  }

bool HasSignal()
  {
   return (g_sc.ready && !g_sc.news && MathAbs(g_sc.total) >= InpMinScore);
  }

string ActiveSessions()
  {
   int h = (int)(((long)TimeGMT() % 86400) / 3600);
   string r = "";
   if(InHour(h, InpAsiaStart, InpAsiaEnd))
      r += "Asia ";
   if(InHour(h, InpLondonStart, InpLondonEnd))
      r += "London ";
   if(InHour(h, InpNYStart, InpNYEnd))
      r += "New York ";
   if(InHour(h, InpLondonKZStart, InpLondonKZEnd))
      r += "[London KZ]";
   if(InHour(h, InpNYKZStart, InpNYKZEnd))
      r += "[NY KZ]";
   if(r == "")
      r = "Tiada (pasaran lengang)";
   return r;
  }

//+------------------------------------------------------------------+
//| Lukisan atas chart                                               |
//+------------------------------------------------------------------+
void DrawSessions()
  {
   string nm[3] = {"ASIA", "LONDON", "NEW YORK"};
   int    sH[3];
   int    eH[3];
   color  cl[3] = {C'90,90,200', C'60,170,120', C'210,120,70'};
   sH[0] = InpAsiaStart;
   eH[0] = InpAsiaEnd;
   sH[1] = InpLondonStart;
   eH[1] = InpLondonEnd;
   sH[2] = InpNYStart;
   eH[2] = InpNYEnd;

   datetime now = TimeTradeServer();
   datetime day0 = TodayGMT();
   int drawn = 0;
   for(int d = 0; d < 14 && drawn < InpDaysBack; d++)
     {
      bool any = false;
      for(int s = 0; s < 3; s++)
        {
         datetime t1, t2;
         SessionWindow((datetime)((long)day0 - d * 86400), sH[s], eH[s], t1, t2);
         if(t1 > now)
            continue;
         datetime te = (t2 < now ? t2 : now);
         double hi, lo;
         if(!RangeHL(t1, (datetime)((long)te - 1), hi, lo))
            continue;
         any = true;
         string n = PFX_D + "SES_" + IntegerToString(d) + "_" + IntegerToString(s);
         RectPrice(n, t1, hi, t2, lo, cl[s], false, STYLE_SOLID);
         TextAt(n + "_t", t1, hi, nm[s], cl[s], 7, ANCHOR_LEFT_LOWER);
        }
      if(any)
         drawn++;
     }
  }

void DrawAsiaKZ()
  {
//--- garisan Asia high / low
   if(g_asiaOk)
     {
      datetime tEnd = (datetime)((long)g_asiaT1 + 86400);
      Seg(PFX_D + "AKZ_HI", g_asiaT1, tEnd, g_asiaHi, C_GOLD, STYLE_DASH);
      Seg(PFX_D + "AKZ_LO", g_asiaT1, tEnd, g_asiaLo, C_GOLD, STYLE_DASH);
      TextAt(PFX_D + "AKZ_HIt", g_asiaT1, g_asiaHi, "ASIA HIGH " + Px(g_asiaHi), C_GOLD, 7, ANCHOR_LEFT_LOWER);
      TextAt(PFX_D + "AKZ_LOt", g_asiaT1, g_asiaLo, "ASIA LOW " + Px(g_asiaLo), C_GOLD, 7, ANCHOR_LEFT_UPPER);
     }

//--- killzone
   string nm[2] = {"LONDON KZ", "NY KZ"};
   int sH[2];
   int eH[2];
   sH[0] = InpLondonKZStart;
   eH[0] = InpLondonKZEnd;
   sH[1] = InpNYKZStart;
   eH[1] = InpNYKZEnd;

   datetime now = TimeTradeServer();
   datetime day0 = TodayGMT();
   int drawn = 0;
   for(int d = 0; d < 14 && drawn < InpDaysBack; d++)
     {
      bool any = false;
      for(int k = 0; k < 2; k++)
        {
         datetime t1, t2;
         SessionWindow((datetime)((long)day0 - d * 86400), sH[k], eH[k], t1, t2);
         if(t1 > now)
            continue;
         datetime te = (t2 < now ? t2 : now);
         double hi, lo;
         if(!RangeHL(t1, (datetime)((long)te - 1), hi, lo))
            continue;
         any = true;
         string n = PFX_D + "AKZ_" + IntegerToString(d) + "_" + IntegerToString(k);
         RectPrice(n, t1, hi, t2, lo, C_KZ, true, STYLE_SOLID);
         TextAt(n + "_t", t1, lo, nm[k], C'170,130,220', 7, ANCHOR_LEFT_UPPER);
        }
      if(any)
         drawn++;
     }
  }

void DrawHTF()
  {
   int ps = PeriodSeconds(InpHTF);
   if(PeriodSeconds((ENUM_TIMEFRAMES)_Period) >= ps)
     {
      ObjectsDeleteAll(0, PFX_D + "HTF_");
      return;
     }
   for(int i = 0; i < InpHTFCount; i++)
     {
      datetime t = iTime(_Symbol, InpHTF, i);
      if(t == 0)
         break;
      double o = iOpen(_Symbol, InpHTF, i);
      double h = iHigh(_Symbol, InpHTF, i);
      double l = iLow(_Symbol, InpHTF, i);
      double c = iClose(_Symbol, InpHTF, i);
      color col = (c >= o) ? C'60,170,110' : C'200,80,80';
      datetime t2 = (datetime)((long)t + ps);
      string n = PFX_D + "HTF_" + IntegerToString(i);
      RectPrice(n + "w", t, h, t2, l, col, false, STYLE_DOT);
      RectPrice(n + "b", t, MathMax(o, c), t2, MathMin(o, c), col, false, STYLE_SOLID);
      if(i == 0)
         TextAt(n + "t", t, h, "Candle " + TFName(InpHTF), C_TXT, 7, ANCHOR_LEFT_LOWER);
     }
  }

void DrawNews()
  {
   ObjectsDeleteAll(0, PFX_D + "NEWS_");
   double pmax = ChartGetDouble(0, CHART_PRICE_MAX);
   for(int i = 0; i < ArraySize(g_newsT); i++)
     {
      string n = PFX_D + "NEWS_" + IntegerToString(i);
      VLine(n, g_newsT[i], C_GOLD);
      TextAt(n + "t", g_newsT[i], pmax, " " + g_newsN[i], C_GOLD, 7, ANCHOR_LEFT_UPPER);
     }
  }

void DrawPlan()
  {
   if(!g_tog[5] || !HasSignal())
     {
      ObjectsDeleteAll(0, PFX_D + "PLAN_");
      return;
     }
   datetime t1 = iTime(_Symbol, _Period, 0);
   datetime t2 = (datetime)((long)t1 + PeriodSeconds() * 25);
   string nm[4] = {"ENTRY", "SL", "TP1", "TP2"};
   double pr[4];
   color  cl[4] = {clrWhite, C_DN, C_UP, C_UP};
   pr[0] = g_sc.entry;
   pr[1] = g_sc.sl;
   pr[2] = g_sc.tp1;
   pr[3] = g_sc.tp2;
   for(int i = 0; i < 4; i++)
     {
      string n = PFX_D + "PLAN_" + IntegerToString(i);
      Seg(n, t1, t2, pr[i], cl[i], (i == 0 ? STYLE_SOLID : STYLE_DASH), (i == 0 ? 2 : 1));
      TextAt(n + "t", t2, pr[i], " " + nm[i] + " " + Px(pr[i]), cl[i], 8, ANCHOR_LEFT);
     }
  }

void RedrawChart()
  {
   MqlDateTime dt;
   TimeToStruct(TimeTradeServer(), dt);
   if(dt.day_of_year != g_lastDoy)
     {
      ObjectsDeleteAll(0, PFX_D);
      g_lastDoy = dt.day_of_year;
     }
   if(g_tog[0])
      DrawSessions();
   else
      ObjectsDeleteAll(0, PFX_D + "SES_");
   if(g_tog[1])
      DrawAsiaKZ();
   else
      ObjectsDeleteAll(0, PFX_D + "AKZ_");
   if(g_tog[2])
      DrawHTF();
   else
      ObjectsDeleteAll(0, PFX_D + "HTF_");
   if(g_tog[3])
      DrawNews();
   else
      ObjectsDeleteAll(0, PFX_D + "NEWS_");
   DrawPlan();
   g_lastDraw = TimeTradeServer();
  }

void UpdateTimerLabel()
  {
   if(!g_tog[4])
     {
      if(ObjectFind(0, TMR_OBJ) >= 0)
         ObjectDelete(0, TMR_OBJ);
      return;
     }
   datetime t = (datetime)((long)iTime(_Symbol, _Period, 0) + PeriodSeconds() * 2);
   double p = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   string txt = "<  " + TFName((ENUM_TIMEFRAMES)_Period) + " " + Countdown((ENUM_TIMEFRAMES)_Period) +
                "   |   " + TFName(InpHTF) + " " + Countdown(InpHTF);
   TextAt(TMR_OBJ, t, p, txt, C_TXT, 8, ANCHOR_LEFT);
  }

//+------------------------------------------------------------------+
//| Bina panel                                                       |
//+------------------------------------------------------------------+
void BuildSignalTab(int cx, int cy, int cw)
  {
   PLabel(PFX_C + "h", cx, cy, "OMNISCORE LIVE", C_ACC, 9, "Segoe UI Semibold");
   PLabel(PFX_C + "pr", cx + cw, cy + 2, PRESET_NAME[g_preset] + "  " + TFName(PRESET_TF[g_preset]),
          C_DIM, 8, "Segoe UI", ANCHOR_RIGHT_UPPER);
   PLabel(PFX_C + "dir", cx, cy + 18, "MEMUAT DATA...", C_DIM, 15, "Segoe UI Black");
   PLabel(PFX_C + "scr", cx + cw, cy + 22, "", clrWhite, 12, "Segoe UI Semibold", ANCHOR_RIGHT_UPPER);
   PRect(PFX_C + "barbg", cx, cy + 50, cw, 8, C_BOX, C_BOX);
   PRect(PFX_C + "bar", cx, cy + 50, 1, 8, C_BOX, C_BOX);
   for(int i = 0; i < 6; i++)
     {
      PLabel(PFX_C + "fn" + IntegerToString(i), cx, cy + 66 + i * 18, FACTOR[i], C_TXT, 8);
      PLabel(PFX_C + "fv" + IntegerToString(i), cx + cw, cy + 66 + i * 18, "-", C_DIM, 8,
             "Segoe UI Semibold", ANCHOR_RIGHT_UPPER);
     }
   int py = cy + 66 + 6 * 18 + 6;
   PRect(PFX_C + "sep", cx, py, cw, 1, C_BORDER, C_BORDER);
   string pl[4] = {"ENTRY", "STOP LOSS", "TP1", "TP2"};
   for(int i = 0; i < 4; i++)
     {
      PLabel(PFX_C + "pn" + IntegerToString(i), cx, py + 8 + i * 18, pl[i], C_DIM, 8);
      PLabel(PFX_C + "pv" + IntegerToString(i), cx + cw, py + 8 + i * 18, "-", clrWhite, 9,
             "Segoe UI Semibold", ANCHOR_RIGHT_UPPER);
     }
   PLabel(PFX_C + "note", cx, py + 84, "Analisa sahaja, bukan jaminan. Test di akaun demo dulu.", C_DIM, 7);
  }

void BuildIndiTab(int cx, int cy, int cw)
  {
   PLabel(PFX_C + "h1", cx, cy, "GAYA TRADING", C_DIM, 8, "Segoe UI Semibold");
   int pw = (cw - 8) / 3;
   for(int i = 0; i < 3; i++)
     {
      bool on = (i == g_preset);
      PButton(PFX_C + "pre" + IntegerToString(i), cx + i * (pw + 4), cy + 16, pw, 26,
              PRESET_NAME[i] + " " + TFName(PRESET_TF[i]), on ? C_ACC : C_BOX, on ? clrWhite : C_TXT, 8);
     }
   PLabel(PFX_C + "h2", cx, cy + 56, "PAPARAN CHART", C_DIM, 8, "Segoe UI Semibold");
   int tw = (cw - 6) / 2;
   for(int i = 0; i < 6; i++)
     {
      int col = i % 2, row = i / 2;
      PButton(PFX_C + "tog" + IntegerToString(i), cx + col * (tw + 6), cy + 72 + row * 32, tw, 28,
              TOG_NAME[i], g_tog[i] ? C_ON : C_BOX, g_tog[i] ? C_ONTXT : C_TXT, 8);
     }
   PLabel(PFX_C + "cnt", cx, cy + 176, "", C_DIM, 8);
   PButton(PFX_C + "all", cx, cy + 198, tw, 26, "SEMUA ON", C_BOX, C_TXT, 8);
   PButton(PFX_C + "rst", cx + tw + 6, cy + 198, tw, 26, "RESET", C_BOX, C_TXT, 8);
   PLabel(PFX_C + "sv", cx, cy + 234, "Tetapan disimpan automatik untuk simbol ini.", C_DIM, 7);
  }

void BuildMarketTab(int cx, int cy, int cw)
  {
   string mk[10];
   mk[0] = "Bid / Ask";
   mk[1] = "Spread";
   mk[2] = "Range hari ini";
   mk[3] = "ATR(14) " + TFName(PRESET_TF[g_preset]);
   mk[4] = "Volatiliti";
   mk[5] = "Sesi aktif";
   mk[6] = "Asia High";
   mk[7] = "Asia Low";
   mk[8] = "Masa server";
   mk[9] = "Candle " + TFName(InpHTF) + " tutup dalam";
   for(int i = 0; i < 10; i++)
     {
      PLabel(PFX_C + "mn" + IntegerToString(i), cx, cy + i * 22, mk[i], C_DIM, 8);
      PLabel(PFX_C + "mv" + IntegerToString(i), cx + cw, cy + i * 22, "-", clrWhite, 9,
             "Segoe UI Semibold", ANCHOR_RIGHT_UPPER);
     }
  }

void BuildInfoTab(int cx, int cy)
  {
   int off = ServerOffset();
   string ln[13];
   ln[0]  = "CARA GUNA";
   ln[1]  = "1. Pilih gaya trading dalam tab INDIKATOR.";
   ln[2]  = "2. Signal keluar bila skor >= " + IntegerToString(InpMinScore) + "/6 sama arah.";
   ln[3]  = "3. Signal ditahan " + IntegerToString(InpNewsBlockMin) + " minit sebelum/selepas news besar.";
   ln[4]  = "4. SL ikut ATR, TP1 = " + DoubleToString(InpRR1, 1) + "R, TP2 = " + DoubleToString(InpRR2, 1) + "R.";
   ln[5]  = "5. Risiko maksimum 1-2% akaun setiap trade.";
   ln[6]  = "";
   ln[7]  = StringFormat("Sesi (GMT): Asia %02d-%02d  London %02d-%02d  NY %02d-%02d",
                         InpAsiaStart, InpAsiaEnd, InpLondonStart, InpLondonEnd, InpNYStart, InpNYEnd);
   ln[8]  = "Offset server: GMT" + (off >= 0 ? "+" : "") + IntegerToString(off) +
            (InpGMTOffset == 99 ? " (auto)" : " (manual)");
   ln[9]  = "";
   ln[10] = "AMARAN";
   ln[11] = "Panel ni analisa sahaja dan TIDAK buka trade.";
   ln[12] = "Trading emas berisiko tinggi. Bukan nasihat kewangan.";
   for(int i = 0; i < 13; i++)
     {
      bool head = (i == 0 || i == 10);
      PLabel(PFX_C + "i" + IntegerToString(i), cx, cy + i * 19, ln[i], head ? C_ACC : C_TXT, 8,
             head ? "Segoe UI Semibold" : "Segoe UI");
     }
  }

void BuildPanel()
  {
   ObjectsDeleteAll(0, PFX_P);
   ObjectsDeleteAll(0, PFX_C);
   int x = InpPanelX, y = InpPanelY;

   PRect(PFX_P + "bg", x, y, PANEL_W, g_min ? 46 : PANEL_H, C_BG, C_BORDER);
   PRect(PFX_P + "hd", x, y, PANEL_W, 46, C_HEAD, C_BORDER);
   PLabel(PFX_P + "ttl", x + 14, y + 4, InpPanelName, clrWhite, 14, "Segoe UI Black");
   PLabel(PFX_P + "sub", x + 14, y + 29, _Symbol + "  |  Sesi  Killzone  HTF  News  OmniScore", C_DIM, 7);
   PLabel(PFX_P + "st", x + PANEL_W - 40, y + 16, S_DOT + " ONLINE", C_ON, 8, "Segoe UI Semibold", ANCHOR_RIGHT_UPPER);
   PButton(PFX_P + "min", x + PANEL_W - 32, y + 12, 22, 22, g_min ? "+" : "_", C_BOX, clrWhite, 9);
   if(g_min)
     {
      UpdatePanel();
      ChartRedraw();
      return;
     }

//--- baris akaun
   string cap[3] = {"EQUITY", "FLOATING", "MARGIN LVL"};
   int bw = (PANEL_W - 20 - 8) / 3;
   for(int i = 0; i < 3; i++)
     {
      int bx = x + 10 + i * (bw + 4);
      string s = IntegerToString(i);
      PRect(PFX_P + "ab" + s, bx, y + 54, bw, 38, C_BOX, C_BOX);
      PLabel(PFX_P + "ac" + s, bx + 8, y + 57, cap[i], C_DIM, 7);
      PLabel(PFX_P + "av" + s, bx + 8, y + 71, "-", clrWhite, 10, "Segoe UI Semibold");
     }

//--- ticker news
   PRect(PFX_P + "nb", x + 10, y + 98, PANEL_W - 20, 20, C_BOX, C_BOX);
   PLabel(PFX_P + "nt", x + 16, y + 101, "NEWS", C_GOLD, 8);

//--- tab
   int tw = (PANEL_W - 20 - 6) / 4;
   for(int i = 0; i < 4; i++)
     {
      bool on = (i == g_tab);
      PButton(PFX_P + "tab" + IntegerToString(i), x + 10 + i * (tw + 2), y + 124, tw, 24, TABS[i],
              on ? C_ACC : C_BOX, on ? clrWhite : C_DIM, 8);
     }

//--- kandungan tab
   int cx = x + 12, cy = y + 158, cw = PANEL_W - 24;
   if(g_tab == 0)
      BuildSignalTab(cx, cy, cw);
   else
      if(g_tab == 1)
         BuildIndiTab(cx, cy, cw);
      else
         if(g_tab == 2)
            BuildMarketTab(cx, cy, cw);
         else
            BuildInfoTab(cx, cy);

   UpdatePanel();
   ChartRedraw();
  }

//+------------------------------------------------------------------+
//| Kemaskini nilai panel                                            |
//+------------------------------------------------------------------+
void UpdSignal()
  {
   int cw = PANEL_W - 24;
   if(!g_sc.ready)
     {
      SetTxt(PFX_C + "dir", "MEMUAT DATA...", C_DIM);
      return;
     }
   string d;
   color dc;
   if(g_sc.news)
     {
      d = "TUNGGU - NEWS";
      dc = C_GOLD;
     }
   else
      if(g_sc.total >= InpMinScore)
        {
         d = S_UP + " BELI";
         dc = C_UP;
        }
      else
         if(g_sc.total <= -InpMinScore)
           {
            d = S_DN + " JUAL";
            dc = C_DN;
           }
         else
           {
            d = S_SQ + " TUNGGU";
            dc = C_DIM;
           }
   SetTxt(PFX_C + "dir", d, dc);
   SetTxt(PFX_C + "scr", StringFormat("%+d / 6", g_sc.total), dc);

   int w = (int)MathRound(cw * MathAbs(g_sc.total) / 6.0);
   if(ObjectFind(0, PFX_C + "bar") >= 0)
     {
      ObjectSetInteger(0, PFX_C + "bar", OBJPROP_XSIZE, MathMax(w, 1));
      color bc = (w > 0 ? dc : C_BOX);
      ObjectSetInteger(0, PFX_C + "bar", OBJPROP_BGCOLOR, bc);
      ObjectSetInteger(0, PFX_C + "bar", OBJPROP_COLOR, bc);
     }

   for(int i = 0; i < 6; i++)
     {
      int v = g_sc.f[i];
      string t = (v > 0) ? S_UP + " Bullish" : (v < 0 ? S_DN + " Bearish" : S_SQ + " Neutral");
      color c = (v > 0) ? C_UP : (v < 0 ? C_DN : C_DIM);
      SetTxt(PFX_C + "fv" + IntegerToString(i), t, c);
     }

   if(HasSignal())
     {
      SetTxt(PFX_C + "pv0", Px(g_sc.entry), clrWhite);
      SetTxt(PFX_C + "pv1", Px(g_sc.sl) + "  (" + IntegerToString(Pts(g_sc.entry - g_sc.sl)) + " pts)", C_DN);
      SetTxt(PFX_C + "pv2", Px(g_sc.tp1) + "  (" + IntegerToString(Pts(g_sc.tp1 - g_sc.entry)) + " pts)", C_UP);
      SetTxt(PFX_C + "pv3", Px(g_sc.tp2) + "  (" + IntegerToString(Pts(g_sc.tp2 - g_sc.entry)) + " pts)", C_UP);
     }
   else
      for(int i = 0; i < 4; i++)
         SetTxt(PFX_C + "pv" + IntegerToString(i), "-", C_DIM);
  }

void UpdIndi()
  {
   int n = 0;
   for(int i = 0; i < 6; i++)
      if(g_tog[i])
         n++;
   SetTxt(PFX_C + "cnt", IntegerToString(n) + " paparan aktif");
  }

void UpdMarket()
  {
   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   SetTxt(PFX_C + "mv0", Px(bid) + " / " + Px(ask));
   SetTxt(PFX_C + "mv1", IntegerToString(SymbolInfoInteger(_Symbol, SYMBOL_SPREAD)) + " pts");

   double dh = iHigh(_Symbol, PERIOD_D1, 0), dl = iLow(_Symbol, PERIOD_D1, 0);
   if(dh > 0 && dl > 0)
      SetTxt(PFX_C + "mv2", DoubleToString(dh - dl, _Digits) + "  (" + IntegerToString(Pts(dh - dl)) + " pts)");

   double a[];
   if(CopyBuffer(hATR[g_preset], 0, 1, 50, a) == 50)
     {
      double avg = 0;
      for(int i = 0; i < 50; i++)
         avg += a[i];
      avg /= 50.0;
      double now = a[49];
      SetTxt(PFX_C + "mv3", DoubleToString(now, _Digits));
      double r = (avg > 0 ? now / avg : 1.0);
      if(r > 1.3)
         SetTxt(PFX_C + "mv4", "TINGGI (" + DoubleToString(r, 2) + "x)", C_DN);
      else
         if(r < 0.7)
            SetTxt(PFX_C + "mv4", "RENDAH (" + DoubleToString(r, 2) + "x)", C_DIM);
         else
            SetTxt(PFX_C + "mv4", "NORMAL (" + DoubleToString(r, 2) + "x)", C_UP);
     }

   SetTxt(PFX_C + "mv5", ActiveSessions());
   SetTxt(PFX_C + "mv6", g_asiaOk ? Px(g_asiaHi) : "-");
   SetTxt(PFX_C + "mv7", g_asiaOk ? Px(g_asiaLo) : "-");
   int off = ServerOffset();
   SetTxt(PFX_C + "mv8", TimeToString(TimeTradeServer(), TIME_MINUTES | TIME_SECONDS) +
          "  (GMT" + (off >= 0 ? "+" : "") + IntegerToString(off) + ")");
   SetTxt(PFX_C + "mv9", Countdown(InpHTF));
  }

void UpdatePanel()
  {
   bool live = ((long)TimeTradeServer() - (long)TimeCurrent() < 180);
   SetTxt(PFX_P + "st", S_DOT + (live ? " ONLINE" : " MARKET TUTUP"), live ? C_ON : C_DN);
   if(g_min)
      return;

   SetTxt(PFX_P + "av0", Money(AccountInfoDouble(ACCOUNT_EQUITY)));
   double fl = AccountInfoDouble(ACCOUNT_PROFIT);
   SetTxt(PFX_P + "av1", Money(fl), fl > 0 ? C_UP : (fl < 0 ? C_DN : clrWhite));
   double ml = AccountInfoDouble(ACCOUNT_MARGIN_LEVEL);
   SetTxt(PFX_P + "av2", ml > 0 ? DoubleToString(ml, 0) + "%" : "-");
   SetTxt(PFX_P + "nt", NewsTicker());

   if(g_tab == 0)
      UpdSignal();
   else
      if(g_tab == 1)
         UpdIndi();
      else
         if(g_tab == 2)
            UpdMarket();
  }

//+------------------------------------------------------------------+
//| Event                                                            |
//+------------------------------------------------------------------+
int OnInit()
  {
   S_UP  = ShortToString(0x25B2);
   S_DN  = ShortToString(0x25BC);
   S_SQ  = ShortToString(0x25A0);
   S_DOT = ShortToString(0x25CF);
   FACTOR[0]   = "Trend " + TFName(InpHTF) + " (EMA50)";
   TOG_NAME[2] = "HTF Candles (" + TFName(InpHTF) + ")";

   for(int i = 0; i < 3; i++)
     {
      hEMA20[i] = iMA(_Symbol, PRESET_TF[i], 20, 0, MODE_EMA, PRICE_CLOSE);
      hEMA50[i] = iMA(_Symbol, PRESET_TF[i], 50, 0, MODE_EMA, PRICE_CLOSE);
      hRSI[i]   = iRSI(_Symbol, PRESET_TF[i], 14, PRICE_CLOSE);
      hMACD[i]  = iMACD(_Symbol, PRESET_TF[i], 12, 26, 9, PRICE_CLOSE);
      hATR[i]   = iATR(_Symbol, PRESET_TF[i], 14);
      if(hEMA20[i] == INVALID_HANDLE || hEMA50[i] == INVALID_HANDLE || hRSI[i] == INVALID_HANDLE ||
         hMACD[i] == INVALID_HANDLE || hATR[i] == INVALID_HANDLE)
        {
         Print("GoldPanel: gagal cipta indicator, error ", GetLastError());
         return INIT_FAILED;
        }
     }
   hHTFema = iMA(_Symbol, InpHTF, 50, 0, MODE_EMA, PRICE_CLOSE);
   if(hHTFema == INVALID_HANDLE)
      return INIT_FAILED;

   ChartSetInteger(0, CHART_FOREGROUND, false);
   LoadLayout();
   LoadNews();
   g_newsLoaded = TimeTradeServer();
   ComputeAsia();
   ComputeScore();
   BuildPanel();
   RedrawChart();
   EventSetTimer(1);
   return INIT_SUCCEEDED;
  }

void OnDeinit(const int reason)
  {
   EventKillTimer();
   ObjectsDeleteAll(0, PFX);
   for(int i = 0; i < 3; i++)
     {
      IndicatorRelease(hEMA20[i]);
      IndicatorRelease(hEMA50[i]);
      IndicatorRelease(hRSI[i]);
      IndicatorRelease(hMACD[i]);
      IndicatorRelease(hATR[i]);
     }
   IndicatorRelease(hHTFema);
   ChartRedraw();
  }

int OnCalculate(const int rates_total,
                const int prev_calculated,
                const datetime &time[],
                const double &open[],
                const double &high[],
                const double &low[],
                const double &close[],
                const long &tick_volume[],
                const long &volume[],
                const int &spread[])
  {
   return rates_total;
  }

void OnTimer()
  {
   datetime now = TimeTradeServer();
   if((long)now - (long)g_newsLoaded > 300)
     {
      LoadNews();
      g_newsLoaded = now;
     }
   bool redraw = ((long)now - (long)g_lastDraw >= 15);
   if(redraw)
      ComputeAsia();
   ComputeScore();
   if(redraw)
      RedrawChart();
   UpdatePanel();
   UpdateTimerLabel();
   ChartRedraw();
  }

void OnChartEvent(const int id, const long &lparam, const double &dparam, const string &sparam)
  {
   if(id != CHARTEVENT_OBJECT_CLICK)
      return;
   if(StringFind(sparam, PFX) != 0)
      return;
   ObjectSetInteger(0, sparam, OBJPROP_STATE, false);

   if(sparam == PFX_P + "min")
     {
      g_min = !g_min;
      SaveLayout();
      BuildPanel();
      return;
     }
   for(int i = 0; i < 4; i++)
      if(sparam == PFX_P + "tab" + IntegerToString(i))
        {
         g_tab = i;
         SaveLayout();
         BuildPanel();
         return;
        }
   for(int i = 0; i < 3; i++)
      if(sparam == PFX_C + "pre" + IntegerToString(i))
        {
         g_preset = i;
         SaveLayout();
         ComputeScore();
         BuildPanel();
         RedrawChart();
         ChartRedraw();
         return;
        }
   for(int i = 0; i < 6; i++)
      if(sparam == PFX_C + "tog" + IntegerToString(i))
        {
         g_tog[i] = !g_tog[i];
         SaveLayout();
         BuildPanel();
         RedrawChart();
         UpdateTimerLabel();
         ChartRedraw();
         return;
        }
   if(sparam == PFX_C + "all" || sparam == PFX_C + "rst")
     {
      if(sparam == PFX_C + "all")
        {
         for(int i = 0; i < 6; i++)
            g_tog[i] = true;
        }
      else
        {
         int keepTab = g_tab;
         DefaultLayout();
         g_tab = keepTab;
        }
      SaveLayout();
      ComputeScore();
      BuildPanel();
      RedrawChart();
      UpdateTimerLabel();
      ChartRedraw();
     }
  }
//+------------------------------------------------------------------+
