#ifndef KLINE_TRAINING_BRIDGE_MQH
#define KLINE_TRAINING_BRIDGE_MQH
input bool InpKLineConnection = true;
bool KLC_ready = false;
bool KLC_retryInit = false;
uint KLC_lastPoll = 0;
uint KLC_lastInit = 0;

input string InpBridgeUrl = "http://127.0.0.1/mt4/terminal";
input string InpPairToken = "";
input bool InpAllowReal = false;
input int InpPollSeconds = 1;

#define KLC_BRIDGE_MAGIC KLC_GetPanelMagic()
struct KLC_Receipt { string id; string status; int ticket; string error; bool acknowledged; };
KLC_Receipt KLC_receipts[];
int KLC_journal = INVALID_HANDLE;
string KLC_sessionId, KLC_selectedSymbol;
int KLC_selectedTimeframe = PERIOD_M5;
bool KLC_working = false;
int KLC_lastHttpError = 0;
long KLC_serverOffset = 0;
datetime KLC_observedServerTime = 0;
bool KLC_timeReady = false;
bool KLC_connectionRetryable = false;
string KLC_connectionError = "";
string KLC_archiveResult = "";
uint KLC_lastFullPoll = 0, KLC_lastTransportPoll = 0;
int KLC_fastPollMs = 0, KLC_failedPolls = 0;

string KLC_J(string value) {
  StringReplace(value, "\\", "\\\\"); StringReplace(value, "\"", "\\\"");
  StringReplace(value, "\r", " "); StringReplace(value, "\n", " "); StringReplace(value, "\t", " ");
  return "\"" + value + "\"";
}
string KLC_N(double value, int precision = 8) { return DoubleToString(value, precision); }
string KLC_B(bool value) { return value ? "true" : "false"; }
string KLC_Mode() {
  long mode = AccountInfoInteger(ACCOUNT_TRADE_MODE);
  if(mode == ACCOUNT_TRADE_MODE_DEMO) return "demo";
  if(mode == ACCOUNT_TRADE_MODE_REAL) return "real";
  return "contest";
}
string KLC_Hex(string value) {
  uchar data[]; int length = StringToCharArray(value, data, 0, WHOLE_ARRAY, CP_UTF8);
  string result = "";
  for(int i = 0; i < length - 1; i++) result += StringFormat("%02x", data[i]);
  return result;
}
bool KLC_SafeSymbol(string value) {
  if(StringLen(value) < 1 || StringLen(value) > 80) return false;
  for(int i = 0; i < StringLen(value); i++) {
    ushort c = StringGetCharacter(value, i);
    if(c < 32 || c > 126 || c == 124 || c == 34 || c == 92) return false;
  }
  return true;
}
bool KLC_SafeId(string value) {
  if(StringLen(value) != 36) return false;
  for(int i = 0; i < 36; i++) {
    ushort c = StringGetCharacter(value, i);
    if(i == 8 || i == 13 || i == 18 || i == 23) { if(c != 45) return false; }
    else if(!((c >= 48 && c <= 57) || (c >= 97 && c <= 102))) return false;
  }
  return true;
}
bool KLC_ValidUrl() {
  if(InpBridgeUrl == "http://127.0.0.1/mt4/terminal" || InpBridgeUrl == "http://localhost/mt4/terminal") return true;
  string hostPrefix = "http://127.0.0.1:";
  if(StringFind(InpBridgeUrl, hostPrefix) != 0) hostPrefix = "http://localhost:";
  if(StringFind(InpBridgeUrl, hostPrefix) != 0) return false;
  int slash = StringFind(InpBridgeUrl, "/", StringLen(hostPrefix));
  if(slash < 0 || StringSubstr(InpBridgeUrl, slash) != "/mt4/terminal") return false;
  string port = StringSubstr(InpBridgeUrl, StringLen(hostPrefix), slash - StringLen(hostPrefix));
  if(StringLen(port) < 1 || StringLen(port) > 5) return false;
  for(int i = 0; i < StringLen(port); i++) if(StringGetCharacter(port, i) < 48 || StringGetCharacter(port, i) > 57) return false;
  return StringToInteger(port) > 0 && StringToInteger(port) <= 65535;
}
string KLC_RequestUrl() {
  // Preserve existing .set files while using the standard HTTP port accepted by MT4 WebRequest.
  if(StringFind(InpBridgeUrl, "http://localhost") == 0) return "http://localhost/mt4/terminal";
  return "http://127.0.0.1/mt4/terminal";
}
bool KLC_TradePermission() {
  return IsConnected() && IsExpertEnabled() && (bool)MQLInfoInteger(MQL_TRADE_ALLOWED) &&
    (bool)AccountInfoInteger(ACCOUNT_TRADE_ALLOWED) && (bool)AccountInfoInteger(ACCOUNT_TRADE_EXPERT);
}
long KLC_Utc(datetime serverTime) {
  if(serverTime == 0 || !KLC_timeReady) return 0;
  return (long)serverTime - KLC_serverOffset;
}
int KLC_FindReceipt(string id) {
  for(int i = 0; i < ArraySize(KLC_receipts); i++) if(KLC_receipts[i].id == id) return i;
  return -1;
}
bool KLC_SaveReceipt(string id, string status, int ticket, string error) {
  if(KLC_journal == INVALID_HANDLE) return false;
  ResetLastError(); FileSeek(KLC_journal, 0, SEEK_END);
  uint bytes = FileWrite(KLC_journal, id, status, ticket, error);
  FileFlush(KLC_journal);
  if(bytes == 0 || GetLastError() != 0) { Print("KLine connection: local receipt storage failed; trading stopped."); return false; }
  int index = KLC_FindReceipt(id);
  if(index < 0) { index = ArraySize(KLC_receipts); ArrayResize(KLC_receipts, index + 1); }
  KLC_receipts[index].id = id; KLC_receipts[index].status = status; KLC_receipts[index].ticket = ticket;
  KLC_receipts[index].error = error; KLC_receipts[index].acknowledged = false;
  return true;
}
bool KLC_LoadJournal() {
  // Holding an exclusive FILE_COMMON handle prevents a second EA instance from trading with this pairing.
  KLC_journal = FileOpen("KLineTradeBridge-" + InpPairToken + ".csv", FILE_COMMON | FILE_READ | FILE_WRITE | FILE_CSV | FILE_ANSI, '\t', CP_UTF8);
  KLC_connectionRetryable = KLC_journal == INVALID_HANDLE;
  if(KLC_journal == INVALID_HANDLE) return false;
  while(!FileIsEnding(KLC_journal)) {
    string id = FileReadString(KLC_journal);
    if(StringLen(id) == 0 && FileIsEnding(KLC_journal)) break;
    string status = FileReadString(KLC_journal); int ticket = (int)FileReadNumber(KLC_journal); string error = FileReadString(KLC_journal);
    if(!KLC_SafeId(id) || (status != "unknown" && status != "succeeded" && status != "failed")) return false;
    int index = KLC_FindReceipt(id);
    if(index < 0) { index = ArraySize(KLC_receipts); ArrayResize(KLC_receipts, index + 1); }
    KLC_receipts[index].id = id; KLC_receipts[index].status = status; KLC_receipts[index].ticket = ticket;
    KLC_receipts[index].error = error; KLC_receipts[index].acknowledged = false;
  }
  return true;
}
int KLC_InitFailure(string message, int code) {
  if(KLC_connectionError != message) Print("KLine connection: ", message);
  KLC_connectionError = message;
  return code;
}
bool KLC_EnsureSelected(string s) {
  // Avoid sending redundant Market Watch changes to the terminal UI thread.
  if((bool)SymbolInfoInteger(s, SYMBOL_SELECT)) return true;
  return SymbolSelect(s, true);
}
int KLC_FindSymbolName(string &names[], string s) {
  for(int i = 0; i < ArraySize(names); i++) if(names[i] == s) return i;
  return -1;
}
void KLC_AddSymbolName(string &names[], string s) {
  if(!KLC_SafeSymbol(s) || KLC_FindSymbolName(names, s) >= 0 || ArraySize(names) >= 300) return;
  int count = ArraySize(names); ArrayResize(names, count + 1); names[count] = s;
}
string KLC_SymbolJson(string s) {
  if(!KLC_EnsureSelected(s) || MarketInfo(s, MODE_POINT) <= 0) return "";
  return "{\"symbol\":" + KLC_J(s) + ",\"digits\":" + KLC_N(MarketInfo(s, MODE_DIGITS), 0) +
      ",\"point\":" + KLC_N(MarketInfo(s, MODE_POINT), 10) + ",\"bid\":" + KLC_N(MarketInfo(s, MODE_BID), 10) +
      ",\"ask\":" + KLC_N(MarketInfo(s, MODE_ASK), 10) + ",\"quoteTime\":" + IntegerToString(KLC_Utc((datetime)MarketInfo(s, MODE_TIME))) +
      ",\"minLot\":" + KLC_N(MarketInfo(s, MODE_MINLOT)) + ",\"maxLot\":" + KLC_N(MarketInfo(s, MODE_MAXLOT)) +
      ",\"lotStep\":" + KLC_N(MarketInfo(s, MODE_LOTSTEP)) + ",\"contractSize\":" + KLC_N(MarketInfo(s, MODE_LOTSIZE)) +
      ",\"tickValue\":" + KLC_N(MarketInfo(s, MODE_TICKVALUE)) + ",\"tickSize\":" + KLC_N(SymbolInfoDouble(s, SYMBOL_TRADE_TICK_SIZE), 10) +
      ",\"stopLevel\":" + KLC_N(MarketInfo(s, MODE_STOPLEVEL), 0) + ",\"freezeLevel\":" + KLC_N(MarketInfo(s, MODE_FREEZELEVEL), 0) +
      ",\"tradeAllowed\":" + KLC_B(MarketInfo(s, MODE_TRADEALLOWED) > 0) + "}";
}
string KLC_SymbolsJson() {
  static string catalogueNames[], catalogueRows[];
  static string catalogueOwner = "";
  static int catalogueWatchCount = -1;
  static uint catalogueAt = 0;
  string owner = IntegerToString(AccountNumber()) + "|" + AccountServer() + "|" + KLC_Mode();
  string required[]; KLC_AddSymbolName(required, KLC_selectedSymbol);
  for(int i = 0; i < OrdersTotal(); i++) {
    if(OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) KLC_AddSymbolName(required, OrderSymbol());
  }
  uint current = GetTickCount(); int watch = SymbolsTotal(true);
  bool rebuild = catalogueWatchCount != watch || catalogueOwner != owner || (uint)(current - catalogueAt) >= 10000;
  for(int i = 0; i < ArraySize(required); i++) if(KLC_FindSymbolName(catalogueNames, required[i]) < 0) rebuild = true;
  if(rebuild) {
    ArrayResize(catalogueNames, 0);
    for(int i = 0; i < ArraySize(required); i++) KLC_AddSymbolName(catalogueNames, required[i]);
    for(int i = 0; i < watch; i++) KLC_AddSymbolName(catalogueNames, SymbolName(i, true));
    ArrayResize(catalogueRows, ArraySize(catalogueNames));
    catalogueWatchCount = watch; catalogueOwner = owner; catalogueAt = current;
  }
  string result = "";
  for(int i = 0; i < ArraySize(catalogueNames); i++) {
    // Selected/order quotes and execution constraints stay fresh on every heartbeat.
    if(rebuild || KLC_FindSymbolName(required, catalogueNames[i]) >= 0) catalogueRows[i] = KLC_SymbolJson(catalogueNames[i]);
    if(catalogueRows[i] == "") continue;
    if(result != "") result += ","; result += catalogueRows[i];
  }
  return "[" + result + "]";
}
string KLC_HotSymbolsJson() {
  string names[]; KLC_AddSymbolName(names, KLC_selectedSymbol);
  for(int i=0; i<OrdersTotal(); i++) if(OrderSelect(i,SELECT_BY_POS,MODE_TRADES)) KLC_AddSymbolName(names,OrderSymbol());
  string result="";
  for(int i=0;i<ArraySize(names);i++) { string row=KLC_SymbolJson(names[i]); if(row=="")continue; if(result!="")result+=",";result+=row; }
  return "["+result+"]";
}
string KLC_OrderJson() {
  return "{\"ticket\":" + IntegerToString(OrderTicket()) + ",\"symbol\":" + KLC_J(OrderSymbol()) + ",\"type\":" + IntegerToString(OrderType()) +
    ",\"lots\":" + KLC_N(OrderLots()) + ",\"openPrice\":" + KLC_N(OrderOpenPrice(), 10) + ",\"stopLoss\":" + KLC_N(OrderStopLoss(), 10) +
    ",\"takeProfit\":" + KLC_N(OrderTakeProfit(), 10) + ",\"profit\":" + KLC_N(OrderProfit()) + ",\"swap\":" + KLC_N(OrderSwap()) +
    ",\"commission\":" + KLC_N(OrderCommission()) + ",\"openTime\":" + IntegerToString((long)OrderOpenTime()) +
    ",\"closeTime\":" + IntegerToString((long)OrderCloseTime()) + ",\"closePrice\":" + KLC_N(OrderClosePrice(), 10) + ",\"magic\":" + IntegerToString(OrderMagicNumber()) + ",\"comment\":" + KLC_J(OrderComment()) + "}";
}
string KLC_OrdersJson(bool history) {
  int total = history ? OrdersHistoryTotal() : OrdersTotal();
  if(history) {
    static int cachedTotal = -1;
    static string cachedOwner = "", cachedHistory = "[]";
    static uint cachedAt = 0;
    string owner = IntegerToString(AccountNumber()) + "|" + AccountServer() + "|" + KLC_Mode();
    uint current = GetTickCount();
    if(cachedTotal == total && cachedOwner == owner && (uint)(current - cachedAt) < 10000) return cachedHistory;
    int tickets[50]; datetime closed[50]; int found = 0;
    ArrayInitialize(tickets, 0); ArrayInitialize(closed, 0);
    // SELECT_BY_POS does not guarantee chronological ordering. Keep the latest 50 actual trades.
    for(int i = 0; i < total; i++) {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_HISTORY) || OrderType() > OP_SELLSTOP) continue;
      datetime time = OrderCloseTime(); int position = 0;
      while(position < found && (closed[position] > time || (closed[position] == time && tickets[position] > OrderTicket()))) position++;
      if(position >= 50) continue;
      for(int j = MathMin(found, 49); j > position; j--) { tickets[j] = tickets[j - 1]; closed[j] = closed[j - 1]; }
      tickets[position] = OrderTicket(); closed[position] = time; found = MathMin(50, found + 1);
    }
    string recent = "";
    for(int i = 0; i < found; i++) {
      if(!OrderSelect(tickets[i], SELECT_BY_TICKET)) continue;
      if(StringLen(recent) > 0) recent += ","; recent += KLC_OrderJson();
    }
    cachedTotal = total; cachedOwner = owner; cachedAt = current; cachedHistory = "[" + recent + "]";
    return cachedHistory;
  }
  int limit = history ? 50 : 500; string result = ""; int emitted = 0;
  for(int i = total - 1; i >= 0 && emitted < limit; i--) {
    if(!OrderSelect(i, SELECT_BY_POS, history ? MODE_HISTORY : MODE_TRADES) || OrderType() > OP_SELLSTOP) continue;
    if(emitted++ > 0) result += ","; result += KLC_OrderJson();
  }
  return "[" + result + "]";
}
string KLC_BarsJson(int limit = 300) {
  MqlRates rates[]; int count = CopyRates(KLC_selectedSymbol, KLC_selectedTimeframe, 0, limit, rates);
  string result = "";
  for(int i = 0; i < count; i++) {
    if(i > 0) result += ",";
    result += "{\"timestamp\":" + IntegerToString((long)rates[i].time * 1000) + ",\"open\":" + KLC_N(rates[i].open, 10) +
      ",\"high\":" + KLC_N(rates[i].high, 10) + ",\"low\":" + KLC_N(rates[i].low, 10) + ",\"close\":" + KLC_N(rates[i].close, 10) +
      ",\"volume\":" + IntegerToString(rates[i].tick_volume) + "}";
  }
  return "[" + result + "]";
}
string KLC_ReceiptsJson() {
  string result = ""; int emitted = 0;
  for(int i = 0; i < ArraySize(KLC_receipts) && emitted < 20; i++) {
    if(KLC_receipts[i].acknowledged) continue;
    if(emitted++ > 0) result += ",";
    result += "{\"id\":" + KLC_J(KLC_receipts[i].id) + ",\"status\":" + KLC_J(KLC_receipts[i].status) + ",\"ticket\":" + IntegerToString(KLC_receipts[i].ticket) + ",\"error\":" + KLC_J(KLC_receipts[i].error) + "}";
  }
  return "[" + result + "]";
}
string KLC_SnapshotJson(bool full = true) {
  return "{\"protocolVersion\":1,\"executionVersion\":2,\"commandPollVersion\":1,\"marketPollVersion\":1,\"archiveVersion\":1,\"historyTotal\":" + IntegerToString(OrdersHistoryTotal()) + ",\"archiveResponse\":" + (full && KLC_archiveResult != "" ? KLC_archiveResult : "null") + ",\"sessionId\":" + KLC_J(KLC_sessionId) + ",\"capturedAt\":" + IntegerToString((long)TimeGMT()) +
    ",\"serverUtcOffset\":" + (KLC_timeReady ? IntegerToString(KLC_serverOffset) : "null") +
    ",\"account\":{\"login\":" + KLC_J(IntegerToString(AccountNumber())) + ",\"server\":" + KLC_J(AccountServer()) + ",\"mode\":" + KLC_J(KLC_Mode()) +
    ",\"currency\":" + KLC_J(AccountCurrency()) + ",\"balance\":" + KLC_N(AccountBalance()) + ",\"equity\":" + KLC_N(AccountEquity()) +
    ",\"margin\":" + KLC_N(AccountMargin()) + ",\"freeMargin\":" + KLC_N(AccountFreeMargin()) + ",\"profit\":" + KLC_N(AccountProfit()) +
    ",\"connected\":" + KLC_B(IsConnected()) + ",\"tradeAllowed\":" + KLC_B(KLC_TradePermission()) + ",\"allowReal\":" + KLC_B(InpAllowReal) +
    "},\"symbols\":" + (full ? KLC_SymbolsJson() : KLC_HotSymbolsJson()) + ",\"orderCount\":" + IntegerToString(OrdersTotal()) + ",\"orders\":" + KLC_OrdersJson(false) + ",\"history\":" + KLC_OrdersJson(true) +
    ",\"chart\":{\"symbol\":" + KLC_J(KLC_selectedSymbol) + ",\"timeframe\":" + IntegerToString(KLC_selectedTimeframe) + ",\"bars\":" + KLC_BarsJson(full ? 300 : 2) +
    "},\"receipts\":" + KLC_ReceiptsJson() + "}";
}
// Responses contain generated ASCII control fields only. Account/symbol payloads use proper JSON escaping above.
string KLC_JsonString(string source, string key) {
  string prefix = "\"" + key + "\":\""; int start = StringFind(source, prefix);
  if(start < 0) return ""; start += StringLen(prefix); int end = StringFind(source, "\"", start);
  if(end < 0) return ""; return StringSubstr(source, start, end - start);
}
int KLC_JsonInteger(string source,string key) {
  string prefix="\""+key+"\":";int start=StringFind(source,prefix);
  if(start<0)return 0;return (int)StringToInteger(StringSubstr(source,start+StringLen(prefix)));
}
int KLC_JsonTimeframe(string source) {
  string prefix = "\"timeframe\":"; int start = StringFind(source, prefix);
  if(start < 0) return 0; return (int)StringToInteger(StringSubstr(source, start + StringLen(prefix)));
}
string KLC_DecodeArchiveSymbol(string value) {
  string result = "";
  if(StringLen(value) % 2 != 0 || StringLen(value) > 160) return "";
  string digits = "0123456789abcdef";
  for(int i = 0; i < StringLen(value); i += 2) {
    int hi = StringFind(digits, StringSubstr(value, i, 1)); int lo = StringFind(digits, StringSubstr(value, i + 1, 1));
    if(hi < 0 || lo < 0) return "";
    result += ShortToString((ushort)(hi * 16 + lo));
  }
  return KLC_SafeSymbol(result) ? result : "";
}
void KLC_ReadArchive(string wire) {
  KLC_archiveResult = "";
  if(wire == "") return;
  string fields[]; int count = StringSplit(wire, '|', fields);
  if(count < 8 || !KLC_SafeId(fields[0]) || fields[2] != IntegerToString(AccountNumber()) || fields[3] != KLC_Hex(AccountServer()) || fields[4] != KLC_Mode() || fields[5] != KLC_sessionId) return;
  if(fields[1] == "h" && count == 8) {
    int offset = (int)StringToInteger(fields[6]), expected = (int)StringToInteger(fields[7]), total = OrdersHistoryTotal();
    bool ok = offset >= 0 && offset <= total && total == expected;
    int end = MathMin(total, offset + 50); string items = "";
    if(ok) for(int i = offset; i < end; i++) {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_HISTORY)) { ok = false; break; }
      if(OrderType() > OP_SELLSTOP) continue;
      if(items != "") items += ","; items += KLC_OrderJson();
    }
    KLC_archiveResult = "{\"id\":" + KLC_J(fields[0]) + ",\"kind\":\"h\",\"ok\":" + KLC_B(ok) + ",\"offset\":" + IntegerToString(offset) + ",\"next\":" + IntegerToString(end) + ",\"total\":" + IntegerToString(total) + ",\"orders\":[" + items + "]}";
  } else if(fields[1] == "b" && count == 9) {
    string s = KLC_DecodeArchiveSymbol(fields[6]); int tf = (int)StringToInteger(fields[7]); datetime anchor = (datetime)StringToInteger(fields[8]);
    if(!KLC_SafeSymbol(s) || !KLC_ValidTimeframe(tf) || anchor <= 0 || !KLC_EnsureSelected(s)) return;
    MqlRates rates[]; int shift = iBarShift(s, tf, anchor, false);
    int copied = shift < 0 ? -1 : CopyRates(s, tf, MathMax(0, shift - 160), 400, rates);
    bool ok = copied > 0 && rates[0].time <= anchor && rates[copied - 1].time + tf * 60 > anchor;
    string bars = "";
    if(ok) for(int i = 0; i < copied; i++) {
      if(i > 0) bars += ",";
      bars += "{\"timestamp\":" + IntegerToString((long)rates[i].time * 1000) + ",\"open\":" + KLC_N(rates[i].open, 10) + ",\"high\":" + KLC_N(rates[i].high, 10) + ",\"low\":" + KLC_N(rates[i].low, 10) + ",\"close\":" + KLC_N(rates[i].close, 10) + ",\"volume\":" + IntegerToString(rates[i].tick_volume) + "}";
    }
    KLC_archiveResult = "{\"id\":" + KLC_J(fields[0]) + ",\"kind\":\"b\",\"ok\":" + KLC_B(ok) + ",\"bars\":[" + bars + "]}";
  }
}
bool KLC_ValidTimeframe(int value) { return value == 1 || value == 5 || value == 15 || value == 30 || value == 60 || value == 240 || value == 1440 || value == 10080 || value == 43200; }
void KLC_Failure(string id, int ticket, string error) {
  if(!KLC_SaveReceipt(id, "failed", MathMax(0, ticket), error)) KLC_DisableConnection();
}
void KLC_Execute(string wire) {
  if(StringLen(wire) == 0) return;
  string fields[]; int fieldCount = StringSplit(wire, '|', fields);
  if((fieldCount != 16 && fieldCount != 23) || !KLC_SafeId(fields[0])) return;
  string id = fields[0]; int known = KLC_FindReceipt(id);
  if(known >= 0) { KLC_receipts[known].acknowledged = false; return; }
  int ticket = (int)StringToInteger(fields[15]); string action = fields[6], symbol = fields[7];
  if(fields[1] != IntegerToString(AccountNumber()) || fields[2] != KLC_Hex(AccountServer()) || fields[3] != KLC_Mode() || fields[4] != KLC_sessionId) { KLC_Failure(id, ticket, "Account or terminal changed; command rejected"); return; }
  if((long)TimeGMT() > StringToInteger(fields[5])) { KLC_Failure(id, ticket, "Command expired; check current quote"); return; }
  if(!KLC_TradePermission() || IsTradeContextBusy() || (KLC_Mode() != "demo" && !(KLC_Mode() == "real" && InpAllowReal))) { KLC_Failure(id, ticket, "Trading permission is disabled or busy"); return; }
  if(!KLC_SafeSymbol(symbol) || !SymbolSelect(symbol, true) || MarketInfo(symbol, MODE_TRADEALLOWED) == 0) { KLC_Failure(id, ticket, "Symbol is unavailable for trading"); return; }
  double bid = MarketInfo(symbol, MODE_BID), ask = MarketInfo(symbol, MODE_ASK), point = MarketInfo(symbol, MODE_POINT);
  if(bid <= 0 || ask <= 0 || point <= 0 || (long)TimeGMT() - KLC_Utc((datetime)MarketInfo(symbol, MODE_TIME)) > 30) { KLC_Failure(id, ticket, "Quote is stale; wait for MT4 update"); return; }
  int digits = (int)MarketInfo(symbol, MODE_DIGITS), slippage = (int)StringToInteger(fields[14]);
  double lots = StringToDouble(fields[10]), price = StringToDouble(fields[11]), sl = StringToDouble(fields[12]), tp = StringToDouble(fields[13]);
  int type = fields[8] == "buy" ? OP_BUY : OP_SELL;
  if(slippage < 0 || slippage > 1000 || sl < 0 || tp < 0) { KLC_Failure(id, ticket, "Invalid protection or slippage"); return; }
  if(action == "open") {
    double step = MarketInfo(symbol, MODE_LOTSTEP), minLot = MarketInfo(symbol, MODE_MINLOT), maxLot = MarketInfo(symbol, MODE_MAXLOT);
    if(fieldCount == 23) {
      if(fields[16] == "risk-percent") {
        double percent = StringToDouble(fields[17]), tickValue = MarketInfo(symbol, MODE_TICKVALUE), tickSize = SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_SIZE);
        double entry = fields[9] == "market" ? fields[8] == "buy" ? ask : bid : price;
        if(percent <= 0 || percent > 100 || AccountBalance() <= 0 || sl <= 0 || MathAbs(entry - sl) <= 0 || tickValue <= 0 || tickSize <= 0 || step <= 0) { KLC_Failure(id, ticket, "Risk sizing inputs are invalid"); return; }
        double rawLots = AccountBalance() * percent / 100.0 / (MathAbs(entry - sl) / tickSize * tickValue);
        lots = NormalizeDouble(MathFloor((MathMin(maxLot, rawLots) + 0.0000000001) / step) * step, 8);
      } else if(fields[16] != "fixed") { KLC_Failure(id, ticket, "Risk sizing inputs are invalid"); return; }
      if(fields[18] != "off") {
        int tf = (int)StringToInteger(fields[21]); double threshold = StringToDouble(fields[20]);
        if(fields[8] != "buy" || fields[9] != "market" || !KLC_ValidTimeframe(tf) || threshold <= 0 ||
           (fields[18] != "high" && fields[18] != "low") || (fields[19] != "price" && fields[19] != "percent") ||
           (long)iTime(symbol, tf, 0) != StringToInteger(fields[22])) { KLC_Failure(id, ticket, "Opening gap context changed"); return; }
        double previous = iClose(symbol, tf, 1), opening = iOpen(symbol, tf, 0);
        double gapDistance = fields[19] == "price" ? threshold : previous * threshold / 100.0;
        if(previous <= 0 || opening <= 0 || (fields[18] == "high" ? opening < previous || opening >= previous + gapDistance : opening > previous || opening <= previous - gapDistance)) { KLC_Failure(id, ticket, "Opening gap filter rejected order"); return; }
      }
    }
    if(step <= 0 || lots < minLot || lots > maxLot || MathAbs(lots / step - MathRound(lots / step)) > 0.0000001) { KLC_Failure(id, ticket, "Lot size does not match symbol rules"); return; }
    if(fields[9] == "limit") type = fields[8] == "buy" ? OP_BUYLIMIT : OP_SELLLIMIT;
    else if(fields[9] == "stop") type = fields[8] == "buy" ? OP_BUYSTOP : OP_SELLSTOP;
    else if(fields[9] != "market") { KLC_Failure(id, ticket, "Unsupported order type"); return; }
    if(type < 2) price = type == OP_BUY ? ask : bid;
    else if(price <= 0) { KLC_Failure(id, ticket, "Pending order price is invalid"); return; }
    ResetLastError(); double free = AccountFreeMarginCheck(symbol, fields[8] == "buy" ? OP_BUY : OP_SELL, lots);
    if(free <= 0 || GetLastError() == 134) { KLC_Failure(id, ticket, "Insufficient free margin"); return; }
  } else {
    if(!OrderSelect(ticket, SELECT_BY_TICKET) || OrderCloseTime() != 0 || OrderSymbol() != symbol) { KLC_Failure(id, ticket, "Order changed; refresh MT4 orders"); return; }
    type = OrderType(); lots = OrderLots(); price = OrderOpenPrice();
    if((action == "close" && type > 1) || (action == "cancel" && type < 2) || (action != "close" && action != "cancel" && action != "protect")) { KLC_Failure(id, ticket, "Action does not match order type"); return; }
  }
  if(action == "open" || action == "protect") {
    bool buy = type % 2 == 0; double distance = MarketInfo(symbol, MODE_STOPLEVEL) * point;
    double reference = type < 2 ? buy ? bid : ask : price;
    if((sl > 0 && (buy ? reference - sl : sl - reference) < MathMax(distance, point * 0.1)) ||
       (tp > 0 && (buy ? tp - reference : reference - tp) < MathMax(distance, point * 0.1))) { KLC_Failure(id, ticket, "Protection distance or direction is invalid"); return; }
  }
  // Durably mark BEFORE touching the broker. A crash after this point must never retry automatically.
  if(!KLC_SaveReceipt(id, "unknown", MathMax(0, ticket), "Execution result requires verification in MT4")) { KLC_DisableConnection(); return; }
  ResetLastError(); bool ok = false; int resultingTicket = ticket;
  if(action == "open") {
    string tag = "KLC:" + StringSubstr(id, 0, 8) + StringSubstr(id, 9, 4);
    resultingTicket = OrderSend(symbol, type, lots, NormalizeDouble(price, digits), slippage, NormalizeDouble(sl, digits), NormalizeDouble(tp, digits), tag, KLC_BRIDGE_MAGIC, 0, clrNONE);
    ok = resultingTicket > 0;
  } else if(action == "close") ok = OrderClose(ticket, lots, type == OP_BUY ? bid : ask, slippage, clrNONE);
  else if(action == "cancel") ok = OrderDelete(ticket, clrNONE);
  else if(action == "protect") ok = OrderModify(ticket, price, NormalizeDouble(sl, digits), NormalizeDouble(tp, digits), OrderExpiration(), clrNONE);
  int error = GetLastError(); string status = ok ? "succeeded" : error == 128 ? "unknown" : "failed";
  string message = ok ? "" : "MT4 error " + IntegerToString(error);
  if(!KLC_SaveReceipt(id, status, MathMax(0, resultingTicket), message)) KLC_DisableConnection();
}
void KLC_RecordCycleTiming(uint started, uint built, uint replied) {
  static uint lastReport = 0;
  uint current = GetTickCount();
  if((uint)(current - started) < 250 || (lastReport != 0 && (uint)(current - lastReport) < 30000)) return;
  lastReport = current;
  PrintFormat("KLine connection timing: snapshot=%u ms, request=%u ms, archive=%u ms", (uint)(built - started), (uint)(replied - built), (uint)(current - replied));
}
void KLC_PollConnection(bool full, bool allowFlush = true) {
  uint started = GetTickCount();
  if(KLC_working) return; KLC_working = true;
  // Keep a fixed offset between ticks. Recomputing it on a frozen TimeCurrent would make stale quotes appear fresh.
  if(IsConnected() && TimeCurrent() != KLC_observedServerTime) {
    KLC_observedServerTime = TimeCurrent(); KLC_serverOffset = (long)KLC_observedServerTime - (long)TimeGMT(); KLC_timeReady = true;
  }
  char data[], result[]; string responseHeaders;
  StringToCharArray(KLC_SnapshotJson(full), data, 0, WHOLE_ARRAY, CP_UTF8); ArrayResize(data, ArraySize(data) - 1);
  uint built = GetTickCount();
  ResetLastError(); int code = WebRequest("POST", full ? KLC_RequestUrl() : StringSubstr(KLC_RequestUrl(),0,StringLen(KLC_RequestUrl())-8)+"execution", "Content-Type: application/json\r\nAuthorization: Bearer " + InpPairToken + "\r\n", full ? 1000 : 400, data, result, responseHeaders);
  int error = GetLastError(); uint replied = GetTickCount();
  if(code == 200) {
    string reply = CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);
    if(StringFind(reply, "\"protocolVersion\":1") < 0) { KLC_working = false; return; }
    string acknowledged[]; int count = StringSplit(KLC_JsonString(reply, "ack"), ',', acknowledged);
    for(int i = 0; i < count; i++) { int index = KLC_FindReceipt(acknowledged[i]); if(index >= 0) KLC_receipts[index].acknowledged = true; }
    string next = KLC_JsonString(reply, "symbol"); int tf = KLC_JsonTimeframe(reply);
    if(KLC_SafeSymbol(next) && KLC_ValidTimeframe(tf) && KLC_EnsureSelected(next)) {
      if(KLC_selectedSymbol != next || KLC_selectedTimeframe != tf) KLC_lastFullPoll = 0;
      KLC_selectedSymbol = next; KLC_selectedTimeframe = tf;
    }
    int poll=KLC_JsonInteger(reply,"fastPollMs");KLC_fastPollMs=poll>=100&&poll<=1000?poll:0;KLC_failedPolls=0;
    string command=KLC_JsonString(reply,"wire"); KLC_Execute(command); KLC_lastHttpError = 0;
    // Execution and its receipt take priority; archive work is retried on the next full heartbeat.
    if(full && command=="") KLC_ReadArchive(KLC_JsonString(reply, "archiveWire"));
  } else {
    KLC_failedPolls=MathMin(10,KLC_failedPolls+1);
    if(code==404 || code==405)KLC_fastPollMs=0;
    if(code != KLC_lastHttpError) {
    // Do not log URLs, pairing credentials, account identifiers or broker responses.
    Print("KLine connection: HTTP ", code, ", MT4 error ", error, ". Check connection settings in the training app."); KLC_lastHttpError = code;
    if(code > 0) {
      string reason = KLC_JsonString(CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8), "error");
      if(StringLen(reason) > 0) Print("KLine connection: ", reason);
    }
  }
    }
  KLC_RecordCycleTiming(started, built, replied);
  KLC_working = false;
  if(code==200 && allowFlush && KLC_fastPollMs>0 && KLC_JsonString(CharArrayToString(result,0,WHOLE_ARRAY,CP_UTF8),"wire")!="") KLC_PollConnection(false,false);
}
void KLC_OnTimer() {
  uint current=GetTickCount();
  int interval=KLC_fastPollMs>0?KLC_fastPollMs:InpPollSeconds*1000;
  interval=MathMax(interval,KLC_failedPolls*1000);
  if(KLC_lastTransportPoll!=0 && (uint)(current-KLC_lastTransportPoll)<(uint)interval)return;
  bool full=KLC_lastFullPoll==0 || (uint)(current-KLC_lastFullPoll)>=(uint)(InpPollSeconds*1000);
  KLC_lastTransportPoll=current;if(full)KLC_lastFullPoll=current;
  KLC_PollConnection(full);
}
int KLC_OnInit() {
  KLC_connectionRetryable = false;
  if(!KLC_ValidUrl() || StringLen(InpPairToken) != 48 || InpPollSeconds < 1 || InpPollSeconds > 5) return KLC_InitFailure("连接配置无效，请加载训练营下载的连接配置", INIT_PARAMETERS_INCORRECT);
  for(int i = 0; i < StringLen(InpPairToken); i++) {
    ushort c = StringGetCharacter(InpPairToken, i);
    if(!((c >= 48 && c <= 57) || (c >= 97 && c <= 102))) return KLC_InitFailure("配对凭证格式无效，请重新加载连接配置", INIT_PARAMETERS_INCORRECT);
  }
  KLC_selectedSymbol = Symbol(); KLC_selectedTimeframe = PERIOD_M5;
  KLC_observedServerTime = TimeCurrent();
  KLC_sessionId = IntegerToString((long)TimeLocal()) + "-" + IntegerToString((long)GetTickCount()) + "-" + IntegerToString(ChartID());
  if(!KLC_LoadJournal()) {
    string reason = KLC_connectionRetryable ? "连接暂被占用或文件不可用：请只保留一个连接 EA" : "连接执行记录无法读取，请先核对 MT4 订单并恢复记录备份";
    if(KLC_journal != INVALID_HANDLE) FileClose(KLC_journal); KLC_journal = INVALID_HANDLE; return KLC_InitFailure(reason, INIT_FAILED);
  }
  KLC_lastFullPoll=0;KLC_lastTransportPoll=0;KLC_fastPollMs=0;KLC_failedPolls=0;
  KLC_connectionError = "";
  Print("KLine connection ready. Enable trading explicitly in the training app."); return INIT_SUCCEEDED;
}
void KLC_OnDeinit(const int reason) {  if(KLC_journal != INVALID_HANDLE) FileClose(KLC_journal); KLC_journal = INVALID_HANDLE; }

void KLC_DisableConnection() {
  KLC_ready = false;
  KLC_retryInit = false;
  if(KLC_journal != INVALID_HANDLE) FileClose(KLC_journal);
  KLC_journal = INVALID_HANDLE;
  Print("KLine connection stopped. Verify pending orders and reload connection configuration.");
}
bool KLC_Start() {
  KLC_ready = false;
  KLC_retryInit = false;
  if(!InpKLineConnection || StringLen(InpPairToken) == 0) return true;
  KLC_ready = KLC_OnInit() == INIT_SUCCEEDED;
  KLC_retryInit = !KLC_ready && KLC_connectionRetryable;
  KLC_lastInit = GetTickCount();
  KLC_lastPoll = 0;
  return KLC_ready;
}
void KLC_Pump() {
  if(!KLC_ready && KLC_retryInit && (uint)(GetTickCount() - KLC_lastInit) >= 2000) KLC_Start();
  if(!KLC_ready) return;
  KLC_OnTimer();
}
void KLC_Stop() { KLC_ready = false; KLC_retryInit = false; KLC_OnDeinit(0); }
#endif
