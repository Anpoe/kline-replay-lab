#property strict
#property version "1.15"
#property description "Batch market, limit and stop orders with per-row SL/TP settings."

#include "BatchOrderMath.mqh"
#include "BatchOrderTemplate.mqh"
#include "BatchOrderBridge.mqh"
#include "KLineTrainingBridge.mqh"

#import "user32.dll"
   int  GetParent(int hWnd);
   int  ShowWindow(int hWnd, int nCmdShow);
   int  SetWindowPos(int hWnd, int hWndInsertAfter, int X, int Y, int cx, int cy, int uFlags);
   bool SetForegroundWindow(int hWnd);
   bool BringWindowToTop(int hWnd);
   bool IsIconic(int hWnd);
#import

#define SW_RESTORE            9
#define SW_SHOW               5
#define HWND_TOPMOST         -1
#define HWND_NOTOPMOST       -2
#define SWP_NOSIZE           0x0001
#define SWP_NOMOVE           0x0002
#define SWP_SHOWWINDOW       0x0040

input int InpMagicNumber = 260827;
input int InpDefaultOrderCount = 1;
input double InpDefaultFixedLots = 0.10;
input double InpDefaultRiskPercent = 1.0;
input int InpDefaultSLUnit = BO_UNIT_PIPS;
input double InpDefaultSLValue = 50.0;
input int InpDefaultTPUnit = BO_UNIT_PIPS;
input double InpDefaultTPValue = 100.0;
input int InpSlippagePoints = 30;
input bool InpEnableAccountWideClose = false;
input bool InpConfirmClose = true;
input BOBridgeMode InpBridgeMode = BRIDGE_OFF;
input int InpBridgePollMilliseconds = 50;
input int InpBridgeOpenTtlSeconds = 5;
input int InpBridgeCloseTtlSeconds = 30;
input int InpBridgeConfirmSeconds = 15;
input string InpSectionCandleAlert = "--- K线结束提醒设置 ---";
input bool   InpCandleAlertEnabled = true;  // 启用K线结束提醒
input int    InpCandleAlertSeconds = 10;    // 提前提醒秒数(秒)

const string BO_PREFIX = "BOP_";
const int BO_PANEL_X = 10;
const int BO_PANEL_Y = 20;
const int BO_PANEL_WIDTH = 600;
const int BO_ROW_HEIGHT = 32;
const int BO_ROW_START_Y = 124;
const int BO_VISIBLE_ROWS = 3;
const int BO_TRADE_MAX_ATTEMPTS = 3;
const int BO_TRADE_RETRY_DELAY_MS = 250;
const int BO_BATCH_ORDER_SPACING_MS = 200;

int gOrderCount=1;
int gOrderMode=0;
double gPendingPrice=0.0;
int gLotMode=BO_LOTS_FIXED;
double gFixedLots=0.10;
double gRiskPercent=1.0;
int gMagicNumber=260827;
int gSlippagePoints=30;
bool gEnableAccountWideClose=false;
bool gConfirmClose=true;
bool gSettingsExpanded=false;
int gBridgeMode=BRIDGE_OFF;
int gBridgePollMilliseconds=50;
int gBridgeOpenTtlSeconds=5;
int gBridgeCloseTtlSeconds=30;
int gBridgeConfirmSeconds=15;
bool   gCandleAlertEnabled=true;
int    gCandleAlertSeconds=10;
datetime gLastAlertBarTime=0;
int    gServerTimeDelta=0;
bool   gHasServerTimeDelta=false;
string gTemplateName="default";
int gSlUnits[BO_MAX_ROWS];
double gSlValues[BO_MAX_ROWS];
int gTpUnits[BO_MAX_ROWS];
double gTpValues[BO_MAX_ROWS];
string gStatus="点击 SL/TP 单位可切换 pips、百分比和金额";
bool gPanelReady=false;
int gRowPage=0;
BOBridgeCommand gPendingBridgeCommand;
bool gBridgePending=false;
datetime gBridgePendingExpires=0;
string gBridgeLastEventId="";
string gBridgeLastReadError="";
int gBridgeLastPendingSecond=-1;
string gLastExecutionDetails="";
string gLastCloseDetails="";

bool ExecuteBatch(int orderType, int orderCountOverride=0, double pendingPrice=0.0);
bool CloseManagedOrders(bool accountWide, bool skipConfirmation=false);
bool RestartBridgeTimer(bool restoreLastEvent);

string RowObject(int row, string suffix)
  {
   return(BO_PREFIX+"Row_"+IntegerToString(row)+"_"+suffix);
  }

string UnitText(int unit)
  {
   if(unit==BO_UNIT_PERCENT)
      return("%");
   if(unit==BO_UNIT_PL)
      return("金额");
   return("pips");
  }

string PanelOrderLabel(int side)
  {
   string label=side==OP_BUY ? "Buy" : "Sell";
   return(label+(gOrderMode==1 ? " Limit" : gOrderMode==2 ? " Stop" : ""));
  }

string PanelNumber(double value)
  {
   string result=DoubleToString(value, 8);
   while(StringLen(result)>1 && StringSubstr(result, StringLen(result)-1, 1)=="0")
      result=StringSubstr(result, 0, StringLen(result)-1);
   if(StringSubstr(result, StringLen(result)-1, 1)==".")
      result=StringSubstr(result, 0, StringLen(result)-1);
   return(result);
  }

string PeriodToString(int tf)
  {
   switch(tf)
     {
      case PERIOD_M1:  return("M1");
      case PERIOD_M5:  return("M5");
      case PERIOD_M15: return("M15");
      case PERIOD_M30: return("M30");
      case PERIOD_H1:  return("H1");
      case PERIOD_H4:  return("H4");
      case PERIOD_D1:  return("D1");
      case PERIOD_W1:  return("W1");
      case PERIOD_MN1: return("MN1");
      default:         return(StringFormat("M%d", tf));
     }
  }

void BringMT4ToTop()
  {
   if(!IsDllsAllowed())
     {
      Print("[K线提醒] 置顶功能需要开启【允许导入DLL】权限。请在EA属性勾选【允许导入DLL】。");
      return;
     }

   int chartWnd = (int)ChartGetInteger(0, CHART_WINDOW_HANDLE);
   if(chartWnd == 0)
      chartWnd = WindowHandle(Symbol(), Period());
   if(chartWnd == 0)
      return;

   int mainWnd = chartWnd;
   int parent = GetParent(chartWnd);
   while(parent != 0)
     {
      mainWnd = parent;
      parent = GetParent(mainWnd);
     }

   if(IsIconic(mainWnd))
      ShowWindow(mainWnd, SW_RESTORE);
   else
      ShowWindow(mainWnd, SW_SHOW);

   SetWindowPos(mainWnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
   BringWindowToTop(mainWnd);
   SetForegroundWindow(mainWnd);
   SetWindowPos(mainWnd, HWND_NOTOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
  }

int GetBarSecondsRemaining()
  {
   datetime currentServer = TimeCurrent();
   datetime localNow = TimeLocal();
   if(currentServer > 0)
     {
      gServerTimeDelta = (int)(currentServer - localNow);
      gHasServerTimeDelta = true;
     }

   datetime estimatedServer = gHasServerTimeDelta ? (localNow + gServerTimeDelta) : currentServer;
   if(estimatedServer <= 0)
      estimatedServer = localNow;

   datetime barOpen = iTime(Symbol(), Period(), 0);
   if(barOpen <= 0)
      return(-1);

   int barDuration = PeriodSeconds(Period());
   if(barDuration <= 0)
      barDuration = Period() * 60;

   datetime barClose = barOpen + barDuration;
   int remaining = (int)(barClose - estimatedServer);
   return(remaining);
  }

void CheckCandleAlert()
  {
   if(!gCandleAlertEnabled)
      return;
   if(gCandleAlertSeconds <= 0)
      return;

   datetime barOpen = iTime(Symbol(), Period(), 0);
   if(barOpen <= 0)
      return;

   if(gLastAlertBarTime == barOpen)
      return;

   int remaining = GetBarSecondsRemaining();
   if(remaining >= 0 && remaining <= gCandleAlertSeconds)
     {
      gLastAlertBarTime = barOpen;
      string tfStr = PeriodToString(Period());
      string alertMsg = StringFormat("[%s, %s] K线快结束了！剩余约 %d 秒", Symbol(), tfStr, remaining);

      Alert(alertMsg);
      SetStatus(alertMsg);
      BringMT4ToTop();
     }
  }

string BridgeModeText()
  {
   if(gBridgeMode==BRIDGE_CONFIRM)
      return("桥接:确认开仓");
   if(gBridgeMode==BRIDGE_DEMO_AUTO)
      return("桥接:模拟自动");
   return("桥接:关闭");
  }

int ClampOrderCount(int value)
  {
   if(value<1)
      return(1);
   if(value>BO_MAX_ROWS)
      return(BO_MAX_ROWS);
   return(value);
  }

void InitializeState()
  {
   gOrderCount=ClampOrderCount(InpDefaultOrderCount);
   gLotMode=BO_LOTS_FIXED;
   gFixedLots=InpDefaultFixedLots;
   gRiskPercent=InpDefaultRiskPercent;
   gMagicNumber=InpMagicNumber;
   gSlippagePoints=InpSlippagePoints;
   gEnableAccountWideClose=InpEnableAccountWideClose;
   gConfirmClose=InpConfirmClose;
   gSettingsExpanded=false;
   gCandleAlertEnabled=InpCandleAlertEnabled;
   gCandleAlertSeconds=InpCandleAlertSeconds>0 ? InpCandleAlertSeconds : 10;
   gBridgeMode=(int)InpBridgeMode;
   gBridgePollMilliseconds=InpBridgePollMilliseconds;
   gBridgeOpenTtlSeconds=InpBridgeOpenTtlSeconds;
   gBridgeCloseTtlSeconds=InpBridgeCloseTtlSeconds;
   gBridgeConfirmSeconds=InpBridgeConfirmSeconds;
   string bridgeError="";
   if(!BO_ValidBridgePanelSettings(gBridgeMode, gBridgePollMilliseconds,
                                   gBridgeOpenTtlSeconds, gBridgeCloseTtlSeconds,
                                   gBridgeConfirmSeconds, bridgeError))
     {
      gBridgeMode=BRIDGE_OFF;
      gBridgePollMilliseconds=50;
      gBridgeOpenTtlSeconds=5;
      gBridgeCloseTtlSeconds=30;
      gBridgeConfirmSeconds=15;
     }
   for(int i=0; i<BO_MAX_ROWS; i++)
     {
      gSlUnits[i]=InpDefaultSLUnit;
      gSlValues[i]=InpDefaultSLValue;
      gTpUnits[i]=InpDefaultTPUnit;
      gTpValues[i]=InpDefaultTPValue;
     }
  }

string PanelStateKey()
  {
   long login=AccountNumber();
   if(login<=0)
      login=AccountInfoInteger(ACCOUNT_LOGIN);
   return(StringFormat("panel_state_%I64d_%s", login, Symbol()));
  }

void SavePanelState()
  {
   string error="";
   if(!BO_SavePanelState(PanelStateKey(), Symbol(), gOrderCount, gLotMode,
                         gFixedLots, gRiskPercent, gSlippagePoints,
                         gEnableAccountWideClose, gConfirmClose, gSettingsExpanded,
                         gBridgeMode, gBridgePollMilliseconds,
                         gBridgeOpenTtlSeconds, gBridgeCloseTtlSeconds,
                         gBridgeConfirmSeconds,
                         gCandleAlertEnabled, gCandleAlertSeconds,
                         gTemplateName, gSlUnits, gSlValues, gTpUnits, gTpValues, error, gOrderMode, gPendingPrice))
      Print("BatchOrderPanel state save failed: ", error);
  }

bool RestorePanelState()
  {
   int loadedCount=0;
   int loadedMode=BO_LOTS_FIXED;
   int loadedEntryMode=0;
   double loadedPendingPrice=0.0;
   double loadedFixedLots=0.0;
   double loadedRiskPercent=0.0;
   int loadedSlippage=0;
   bool loadedAccountWide=false;
   bool loadedConfirm=true;
   bool loadedExpanded=false;
   int loadedBridgeMode=gBridgeMode;
   int loadedBridgePollMilliseconds=gBridgePollMilliseconds;
   int loadedBridgeOpenTtlSeconds=gBridgeOpenTtlSeconds;
   int loadedBridgeCloseTtlSeconds=gBridgeCloseTtlSeconds;
   int loadedBridgeConfirmSeconds=gBridgeConfirmSeconds;
   bool loadedCandleAlertEnabled=gCandleAlertEnabled;
   int loadedCandleAlertSeconds=gCandleAlertSeconds;
   string savedSymbol="";
   string loadedTemplateName="";
   int loadedSlUnits[BO_MAX_ROWS];
   int loadedTpUnits[BO_MAX_ROWS];
   double loadedSlValues[BO_MAX_ROWS];
   double loadedTpValues[BO_MAX_ROWS];
   string error="";

   if(!BO_LoadPanelState(PanelStateKey(), Symbol(), savedSymbol, loadedCount, loadedMode,
                         loadedFixedLots, loadedRiskPercent, loadedSlippage,
                         loadedAccountWide, loadedConfirm, loadedExpanded,
                         loadedBridgeMode, loadedBridgePollMilliseconds,
                         loadedBridgeOpenTtlSeconds, loadedBridgeCloseTtlSeconds,
                         loadedBridgeConfirmSeconds,
                         loadedCandleAlertEnabled, loadedCandleAlertSeconds,
                         loadedTemplateName, loadedSlUnits, loadedSlValues,
                         loadedTpUnits, loadedTpValues, loadedEntryMode, loadedPendingPrice, error))
     {
      if(error!="")
         gStatus="记忆设置加载失败，已使用默认值："+error;
      return(false);
     }

   gOrderMode=loadedEntryMode;
   gPendingPrice=loadedPendingPrice;
   gOrderCount=ClampOrderCount(loadedCount);
   gLotMode=loadedMode;
   gFixedLots=loadedFixedLots;
   gRiskPercent=loadedRiskPercent;
   gSlippagePoints=loadedSlippage;
   gEnableAccountWideClose=loadedAccountWide;
   gConfirmClose=loadedConfirm;
   gSettingsExpanded=loadedExpanded;
   gBridgeMode=loadedBridgeMode;
   gBridgePollMilliseconds=loadedBridgePollMilliseconds;
   gBridgeOpenTtlSeconds=loadedBridgeOpenTtlSeconds;
   gBridgeCloseTtlSeconds=loadedBridgeCloseTtlSeconds;
   gBridgeConfirmSeconds=loadedBridgeConfirmSeconds;
   gCandleAlertEnabled=loadedCandleAlertEnabled;
   gCandleAlertSeconds=loadedCandleAlertSeconds;
   gTemplateName=loadedTemplateName;
   for(int i=0; i<BO_MAX_ROWS; i++)
     {
      gSlUnits[i]=loadedSlUnits[i];
      gSlValues[i]=loadedSlValues[i];
      gTpUnits[i]=loadedTpUnits[i];
      gTpValues[i]=loadedTpValues[i];
     }
   return(true);
  }

bool CreateObject(string name, ENUM_OBJECT objectType)
  {
   if(ObjectFind(0, name)>=0)
      return(true);
   return(ObjectCreate(0, name, objectType, 0, 0, 0));
  }

void SetCommonProperties(string name, int x, int y, int width, int height, color textColor)
  {
   ObjectSetInteger(0, name, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, name, OBJPROP_XDISTANCE, x);
   ObjectSetInteger(0, name, OBJPROP_YDISTANCE, y);
   ObjectSetInteger(0, name, OBJPROP_XSIZE, width);
   ObjectSetInteger(0, name, OBJPROP_YSIZE, height);
   ObjectSetInteger(0, name, OBJPROP_COLOR, textColor);
   ObjectSetInteger(0, name, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, name, OBJPROP_SELECTED, false);
   ObjectSetInteger(0, name, OBJPROP_HIDDEN, true);
  }

void SetVisible(string name, bool visible)
  {
   if(ObjectFind(0, name)<0)
      return;
   ObjectSetInteger(0, name, OBJPROP_TIMEFRAMES, visible ? OBJ_ALL_PERIODS : 0);
  }

void SetObjectY(string name, int y)
  {
   if(ObjectFind(0, name)>=0)
      ObjectSetInteger(0, name, OBJPROP_YDISTANCE, y);
  }

void SetText(string name, string text)
  {
   if(ObjectFind(0, name)>=0)
      ObjectSetString(0, name, OBJPROP_TEXT, text);
  }

void CreateLabel(string name, string text, int x, int y, int width, int height, color textColor, int fontSize=10)
  {
   if(!CreateObject(name, OBJ_LABEL))
      return;
   SetCommonProperties(name, x, y, width, height, textColor);
   ObjectSetString(0, name, OBJPROP_FONT, "Microsoft YaHei");
   ObjectSetInteger(0, name, OBJPROP_FONTSIZE, fontSize);
   SetText(name, text);
   SetVisible(name, true);
  }

void CreateEdit(string name, string text, int x, int y, int width, int height)
  {
   if(!CreateObject(name, OBJ_EDIT))
      return;
   SetCommonProperties(name, x, y, width, height, clrWhite);
   ObjectSetInteger(0, name, OBJPROP_COLOR, clrBlack);
   ObjectSetInteger(0, name, OBJPROP_BGCOLOR, C'242,246,250');
   ObjectSetInteger(0, name, OBJPROP_BORDER_COLOR, C'90,107,126');
   ObjectSetString(0, name, OBJPROP_FONT, "Microsoft YaHei");
   ObjectSetInteger(0, name, OBJPROP_FONTSIZE, 9);
   SetText(name, text);
   SetVisible(name, true);
  }

void CreateRowObjects(int row)
  {
   if(row<1 || row>BO_MAX_ROWS)
      return;
   int index=row-1;
   int y=BO_PANEL_Y+BO_ROW_START_Y+(index-gRowPage*BO_VISIBLE_ROWS)*BO_ROW_HEIGHT;
   CreateLabel(RowObject(row, "Label"), "#"+IntegerToString(row), BO_PANEL_X+14, y+4, 34, 22, C'175,190,207', 9);
   CreateButton(RowObject(row, "SLUnit"), "SL "+UnitText(gSlUnits[index]), BO_PANEL_X+56, y, 94, 26, C'48,69,90');
   CreateEdit(RowObject(row, "SLValue"), PanelNumber(gSlValues[index]), BO_PANEL_X+158, y, 112, 26);
   CreateButton(RowObject(row, "TPUnit"), "TP "+UnitText(gTpUnits[index]), BO_PANEL_X+294, y, 94, 26, C'48,69,90');
   CreateEdit(RowObject(row, "TPValue"), PanelNumber(gTpValues[index]), BO_PANEL_X+396, y, 112, 26);
  }

void DeleteRowObjects(int row)
  {
   if(row<1 || row>BO_MAX_ROWS)
      return;
   ObjectDelete(0, RowObject(row, "Label"));
   ObjectDelete(0, RowObject(row, "SLUnit"));
   ObjectDelete(0, RowObject(row, "SLValue"));
   ObjectDelete(0, RowObject(row, "TPUnit"));
   ObjectDelete(0, RowObject(row, "TPValue"));
  }

void CreateSettingsObjects()
  {
   int rowY=BO_PANEL_Y+75;
   CreateLabel(BO_PREFIX+"SettingsTitle", "交易设置", BO_PANEL_X+14, BO_PANEL_Y+50, 150, 22, C'87,196,207', 10);
   CreateLabel(BO_PREFIX+"SlippageLabel", "滑点", BO_PANEL_X+14, rowY+3, 50, 22, C'175,190,207', 9);
   CreateEdit(BO_PREFIX+"SlippagePoints", IntegerToString(gSlippagePoints), BO_PANEL_X+72, rowY, 75, 26);
   CreateButton(BO_PREFIX+"AccountCloseToggle",
                 gEnableAccountWideClose ? "全账户平仓  已开启" : "全账户平仓  已关闭",
                 BO_PANEL_X+14, BO_PANEL_Y+108, 238, 28,
                 gEnableAccountWideClose ? C'143,73,61' : C'48,69,90');
   CreateButton(BO_PREFIX+"ConfirmCloseToggle",
                 gConfirmClose ? "平仓二次确认  已开启" : "平仓二次确认  已关闭",
                 BO_PANEL_X+264, BO_PANEL_Y+108, 238, 28, C'48,69,90');

   int alertRowY=BO_PANEL_Y+148;
   CreateLabel(BO_PREFIX+"CandleAlertTitle", "K线结束提醒设置", BO_PANEL_X+14, alertRowY, 180, 22, C'87,196,207', 10);
   CreateButton(BO_PREFIX+"CandleAlertToggle",
                 gCandleAlertEnabled ? "K线结束提醒  已开启" : "K线结束提醒  已关闭",
                 BO_PANEL_X+14, alertRowY+27, 238, 28,
                 gCandleAlertEnabled ? C'27,135,101' : C'48,69,90');
   CreateLabel(BO_PREFIX+"CandleAlertSecLabel", "提前(秒)", BO_PANEL_X+264, alertRowY+30, 60, 22, C'175,190,207', 9);
   CreateEdit(BO_PREFIX+"CandleAlertSeconds", IntegerToString(gCandleAlertSeconds),
               BO_PANEL_X+328, alertRowY+27, 60, 28);
   CreateButton(BO_PREFIX+"CandleAlertTest", "测试提醒置顶",
                 BO_PANEL_X+400, alertRowY+27, 144, 28, C'48,69,90');

   int bridgeRowY=BO_PANEL_Y+245;
   CreateLabel(BO_PREFIX+"BridgeModeLabel", "信号桥设置 · 时间单位：秒", BO_PANEL_X+14, BO_PANEL_Y+218, 310, 22, C'87,196,207', 10);
   CreateButton(BO_PREFIX+"BridgeMode", BridgeModeText(),
                 BO_PANEL_X+14, bridgeRowY, 225, 26, C'48,69,90');
   CreateLabel(BO_PREFIX+"BridgePollLabel", "轮询(ms)", BO_PANEL_X+254, bridgeRowY+3, 100, 22, C'175,190,207', 9);
   CreateEdit(BO_PREFIX+"BridgePollMilliseconds", IntegerToString(gBridgePollMilliseconds),
               BO_PANEL_X+365, bridgeRowY, 75, 26);

   int ttlRowY=BO_PANEL_Y+283;
   CreateLabel(BO_PREFIX+"BridgeOpenTtlLabel", "开仓有效", BO_PANEL_X+14, ttlRowY+3, 88, 22, C'175,190,207', 9);
   CreateEdit(BO_PREFIX+"BridgeOpenTtlSeconds", IntegerToString(gBridgeOpenTtlSeconds),
               BO_PANEL_X+110, ttlRowY, 55, 26);
   CreateLabel(BO_PREFIX+"BridgeCloseTtlLabel", "清仓有效", BO_PANEL_X+194, ttlRowY+3, 88, 22, C'175,190,207', 9);
   CreateEdit(BO_PREFIX+"BridgeCloseTtlSeconds", IntegerToString(gBridgeCloseTtlSeconds),
               BO_PANEL_X+290, ttlRowY, 55, 26);
   CreateLabel(BO_PREFIX+"BridgeConfirmLabel", "确认时限", BO_PANEL_X+374, ttlRowY+3, 88, 22, C'175,190,207', 9);
   CreateEdit(BO_PREFIX+"BridgeConfirmSeconds", IntegerToString(gBridgeConfirmSeconds),
               BO_PANEL_X+470, ttlRowY, 55, 26);
  }

void DeleteSettingsObjects()
  {
   ObjectDelete(0, BO_PREFIX+"SettingsTitle");
   ObjectDelete(0, BO_PREFIX+"SlippageLabel");
   ObjectDelete(0, BO_PREFIX+"SlippagePoints");
   ObjectDelete(0, BO_PREFIX+"AccountCloseToggle");
   ObjectDelete(0, BO_PREFIX+"ConfirmCloseToggle");
   ObjectDelete(0, BO_PREFIX+"CandleAlertTitle");
   ObjectDelete(0, BO_PREFIX+"CandleAlertToggle");
   ObjectDelete(0, BO_PREFIX+"CandleAlertSecLabel");
   ObjectDelete(0, BO_PREFIX+"CandleAlertSeconds");
   ObjectDelete(0, BO_PREFIX+"CandleAlertTest");
   ObjectDelete(0, BO_PREFIX+"BridgeModeLabel");
   ObjectDelete(0, BO_PREFIX+"BridgeMode");
   ObjectDelete(0, BO_PREFIX+"BridgePollLabel");
   ObjectDelete(0, BO_PREFIX+"BridgePollMilliseconds");
   ObjectDelete(0, BO_PREFIX+"BridgeOpenTtlLabel");
   ObjectDelete(0, BO_PREFIX+"BridgeOpenTtlSeconds");
   ObjectDelete(0, BO_PREFIX+"BridgeCloseTtlLabel");
   ObjectDelete(0, BO_PREFIX+"BridgeCloseTtlSeconds");
   ObjectDelete(0, BO_PREFIX+"BridgeConfirmLabel");
   ObjectDelete(0, BO_PREFIX+"BridgeConfirmSeconds");
  }

void CreateButton(string name, string text, int x, int y, int width, int height, color background)
  {
   if(!CreateObject(name, OBJ_BUTTON))
      return;
   SetCommonProperties(name, x, y, width, height, clrWhite);
   ObjectSetInteger(0, name, OBJPROP_BGCOLOR, background);
   ObjectSetInteger(0, name, OBJPROP_BORDER_COLOR, background);
   ObjectSetString(0, name, OBJPROP_FONT, "Microsoft YaHei");
   ObjectSetInteger(0, name, OBJPROP_FONTSIZE, 9);
   SetText(name, text);
   SetVisible(name, true);
  }

void CreatePanelBackground(int height)
  {
   string name=BO_PREFIX+"Background";
   if(!CreateObject(name, OBJ_RECTANGLE_LABEL))
      return;
   SetCommonProperties(name, BO_PANEL_X, BO_PANEL_Y, BO_PANEL_WIDTH, height, clrWhite);
   ObjectSetInteger(0, name, OBJPROP_BGCOLOR, C'24,32,43');
   ObjectSetInteger(0, name, OBJPROP_BORDER_COLOR, C'72,92,112');
   ObjectSetInteger(0, name, OBJPROP_BACK, false);
   SetVisible(name, true);
  }

void CreatePanel()
  {
   CreatePanelBackground(310);
   CreateLabel(BO_PREFIX+"Title", "批量下单", BO_PANEL_X+14, BO_PANEL_Y+9, 320, 26, clrWhite, 12);
   CreateButton(BO_PREFIX+"SettingsToggle", "运行设置", BO_PANEL_X+493, BO_PANEL_Y+10, 92, 28, C'48,69,90');

   CreateLabel(BO_PREFIX+"Status", gStatus, BO_PANEL_X+14, 0, BO_PANEL_WIDTH-28, 27, C'175,190,207', 9);
   gPanelReady=true;
  }

void CreateMainObjects()
  {
   CreateLabel(BO_PREFIX+"CountLabel", "订单数", BO_PANEL_X+14, BO_PANEL_Y+55, 58, 22, C'175,190,207', 9);
   CreateEdit(BO_PREFIX+"OrderCount", IntegerToString(gOrderCount), BO_PANEL_X+88, BO_PANEL_Y+51, 49, 26);
   CreateButton(BO_PREFIX+"LotMode", "固定手数", BO_PANEL_X+145, BO_PANEL_Y+51, 112, 26, C'48,69,90');
   CreateEdit(BO_PREFIX+"LotValue", DoubleToString(gFixedLots, 2), BO_PANEL_X+265, BO_PANEL_Y+51, 85, 26);
   CreateButton(BO_PREFIX+"OrderMode", "市价", BO_PANEL_X+366, BO_PANEL_Y+51, 106, 26, C'48,69,90');
   CreateEdit(BO_PREFIX+"EntryPrice", "", BO_PANEL_X+480, BO_PANEL_Y+51, 100, 26);
   ObjectSetString(0, BO_PREFIX+"OrderMode", OBJPROP_TOOLTIP, "点击切换市价、Limit 限价挂单、Stop 突破挂单；订单数适用于整批");
   ObjectSetString(0, BO_PREFIX+"LotMode", OBJPROP_TOOLTIP, "固定手数按每笔填写；风险百分比为整批权益风险，按订单数平分");
   ObjectSetString(0, BO_PREFIX+"EntryPrice", OBJPROP_TOOLTIP, "挂单价：整批使用同一价格，SL/TP 仍按各行设置；按账户和品种记住委托类型与价格，重载后自动恢复");

   CreateLabel(BO_PREFIX+"HeaderSL", "止损 SL", BO_PANEL_X+56, BO_PANEL_Y+91, 100, 22, C'87,196,207', 9);
   CreateLabel(BO_PREFIX+"HeaderTP", "止盈 TP", BO_PANEL_X+294, BO_PANEL_Y+91, 100, 22, C'87,196,207', 9);
   CreateLabel(BO_PREFIX+"PageLabel", "", BO_PANEL_X+435, BO_PANEL_Y+92, 66, 22, C'175,190,207', 8);
   CreateButton(BO_PREFIX+"PagePrev", "前", BO_PANEL_X+506, BO_PANEL_Y+88, 34, 25, C'48,69,90');
   CreateButton(BO_PREFIX+"PageNext", "后", BO_PANEL_X+546, BO_PANEL_Y+88, 34, 25, C'48,69,90');

   CreateButton(BO_PREFIX+"Buy", "买入 Buy", BO_PANEL_X+14, 0, 112, 30, C'27,135,101');
   CreateButton(BO_PREFIX+"Sell", "卖出 Sell", BO_PANEL_X+134, 0, 112, 30, C'177,68,79');
   CreateButton(BO_PREFIX+"ManagedClose", "本 EA 全平", BO_PANEL_X+266, 0, 125, 30, C'114,80,59');

   CreateLabel(BO_PREFIX+"TemplateLabel", "模板", BO_PANEL_X+14, 0, 42, 22, C'175,190,207', 9);
   CreateEdit(BO_PREFIX+"TemplateName", gTemplateName, BO_PANEL_X+64, 0, 170, 26);
   CreateButton(BO_PREFIX+"SaveTemplate", "保存模板", BO_PANEL_X+244, 0, 100, 26, C'48,69,90');
   CreateButton(BO_PREFIX+"LoadTemplate", "加载模板", BO_PANEL_X+352, 0, 100, 26, C'48,69,90');
  }

void DeleteMainObjects()
  {
   string names[]={"CountLabel","OrderCount","LotMode","LotValue","LotHint","OrderMode","EntryPrice",
                   "HeaderSL","HeaderTP","PageLabel","PagePrev","PageNext",
                   "Buy","Sell","ManagedClose","TemplateLabel","TemplateName",
                   "SaveTemplate","LoadTemplate","AccountClose"};
   for(int i=0; i<ArraySize(names); i++)
      ObjectDelete(0, BO_PREFIX+names[i]);
  }

void RefreshPanel()
  {
   if(!gPanelReady)
      return;

   SetText(BO_PREFIX+"Title", gSettingsExpanded ? "运行设置" : Symbol()+"  批量下单");
   SetText(BO_PREFIX+"SettingsToggle", gSettingsExpanded ? "返回下单" : "运行设置");
   SetText(BO_PREFIX+"Status", "提示  "+gStatus);
   ObjectSetString(0, BO_PREFIX+"Status", OBJPROP_TOOLTIP, gStatus);

   int panelBottom=BO_PANEL_Y+313;
   if(gSettingsExpanded)
     {
      DeleteMainObjects();
      for(int i=1; i<=BO_MAX_ROWS; i++)
         DeleteRowObjects(i);
      CreateSettingsObjects();
      SetText(BO_PREFIX+"SlippagePoints", IntegerToString(gSlippagePoints));
      SetText(BO_PREFIX+"AccountCloseToggle",
              gEnableAccountWideClose ? "全账户平仓  已开启" : "全账户平仓  已关闭");
      SetText(BO_PREFIX+"ConfirmCloseToggle",
              gConfirmClose ? "平仓二次确认  已开启" : "平仓二次确认  已关闭");
      ObjectSetInteger(0, BO_PREFIX+"AccountCloseToggle", OBJPROP_BGCOLOR,
                       gEnableAccountWideClose ? C'143,73,61' : C'48,69,90');
      SetText(BO_PREFIX+"BridgeMode", BridgeModeText());
      SetText(BO_PREFIX+"BridgePollMilliseconds", IntegerToString(gBridgePollMilliseconds));
      SetText(BO_PREFIX+"BridgeOpenTtlSeconds", IntegerToString(gBridgeOpenTtlSeconds));
      SetText(BO_PREFIX+"BridgeCloseTtlSeconds", IntegerToString(gBridgeCloseTtlSeconds));
      SetText(BO_PREFIX+"BridgeConfirmSeconds", IntegerToString(gBridgeConfirmSeconds));
      SetText(BO_PREFIX+"CandleAlertToggle",
              gCandleAlertEnabled ? "K线结束提醒  已开启" : "K线结束提醒  已关闭");
      ObjectSetInteger(0, BO_PREFIX+"CandleAlertToggle", OBJPROP_BGCOLOR,
                       gCandleAlertEnabled ? C'27,135,101' : C'48,69,90');
      SetText(BO_PREFIX+"CandleAlertSeconds", IntegerToString(gCandleAlertSeconds));
      SetObjectY(BO_PREFIX+"Status", BO_PANEL_Y+322);
      panelBottom=BO_PANEL_Y+362;
     }
   else
     {
      DeleteSettingsObjects();
      CreateMainObjects();
      SetText(BO_PREFIX+"OrderCount", IntegerToString(gOrderCount));
      SetText(BO_PREFIX+"LotMode", gLotMode==BO_LOTS_RISK ? "风险百分比" : "固定手数");
      SetText(BO_PREFIX+"LotValue", gLotMode==BO_LOTS_RISK ? DoubleToString(gRiskPercent, 2) : DoubleToString(gFixedLots, 2));
      SetText(BO_PREFIX+"OrderMode", gOrderMode==1 ? "Limit 限价" : gOrderMode==2 ? "Stop 突破" : "市价");
      ObjectSetInteger(0, BO_PREFIX+"EntryPrice", OBJPROP_READONLY, gOrderMode==0);
      SetText(BO_PREFIX+"EntryPrice", gOrderMode==0 ? "市价" : gPendingPrice>0.0 ? DoubleToString(gPendingPrice, Digits) : "");
      SetText(BO_PREFIX+"Buy", PanelOrderLabel(OP_BUY));
      SetText(BO_PREFIX+"Sell", PanelOrderLabel(OP_SELL));
      SetText(BO_PREFIX+"TemplateName", gTemplateName);

      int pageCount=(gOrderCount+BO_VISIBLE_ROWS-1)/BO_VISIBLE_ROWS;
      if(gRowPage>=pageCount)
         gRowPage=pageCount-1;
      if(gRowPage<0)
         gRowPage=0;
      SetText(BO_PREFIX+"PageLabel", StringFormat("%d / %d", gRowPage+1, pageCount));
      if(pageCount==1)
        {
         ObjectDelete(0, BO_PREFIX+"PageLabel");
         ObjectDelete(0, BO_PREFIX+"PagePrev");
         ObjectDelete(0, BO_PREFIX+"PageNext");
        }
      else
        {
         ObjectSetInteger(0, BO_PREFIX+"PagePrev", OBJPROP_BGCOLOR,
                          gRowPage>0 ? C'48,69,90' : C'38,49,62');
         ObjectSetInteger(0, BO_PREFIX+"PageNext", OBJPROP_BGCOLOR,
                          (gRowPage+1)*BO_VISIBLE_ROWS<gOrderCount ? C'48,69,90' : C'38,49,62');
        }
      for(int i=0; i<BO_MAX_ROWS; i++)
        {
         int row=i+1;
         if(i<gOrderCount && i>=gRowPage*BO_VISIBLE_ROWS &&
            i<(gRowPage+1)*BO_VISIBLE_ROWS)
           {
            CreateRowObjects(row);
            SetText(RowObject(row, "SLUnit"), "SL "+UnitText(gSlUnits[i]));
            SetText(RowObject(row, "SLValue"), PanelNumber(gSlValues[i]));
            SetText(RowObject(row, "TPUnit"), "TP "+UnitText(gTpUnits[i]));
            SetText(RowObject(row, "TPValue"), PanelNumber(gTpValues[i]));
           }
         else
            DeleteRowObjects(row);
        }

      int shown=gOrderCount-gRowPage*BO_VISIBLE_ROWS;
      if(shown>BO_VISIBLE_ROWS)
         shown=BO_VISIBLE_ROWS;
      int actionY=BO_PANEL_Y+BO_ROW_START_Y+shown*BO_ROW_HEIGHT+8;
      SetObjectY(BO_PREFIX+"Buy", actionY);
      SetObjectY(BO_PREFIX+"Sell", actionY);
      SetObjectY(BO_PREFIX+"ManagedClose", actionY);
      if(gEnableAccountWideClose)
         CreateButton(BO_PREFIX+"AccountClose", "全账户全平", BO_PANEL_X+405, actionY, 174, 30, C'153,54,63');
      else
         ObjectDelete(0, BO_PREFIX+"AccountClose");

      int templateY=actionY+41;
      SetObjectY(BO_PREFIX+"TemplateLabel", templateY+3);
      SetObjectY(BO_PREFIX+"TemplateName", templateY);
      SetObjectY(BO_PREFIX+"SaveTemplate", templateY);
      SetObjectY(BO_PREFIX+"LoadTemplate", templateY);
      SetObjectY(BO_PREFIX+"Status", templateY+37);
      panelBottom=templateY+69;
      if(gBridgePending)
        {
         ObjectDelete(0, BO_PREFIX+"TemplateLabel");
         ObjectDelete(0, BO_PREFIX+"TemplateName");
         ObjectDelete(0, BO_PREFIX+"SaveTemplate");
         ObjectDelete(0, BO_PREFIX+"LoadTemplate");
        }
     }

   if(gBridgePending)
     {
       int pendingY=gSettingsExpanded ? panelBottom+4 : panelBottom-69;
      int secondsLeft=(int)(gBridgePendingExpires-TimeLocal());
      if(secondsLeft<0)
         secondsLeft=0;
      gBridgeLastPendingSecond=secondsLeft;
      string pendingDirection=gPendingBridgeCommand.direction;
      CreateLabel(BO_PREFIX+"BridgePending",
                  StringFormat("桥接待确认：%s 5单（剩余 %d 秒）", pendingDirection, secondsLeft),
                  BO_PANEL_X+14, pendingY+4, 270, 22, C'249,205,92', 9);
      CreateButton(BO_PREFIX+"BridgeConfirm", "确认开仓",
                   BO_PANEL_X+300, pendingY, 112, 28, C'27,135,101');
      CreateButton(BO_PREFIX+"BridgeCancel", "取消",
                   BO_PANEL_X+420, pendingY, 92, 28, C'114,80,59');
      SetObjectY(BO_PREFIX+"BridgePending", pendingY+4);
      SetObjectY(BO_PREFIX+"BridgeConfirm", pendingY);
      SetObjectY(BO_PREFIX+"BridgeCancel", pendingY);
      SetText(BO_PREFIX+"BridgePending",
              StringFormat("桥接待确认：%s 5单（剩余 %d 秒）", pendingDirection, secondsLeft));
      if(gSettingsExpanded)
         panelBottom=pendingY+28+8;
     }
   else
     {
      ObjectDelete(0, BO_PREFIX+"BridgePending");
      ObjectDelete(0, BO_PREFIX+"BridgeConfirm");
      ObjectDelete(0, BO_PREFIX+"BridgeCancel");
     }

   int panelHeight=panelBottom-BO_PANEL_Y;
   ObjectSetInteger(0, BO_PREFIX+"Background", OBJPROP_YSIZE, panelHeight);
   ChartRedraw();
  }

void SetStatus(string text)
  {
   gStatus=text;
   RefreshPanel();
  }

void CycleUnit(int &unit)
  {
   unit++;
   if(unit>BO_UNIT_PL)
      unit=BO_UNIT_PIPS;
  }

bool IsUnsignedNumber(string value, bool integerOnly)
  {
   value=StringTrimLeft(StringTrimRight(value));
   bool hasDigit=false;
   bool hasDot=false;
   for(int i=0; i<StringLen(value); i++)
     {
      int character=StringGetCharacter(value, i);
      if(character>='0' && character<='9')
        {
         hasDigit=true;
         continue;
        }
      if(!integerOnly && character=='.' && !hasDot)
        {
         hasDot=true;
         continue;
        }
      return(false);
     }
   return(hasDigit);
  }

void CommitNumericEdit(string objectName)
  {
   string text=ObjectGetString(0, objectName, OBJPROP_TEXT);
   if(objectName==BO_PREFIX+"TemplateName")
     {
      if(StringTrimLeft(StringTrimRight(text))!="")
         gTemplateName=StringTrimLeft(StringTrimRight(text));
      SavePanelState();
      RefreshPanel();
      return;
     }
   if(objectName==BO_PREFIX+"EntryPrice")
     {
      if(gOrderMode==0) return;
      if(!IsUnsignedNumber(text, false) || StrToDouble(text)<=0.0)
        { gPendingPrice=0.0; SavePanelState(); SetStatus("挂单价请输入大于 0 的有效价格"); return; }
      gPendingPrice=StrToDouble(text);
      SavePanelState();
      SetStatus("挂单价已设为 "+DoubleToString(gPendingPrice, Digits));
      return;
     }
   if(objectName==BO_PREFIX+"OrderCount")
     {
      if(!IsUnsignedNumber(text, true))
        {
         SetStatus("订单数请输入 1～10 的整数");
         return;
        }
      gOrderCount=ClampOrderCount(StrToInteger(text));
      SavePanelState();
      SetStatus(StringFormat("订单数已设为 %d", gOrderCount));
      return;
     }
   if(objectName==BO_PREFIX+"CandleAlertSeconds")
     {
      if(!IsUnsignedNumber(text, true))
        {
         SetStatus("提醒提前秒数请输入正整数");
         RefreshPanel();
         return;
        }
      int val=StrToInteger(text);
      if(val<=0)
        {
         SetStatus("提醒提前秒数必须大于0");
         RefreshPanel();
         return;
        }
      gCandleAlertSeconds=val;
      SavePanelState();
      SetStatus(StringFormat("K线提前提醒已设为 %d 秒", gCandleAlertSeconds));
      RefreshPanel();
      return;
     }
   if(objectName==BO_PREFIX+"SlippagePoints")
     {
      if(!IsUnsignedNumber(text, true))
        {
         SetStatus("滑点请输入非负整数（points）");
         return;
        }
      int value=StrToInteger(text);
      if(value<0)
        {
         SetStatus("滑点必须为非负整数（points）");
         RefreshPanel();
         return;
        }
      gSlippagePoints=value;
      SavePanelState();
      SetStatus(StringFormat("滑点已设为 %d points", gSlippagePoints));
      return;
     }
   if(objectName==BO_PREFIX+"BridgePollMilliseconds" ||
      objectName==BO_PREFIX+"BridgeOpenTtlSeconds" ||
      objectName==BO_PREFIX+"BridgeCloseTtlSeconds" ||
      objectName==BO_PREFIX+"BridgeConfirmSeconds")
     {
      if(!IsUnsignedNumber(text, true))
        {
         SetStatus("桥接时间请输入整数");
         return;
        }
      int value=StrToInteger(text);
      int candidatePoll=gBridgePollMilliseconds;
      int candidateOpenTtl=gBridgeOpenTtlSeconds;
      int candidateCloseTtl=gBridgeCloseTtlSeconds;
      int candidateConfirm=gBridgeConfirmSeconds;
      if(objectName==BO_PREFIX+"BridgePollMilliseconds") candidatePoll=value;
      else if(objectName==BO_PREFIX+"BridgeOpenTtlSeconds") candidateOpenTtl=value;
      else if(objectName==BO_PREFIX+"BridgeCloseTtlSeconds") candidateCloseTtl=value;
      else candidateConfirm=value;

      string error="";
      if(!BO_ValidBridgePanelSettings(gBridgeMode, candidatePoll, candidateOpenTtl,
                                      candidateCloseTtl, candidateConfirm, error))
        {
         if(objectName==BO_PREFIX+"BridgePollMilliseconds")
            SetStatus("轮询间隔必须为 10～1000 ms");
         else if(objectName==BO_PREFIX+"BridgeOpenTtlSeconds")
            SetStatus("开仓指令有效期必须为 1～300 秒");
         else if(objectName==BO_PREFIX+"BridgeCloseTtlSeconds")
            SetStatus("清仓指令有效期必须为 1～600 秒");
         else
            SetStatus("开仓确认时间必须为 1～300 秒");
         RefreshPanel();
         return;
        }

      bool pollChanged=(candidatePoll!=gBridgePollMilliseconds);
      gBridgePollMilliseconds=candidatePoll;
      gBridgeOpenTtlSeconds=candidateOpenTtl;
      gBridgeCloseTtlSeconds=candidateCloseTtl;
      gBridgeConfirmSeconds=candidateConfirm;
      SavePanelState();
      if(pollChanged && !RestartBridgeTimer(false))
        {
         SetStatus("桥接轮询定时器重启失败，请查看日志");
         return;
        }
      SetStatus("桥接运行设置已保存");
      return;
     }
   if(objectName==BO_PREFIX+"LotValue")
     {
      if(!IsUnsignedNumber(text, false))
        {
         SetStatus("手数/风险请输入数字");
         return;
        }
      double value=StrToDouble(text);
      if(!MathIsValidNumber(value) || value<0.0)
        {
         SetStatus("手数/风险输入必须为非负数字");
         RefreshPanel();
         return;
        }
      if(gLotMode==BO_LOTS_RISK)
        {
         if(value>0.0 && value<=100.0)
            gRiskPercent=value;
         else
           {
            SetStatus("风险百分比必须大于 0 且不超过 100");
            RefreshPanel();
            return;
           }
        }
      else
        {
         if(value<=0.0)
           {
            SetStatus("固定手数必须大于 0");
            RefreshPanel();
            return;
           }
           gFixedLots=value;
        }
      SavePanelState();
      RefreshPanel();
      return;
     }

   for(int i=0; i<BO_MAX_ROWS; i++)
     {
      int row=i+1;
       if(objectName!=RowObject(row, "SLValue") &&
          objectName!=RowObject(row, "TPValue"))
          continue;
       if(!IsUnsignedNumber(text, false))
         {
          SetStatus(StringFormat("第 %d 行 SL/TP 请输入非负数字", row));
          return;
         }
      double value=StrToDouble(text);
      if(!MathIsValidNumber(value) || value<0.0)
        {
         SetStatus(StringFormat("第 %d 行 SL/TP 必须为非负数字", row));
         RefreshPanel();
         return;
        }
      if(objectName==RowObject(row, "SLValue"))
         gSlValues[i]=value;
      else if(objectName==RowObject(row, "TPValue"))
         gTpValues[i]=value;
       SavePanelState();
       RefreshPanel();
       return;
     }
  }

void HandleClick(string objectName)
  {
   if(objectName==BO_PREFIX+"BridgeConfirm")
     {
      ConfirmPendingBridge();
      return;
     }
   if(objectName==BO_PREFIX+"BridgeCancel")
     {
      CancelPendingBridge("user cancelled");
      return;
     }
   if(objectName==BO_PREFIX+"SettingsToggle")
     {
      gSettingsExpanded=!gSettingsExpanded;
      SavePanelState();
      RefreshPanel();
      return;
     }
   if(objectName==BO_PREFIX+"PagePrev")
     {
      if(gRowPage>0)
         gRowPage--;
      RefreshPanel();
      return;
     }
   if(objectName==BO_PREFIX+"PageNext")
     {
      if((gRowPage+1)*BO_VISIBLE_ROWS<gOrderCount)
         gRowPage++;
      RefreshPanel();
      return;
     }
   if(objectName==BO_PREFIX+"AccountCloseToggle")
     {
      gEnableAccountWideClose=!gEnableAccountWideClose;
      SavePanelState();
      RefreshPanel();
      return;
     }
   if(objectName==BO_PREFIX+"ConfirmCloseToggle")
     {
      gConfirmClose=!gConfirmClose;
      SavePanelState();
      RefreshPanel();
      return;
     }
   if(objectName==BO_PREFIX+"CandleAlertToggle")
     {
      gCandleAlertEnabled=!gCandleAlertEnabled;
      SavePanelState();
      RefreshPanel();
      SetStatus(gCandleAlertEnabled ? "已开启K线结束提醒" : "已关闭K线结束提醒");
      return;
     }
   if(objectName==BO_PREFIX+"CandleAlertTest")
     {
      string tfStr=PeriodToString(Period());
      Alert(StringFormat("[%s, %s] 【测试】K线快结束提醒测试成功！", Symbol(), tfStr));
      SetStatus("【测试】已触发K线提醒并尝试置顶MT4窗口");
      BringMT4ToTop();
      return;
     }
   if(objectName==BO_PREFIX+"BridgeMode")
     {
      if(gBridgePending)
         CancelPendingBridge("bridge mode changed");
      int previousMode=gBridgeMode;
      gBridgeMode=BO_NextBridgeMode(gBridgeMode);
      SavePanelState();
      bool restoreLastEvent=(previousMode==BRIDGE_OFF && gBridgeMode!=BRIDGE_OFF);
      if(!RestartBridgeTimer(restoreLastEvent))
        {
         SetStatus("桥接模式切换失败：定时器无法启动");
         return;
        }
      SetStatus("桥接模式已设为 "+BridgeModeText());
      return;
     }
   if(objectName==BO_PREFIX+"OrderMode")
     {
      gOrderMode=(gOrderMode+1)%3;
      SavePanelState();
      RefreshPanel();
      return;
     }
   if(objectName==BO_PREFIX+"LotMode")
     {
      gLotMode=(gLotMode==BO_LOTS_FIXED ? BO_LOTS_RISK : BO_LOTS_FIXED);
      SavePanelState();
      RefreshPanel();
      return;
     }

   for(int i=0; i<BO_MAX_ROWS; i++)
     {
      int row=i+1;
      if(objectName==RowObject(row, "SLUnit"))
        {
         CycleUnit(gSlUnits[i]);
         SavePanelState();
         RefreshPanel();
         return;
        }
      if(objectName==RowObject(row, "TPUnit"))
        {
         CycleUnit(gTpUnits[i]);
         SavePanelState();
         RefreshPanel();
         return;
        }
     }

   if(objectName==BO_PREFIX+"Buy")
     {
      if(gOrderMode!=0) CommitNumericEdit(BO_PREFIX+"EntryPrice");
      ExecuteBatch(BO_EntryOrderType(OP_BUY, gOrderMode), 0, gPendingPrice);
      return;
     }
   if(objectName==BO_PREFIX+"Sell")
     {
      if(gOrderMode!=0) CommitNumericEdit(BO_PREFIX+"EntryPrice");
      ExecuteBatch(BO_EntryOrderType(OP_SELL, gOrderMode), 0, gPendingPrice);
      return;
     }
   if(objectName==BO_PREFIX+"ManagedClose")
     {
      CloseManagedOrders(false);
      return;
     }
   if(objectName==BO_PREFIX+"AccountClose" && gEnableAccountWideClose)
     {
      CloseManagedOrders(true);
      return;
     }
   if(objectName==BO_PREFIX+"SaveTemplate")
     {
      SaveCurrentTemplate();
      return;
     }
   if(objectName==BO_PREFIX+"LoadTemplate")
     {
      LoadSelectedTemplate();
      return;
     }
  }

bool LoadSymbolInfo(BOSymbolInfo &info, string &error)
  {
   error="";
   info.digits=(int)MarketInfo(Symbol(), MODE_DIGITS);
   info.point=MarketInfo(Symbol(), MODE_POINT);
   info.tickSize=MarketInfo(Symbol(), MODE_TICKSIZE);
   info.tickValue=MarketInfo(Symbol(), MODE_TICKVALUE);
   info.minLot=MarketInfo(Symbol(), MODE_MINLOT);
   info.maxLot=MarketInfo(Symbol(), MODE_MAXLOT);
   info.lotStep=MarketInfo(Symbol(), MODE_LOTSTEP);
   info.stopLevelPoints=(int)MarketInfo(Symbol(), MODE_STOPLEVEL);
   info.freezeLevelPoints=(int)MarketInfo(Symbol(), MODE_FREEZELEVEL);

   if(info.digits<0 || info.point<=0.0 || info.tickSize<=0.0 || info.tickValue<=0.0 ||
      info.minLot<=0.0 || info.maxLot<=0.0 || info.lotStep<=0.0)
     {
      error="broker returned incomplete symbol trading data";
      return(false);
     }
   return(true);
  }

string TradeErrorText(int errorCode)
  {
   if(errorCode==ERR_SERVER_BUSY)
      return("trade server busy");
   if(errorCode==ERR_INVALID_STOPS)
      return("invalid stops");
   if(errorCode==ERR_INVALID_TRADE_VOLUME)
      return("invalid trade volume");
   if(errorCode==ERR_NOT_ENOUGH_MONEY)
      return("not enough margin");
   if(errorCode==ERR_MARKET_CLOSED)
      return("market closed");
   if(errorCode==ERR_TRADE_DISABLED)
      return("trading disabled");
   if(errorCode==ERR_TRADE_CONTEXT_BUSY)
      return("trade context busy");
   if(errorCode==ERR_REQUOTE)
      return("requote");
   if(errorCode==ERR_OFF_QUOTES)
      return("off quotes");
   if(errorCode==ERR_TRADE_TIMEOUT)
      return("trade timeout");
   return(StringFormat("MT4 error %d", errorCode));
  }

bool BO_TradeErrorRetryable(int errorCode)
  {
   return(errorCode==ERR_SERVER_BUSY || errorCode==ERR_TRADE_CONTEXT_BUSY ||
          errorCode==ERR_REQUOTE || errorCode==ERR_OFF_QUOTES);
  }

void BO_TradeRetrySleep(int attempt)
  {
   if(attempt<BO_TRADE_MAX_ATTEMPTS)
      Sleep(BO_TRADE_RETRY_DELAY_MS*attempt);
   RefreshRates();
  }

void AppendDetail(string &details, string item)
  {
   if(details!="")
      details+=" | ";
   details+=item;
  }

bool SendPlannedOrder(int orderType, BOOrderPlan &plan, string &result)
  {
   result="";
   if(!plan.valid)
     {
      result="invalid order plan";
      return(false);
     }

   double price=0.0;
   int ticket=-1;
   int errorCode=0;
   for(int attempt=1; attempt<=BO_TRADE_MAX_ATTEMPTS; attempt++)
     {
      RefreshRates();
      price=BO_IsMarketOrder(orderType) ? (orderType==OP_BUY ? Ask : Bid) : plan.referencePrice;
      if(price<=0.0)
        {
         result="market price unavailable";
         return(false);
        }
      if(!BO_IsMarketOrder(orderType))
        {
         BOSymbolInfo currentInfo;
         string validation="";
         if(!LoadSymbolInfo(currentInfo, validation) ||
            !BO_ValidatePendingPrice(orderType, Bid, Ask, price, currentInfo, validation) ||
            !BO_ValidatePlanStops(orderType, Bid, Ask, plan, currentInfo, validation))
           { result="pending order rejected: "+validation; return(false); }
        }
      price=NormalizeDouble(price, Digits);

      ResetLastError();
      ticket=OrderSend(Symbol(), orderType, plan.lots, price, gSlippagePoints,
                       plan.slPrice, plan.tpPrice, "BatchOrderPanel", gMagicNumber, 0, clrNONE);
      errorCode=GetLastError();
      if(ticket>=0)
         break;
      if(errorCode==ERR_INVALID_STOPS || !BO_TradeErrorRetryable(errorCode) ||
         attempt>=BO_TRADE_MAX_ATTEMPTS)
         break;
      BO_TradeRetrySleep(attempt);
     }
   if(ticket>=0)
     {
      result=StringFormat("ticket %d opened", ticket);
      return(true);
     }

   if(!BO_IsMarketOrder(orderType) || errorCode!=ERR_INVALID_STOPS || (plan.slPrice<=0.0 && plan.tpPrice<=0.0))
     {
      result=StringFormat("send failed: %s", TradeErrorText(errorCode));
      return(false);
     }

   // ECN brokers reject an initial market order when SL/TP are attached.  In
   // that case send an unprotected order, then attach the requested protection.
   ticket=-1;
   for(int fallbackAttempt=1; fallbackAttempt<=BO_TRADE_MAX_ATTEMPTS; fallbackAttempt++)
     {
      RefreshRates();
      price=(orderType==OP_BUY ? Ask : Bid);
      if(price<=0.0)
        {
         result="ECN fallback market price unavailable";
         return(false);
        }
      price=NormalizeDouble(price, Digits);
      ResetLastError();
      ticket=OrderSend(Symbol(), orderType, plan.lots, price, gSlippagePoints,
                       0.0, 0.0, "BatchOrderPanel", gMagicNumber, 0, clrNONE);
      errorCode=GetLastError();
      if(ticket>=0)
         break;
      if(!BO_TradeErrorRetryable(errorCode) || fallbackAttempt>=BO_TRADE_MAX_ATTEMPTS)
         break;
      BO_TradeRetrySleep(fallbackAttempt);
     }
   if(ticket<0)
     {
      result=StringFormat("ECN fallback send failed: %s", TradeErrorText(errorCode));
      return(false);
     }

   if(!OrderSelect(ticket, SELECT_BY_TICKET))
     {
      result=StringFormat("ticket %d opened but could not be selected; unprotected", ticket);
      return(true);
     }

   bool modified=false;
   for(int modifyAttempt=1; modifyAttempt<=BO_TRADE_MAX_ATTEMPTS; modifyAttempt++)
     {
      ResetLastError();
      modified=OrderModify(ticket, OrderOpenPrice(), plan.slPrice, plan.tpPrice, 0, clrNONE);
      errorCode=GetLastError();
      if(modified)
         break;
      if(!BO_TradeErrorRetryable(errorCode) || modifyAttempt>=BO_TRADE_MAX_ATTEMPTS)
         break;
      BO_TradeRetrySleep(modifyAttempt);
     }
   if(!modified)
     {
      result=StringFormat("ticket %d opened but protection failed: %s; unprotected",
                          ticket, TradeErrorText(errorCode));
      return(true);
     }

   result=StringFormat("ticket %d opened via ECN fallback", ticket);
   return(true);
  }

bool ExecuteBatch(int orderType, int orderCountOverride=0, double pendingPrice=0.0)
  {
   gLastExecutionDetails="";
   int executionCount=orderCountOverride>0 ? ClampOrderCount(orderCountOverride) : gOrderCount;
   if(!IsTradeAllowed())
     {
      gLastExecutionDetails="trading is not allowed; check AutoTrading and account permissions";
      SetStatus("交易未获许可：请检查 AutoTrading 和账户交易权限");
      return(false);
     }
   if(MarketInfo(Symbol(), MODE_TRADEALLOWED)<=0.0)
     {
      gLastExecutionDetails="symbol trading is disabled";
      SetStatus("当前品种暂不允许交易");
      return(false);
     }

   BOSymbolInfo info;
   string error="";
   if(!LoadSymbolInfo(info, error))
     {
      gLastExecutionDetails=error;
      SetStatus("无法读取品种交易参数："+error);
      return(false);
     }

   BOOrderSpec specs[BO_MAX_ROWS];
   BOOrderPlan plans[BO_MAX_ROWS];
   for(int i=0; i<executionCount; i++)
     {
      specs[i].slUnit=gSlUnits[i];
      specs[i].slValue=gSlValues[i];
      specs[i].tpUnit=gTpUnits[i];
      specs[i].tpValue=gTpValues[i];
     }

   RefreshRates();
   if(!BO_ComputeBatchPlans(orderType, Bid, Ask, AccountEquity(), gLotMode,
                           gFixedLots, gRiskPercent, executionCount, specs, info, plans, error, pendingPrice))
     {
      gLastExecutionDetails=error;
      SetStatus("未下单："+error);
      return(false);
     }

   int opened=0;
   int failed=0;
   int unprotected=0;
   string details="";
   int batchLogin=AccountNumber();
   string batchServer=AccountServer();
   for(int row=0; row<executionCount; row++)
     {
      if(!BO_IsMarketOrder(orderType) &&
         (AccountNumber()!=batchLogin || AccountServer()!=batchServer || !IsConnected() || !IsTradeAllowed()))
        {
         AppendDetail(details, StringFormat("stopped; %d orders not sent: account or trading connection changed", executionCount-row));
         break;
        }
      string result="";
      if(SendPlannedOrder(orderType, plans[row], result))
        {
         opened++;
         if(StringFind(result, "unprotected")>=0)
            unprotected++;
        }
      else
         failed++;
      AppendDetail(details, StringFormat("#%d %s", row+1, result));
      if(!BO_IsMarketOrder(orderType) && failed>0)
        {
         AppendDetail(details, StringFormat("stopped; %d orders not sent", executionCount-row-1));
         break;
        }
      if(row+1<executionCount)
         Sleep(BO_BATCH_ORDER_SPACING_MS);
     }

   gLastExecutionDetails=details;
   SetStatus(StringFormat("%s 完成：成功 %d，失败 %d，未保护 %d；%s",
                           BO_IsBuyOrder(orderType) ? "Buy" : "Sell", opened, failed,
                           unprotected, details));
   return(opened==executionCount && failed==0 && unprotected==0);
  }

bool ConfirmClose(bool accountWide)
  {
   if(!gConfirmClose)
      return(true);
   string scope=accountWide ? "全账户所有市价单" : "当前品种且 Magic 匹配的 EA 市价单";
   int answer=MessageBox("确定要平掉"+scope+"吗？", "确认全平", MB_YESNO|MB_ICONWARNING);
   return(answer==IDYES);
  }

bool CloseManagedOrders(bool accountWide, bool skipConfirmation=false)
  {
   gLastCloseDetails="";
   if(accountWide && !gEnableAccountWideClose)
     {
      gLastCloseDetails="account-wide close is disabled";
      SetStatus("全账户全平未启用");
      return(false);
     }
    if(!skipConfirmation && !ConfirmClose(accountWide))
     {
      gLastCloseDetails="close confirmation was cancelled";
      SetStatus("已取消全平");
      return(false);
     }

   int selected=0;
   int closed=0;
   int failed=0;
   string details="";
   for(int pos=OrdersTotal()-1; pos>=0; pos--)
     {
      if(!OrderSelect(pos, SELECT_BY_POS, MODE_TRADES))
         continue;
      int orderType=OrderType();
      string orderSymbol=OrderSymbol();
      int orderMagic=OrderMagicNumber();
      if(!BO_ShouldCloseOrder(orderType, orderSymbol, orderMagic, Symbol(), gMagicNumber, accountWide))
         continue;

      int ticket=OrderTicket();
      double lots=OrderLots();
      selected++;
      bool result=false;
      int errorCode=0;
      for(int closeAttempt=1; closeAttempt<=BO_TRADE_MAX_ATTEMPTS; closeAttempt++)
        {
         RefreshRates();
         double closePrice=MarketInfo(orderSymbol, orderType==OP_BUY ? MODE_BID : MODE_ASK);
         if(closePrice<=0.0)
           {
            errorCode=GetLastError();
            if(errorCode==0)
               errorCode=ERR_OFF_QUOTES;
           }
         else
           {
            ResetLastError();
            result=OrderClose(ticket, lots, closePrice, gSlippagePoints, clrNONE);
            errorCode=GetLastError();
           }
         if(result)
            break;
         if(!BO_TradeErrorRetryable(errorCode) || closeAttempt>=BO_TRADE_MAX_ATTEMPTS)
            break;
         BO_TradeRetrySleep(closeAttempt);
        }

      // A close can be accepted by the trade server even when the terminal
      // receives a transient error.  Inspect the live pool before reporting
      // failure so the bridge does not claim a still-open position is flat.
      bool remainsOpen=false;
      for(int check=OrdersTotal()-1; check>=0; check--)
        {
         if(!OrderSelect(check, SELECT_BY_POS, MODE_TRADES))
            continue;
         if(OrderTicket()==ticket)
           {
            remainsOpen=true;
            break;
           }
        }
      // The live order pool is the source of truth.  Even a successful
      // OrderClose response is not enough if the ticket is still open.
      if(!remainsOpen)
         closed++;
      else
        {
         failed++;
         AppendDetail(details, StringFormat("ticket %d: %s", ticket, TradeErrorText(errorCode)));
        }
      if(closed>0 && pos>0)
         Sleep(BO_BATCH_ORDER_SPACING_MS);
     }

   if(selected==0)
     {
      gLastCloseDetails="no managed market orders found";
      SetStatus(accountWide ? "全账户没有可平的市价单" : "没有找到本 EA 的当前品种市价单");
     }
   else
     {
      if(details=="")
         details="all selected orders closed";
      gLastCloseDetails=details;
      SetStatus(StringFormat("%s：找到 %d，成功 %d，失败 %d；%s",
                             accountWide ? "全账户全平" : "本EA全平", selected,
                             closed, failed, details));
     }
   return(failed==0);
  }

int BridgeManagedDirection()
  {
   int buyCount=0;
   int sellCount=0;
   for(int pos=OrdersTotal()-1; pos>=0; pos--)
     {
      if(!OrderSelect(pos, SELECT_BY_POS, MODE_TRADES))
         continue;
      int orderType=OrderType();
      if(!BO_IsManagedMarketOrder(orderType, OrderSymbol(), OrderMagicNumber(),
                                  Symbol(), gMagicNumber))
         continue;
      if(orderType==OP_BUY)
         buyCount++;
      else if(orderType==OP_SELL)
         sellCount++;
     }
   return(BO_BridgePositionDirection(buyCount, sellCount));
  }

void RememberBridgeEvent(BOBridgeCommand &command, string result, string reason)
  {
   if(!BO_WriteBridgeAck(command.eventId, result, reason))
      Print("MT4 bridge ACK write failed for ", command.eventId);
   if(!BO_WriteLastEventId(command.eventId))
      Print("MT4 bridge last-event write failed for ", command.eventId);
   // Keep the in-memory dedupe marker even if the terminal cannot write the
   // Common Files marker.  This prevents a busy timer from repeating a trade.
   gBridgeLastEventId=command.eventId;
  }

void CancelPendingBridge(string reason)
  {
   if(!gBridgePending)
      return;
   BOBridgeCommand command=gPendingBridgeCommand;
   gBridgePending=false;
   gBridgePendingExpires=0;
   gBridgeLastPendingSecond=-1;
   RememberBridgeEvent(command, "REJECTED", reason);
   SetStatus("桥接开仓已取消："+reason);
  }

bool CloseBridgePosition(string reason)
  {
   int before=BridgeManagedDirection();
   if(before==-1)
     {
      gLastCloseDetails="already flat";
      return(true);
     }

   CloseManagedOrders(false, true);
   int after=BridgeManagedDirection();
   if(after!=-1)
     {
      if(gLastCloseDetails=="")
         gLastCloseDetails="managed position remains";
      SetStatus("桥接"+reason+"失败：仍有本 EA 仓位未平");
      return(false);
     }
   // The desired state is authoritative: a transient terminal error may be
   // returned after the broker has already completed the close.
   return(true);
  }

void ConfirmPendingBridge()
  {
   if(!gBridgePending)
      return;

   BOBridgeCommand command=gPendingBridgeCommand;
   if(TimeLocal()>=gBridgePendingExpires)
     {
      gBridgePending=false;
      gBridgePendingExpires=0;
      gBridgeLastPendingSecond=-1;
      RememberBridgeEvent(command, "EXPIRED", "confirmation timeout");
      SetStatus("桥接开仓确认已超时");
      return;
     }

   int orderType=BO_BridgeOrderType(command.direction);
   if(orderType!=OP_BUY && orderType!=OP_SELL)
     {
      gBridgePending=false;
      gBridgePendingExpires=0;
      gBridgeLastPendingSecond=-1;
      RememberBridgeEvent(command, "REJECTED", "invalid direction");
      SetStatus("桥接开仓拒绝：方向无效");
      return;
     }

   int current=BridgeManagedDirection();
   if(current==orderType)
     {
      gBridgePending=false;
      gBridgePendingExpires=0;
      gBridgeLastPendingSecond=-1;
      RememberBridgeEvent(command, "IGNORED", "same direction already open");
      SetStatus("桥接开仓忽略：同方向仓位已存在");
      return;
     }
   if(current!=-1 && !CloseBridgePosition("反向切换"))
     {
      gBridgePending=false;
      gBridgePendingExpires=0;
      gBridgeLastPendingSecond=-1;
      string closeReason="existing position could not be closed";
      if(gLastCloseDetails!="")
         closeReason+=": "+gLastCloseDetails;
      RememberBridgeEvent(command, "FAILED", closeReason);
      return;
     }

    bool opened=ExecuteBatch(orderType, 5);
    string openReason="batch execution failed";
    if(opened)
       openReason="confirmed five-order batch";
    else if(gLastExecutionDetails!="")
       openReason+=": "+gLastExecutionDetails;
    gBridgePending=false;
    gBridgePendingExpires=0;
    gBridgeLastPendingSecond=-1;
    RememberBridgeEvent(command, opened ? "EXECUTED" : "FAILED",
                        openReason);
   if(opened)
      SetStatus(StringFormat("桥接开仓已确认执行：%s 5 单", command.direction));
   else
      SetStatus("桥接开仓执行失败，请查看交易日志");
  }

void ExpirePendingBridge()
  {
   if(!gBridgePending || TimeLocal()<gBridgePendingExpires)
      return;
   BOBridgeCommand command=gPendingBridgeCommand;
   gBridgePending=false;
   gBridgePendingExpires=0;
   gBridgeLastPendingSecond=-1;
   RememberBridgeEvent(command, "EXPIRED", "confirmation timeout");
   SetStatus("桥接开仓确认已超时");
  }

void ProcessBridgeCommand()
  {
   if(gBridgeMode==BRIDGE_OFF)
      return;
   if(gBridgeMode!=BRIDGE_CONFIRM && gBridgeMode!=BRIDGE_DEMO_AUTO)
      return;

   BOBridgeCommand command;
   string error="";
   if(!BO_ReadBridgeCommand(command, error))
     {
      if(error!="" && error!=gBridgeLastReadError)
        {
         gBridgeLastReadError=error;
         Print("MT4 bridge command ignored: ", error);
        }
      return;
     }
   gBridgeLastReadError="";

   if(!BO_IsNewEvent(command.eventId, gBridgeLastEventId))
      return;
   if(BO_IsCommandExpired(command, BO_BridgeNowMs(),
                          gBridgeOpenTtlSeconds, gBridgeCloseTtlSeconds))
     {
      RememberBridgeEvent(command, "EXPIRED", "command TTL elapsed");
      SetStatus("桥接指令已过期，未执行");
      return;
     }

   if(gBridgePending && command.eventId!=gPendingBridgeCommand.eventId)
      CancelPendingBridge("superseded by newer signal");

   if(command.action==BO_BRIDGE_CLOSE)
     {
      bool closeResult=CloseBridgePosition("清仓");
      string closeReason="managed position remains";
      if(closeResult)
         closeReason="managed position closed or already flat";
      else if(gLastCloseDetails!="")
         closeReason+=": "+gLastCloseDetails;
      RememberBridgeEvent(command, closeResult ? "EXECUTED" : "FAILED",
                          closeReason);
      if(closeResult)
         SetStatus("桥接清仓已执行");
      return;
     }

   int requestedType=BO_BridgeOrderType(command.direction);
   if(requestedType!=OP_BUY && requestedType!=OP_SELL)
     {
      RememberBridgeEvent(command, "REJECTED", "invalid direction");
      SetStatus("桥接开仓拒绝：方向无效");
      return;
     }

   // BRIDGE_DEMO_AUTO is deliberately hard-gated to a demo account.  A
   // mistaken panel selection on a live account can never turn an OCR event into a
   // live unattended order.
   if(gBridgeMode==BRIDGE_DEMO_AUTO && !IsDemo())
     {
      RememberBridgeEvent(command, "REJECTED", "demo-auto is blocked on live account");
      SetStatus("桥接自动开仓已拒绝：当前不是模拟账户");
      return;
     }

   int current=BridgeManagedDirection();
   if(current==requestedType)
     {
      RememberBridgeEvent(command, "IGNORED", "same direction already open");
      SetStatus("桥接开仓忽略：同方向仓位已存在");
      return;
     }
   if(current!=-1 && !CloseBridgePosition("反向切换"))
     {
      string closeReason="existing position could not be closed";
      if(gLastCloseDetails!="")
         closeReason+=": "+gLastCloseDetails;
      RememberBridgeEvent(command, "FAILED", closeReason);
      return;
     }

   if(gBridgeMode==BRIDGE_CONFIRM)
     {
      gPendingBridgeCommand=command;
      gBridgePending=true;
       gSettingsExpanded=false;
      gBridgeLastPendingSecond=-1;
      int confirmSeconds=gBridgeConfirmSeconds;
      gBridgePendingExpires=TimeLocal()+confirmSeconds;
       SavePanelState();
      RememberBridgeEvent(command, "PENDING", "manual confirmation required");
      SetStatus(StringFormat("桥接待确认：%s 5 单，%d 秒内点击确认",
                             command.direction, confirmSeconds));
      return;
     }

   bool opened=ExecuteBatch(requestedType, 5);
   string openReason="batch execution failed";
   if(opened)
      openReason="automatic five-order batch";
   else if(gLastExecutionDetails!="")
      openReason+=": "+gLastExecutionDetails;
   RememberBridgeEvent(command, opened ? "EXECUTED" : "FAILED",
                       openReason);
   if(opened)
      SetStatus(StringFormat("桥接自动开仓已执行：%s 5 单", command.direction));
   else
      SetStatus("桥接自动开仓失败，请查看交易日志");
  }

void SaveCurrentTemplate()
  {
   string name=ObjectGetString(0, BO_PREFIX+"TemplateName", OBJPROP_TEXT);
   name=StringTrimLeft(StringTrimRight(name));
   if(name=="")
     {
      SetStatus("模板保存失败：请输入模板名称");
      return;
     }

   string error="";
   if(!BO_SaveTemplate(name, Symbol(), gOrderCount, gLotMode, gFixedLots, gRiskPercent,
                       gSlUnits, gSlValues, gTpUnits, gTpValues, error))
     {
      SetStatus("模板保存失败："+error);
      return;
     }
   gTemplateName=name;
   SavePanelState();
   SetStatus("模板已保存："+name);
  }

void LoadSelectedTemplate()
  {
   string name=ObjectGetString(0, BO_PREFIX+"TemplateName", OBJPROP_TEXT);
   name=StringTrimLeft(StringTrimRight(name));
   if(name=="")
     {
      SetStatus("模板加载失败：请输入模板名称");
      return;
     }

   int loadedCount=0;
   int loadedMode=BO_LOTS_FIXED;
   double loadedFixedLots=0.0;
   double loadedRiskPercent=0.0;
   int loadedSlUnits[BO_MAX_ROWS];
   int loadedTpUnits[BO_MAX_ROWS];
   double loadedSlValues[BO_MAX_ROWS];
   double loadedTpValues[BO_MAX_ROWS];
   string savedSymbol="";
   string warning="";
   string error="";
   if(!BO_LoadTemplate(name, Symbol(), savedSymbol, loadedCount, loadedMode,
                       loadedFixedLots, loadedRiskPercent, loadedSlUnits, loadedSlValues,
                       loadedTpUnits, loadedTpValues, warning, error))
     {
      SetStatus("模板加载失败："+error);
      return;
     }

   gOrderCount=ClampOrderCount(loadedCount);
   gLotMode=loadedMode;
   gFixedLots=loadedFixedLots;
   gRiskPercent=loadedRiskPercent;
   for(int i=0; i<BO_MAX_ROWS; i++)
     {
      gSlUnits[i]=loadedSlUnits[i];
      gSlValues[i]=loadedSlValues[i];
      gTpUnits[i]=loadedTpUnits[i];
      gTpValues[i]=loadedTpValues[i];
     }
   gTemplateName=name;
   SavePanelState();
   string message="模板已加载："+name;
   if(warning!="")
     message+="；"+warning;
   SetStatus(message);
  }

bool RestartBridgeTimer(bool restoreLastEvent)
  {
   EventKillTimer();
   int interval=250; // 默认 250ms 用于保证K线提醒及时与UI刷新
   if(gBridgeMode!=BRIDGE_OFF)
     {
      BO_BridgeEnsureFolder();
      if(restoreLastEvent)
         gBridgeLastEventId=BO_ReadLastEventId();
      interval=gBridgePollMilliseconds;
      if(interval<=0)
         interval=50;
      if(interval>250)
         interval=250;
      Print("MT4 bridge active: mode ", gBridgeMode,
            ", polling Common Files every ", interval, " ms");
     }

   if(InpKLineConnection) interval = MathMin(interval, 100);
   if(!EventSetMillisecondTimer(interval))
     {
      Print("Timer could not start; requested ", interval, " ms");
      return(false);
     }
   return(true);
  }

int OnInit()
  {
   InitializeState();
   RestorePanelState();
   CreatePanel();
   RefreshPanel();
   gBridgePending=false;
   gBridgePendingExpires=0;
   gBridgeLastPendingSecond=-1;
   if(!RestartBridgeTimer(true))
     {
      SetStatus("定时器启动失败");
     }
   if(!KLC_Start()) SetStatus(KLC_connectionError);
   return(INIT_SUCCEEDED);
  }

void OnDeinit(const int reason)
  {
   KLC_Stop();
   EventKillTimer();
   SavePanelState();
   for(int i=ObjectsTotal(0, -1, -1)-1; i>=0; i--)
     {
      string name=ObjectName(0, i);
      if(StringFind(name, BO_PREFIX)==0)
         ObjectDelete(0, name);
     }
  }

void OnTick()
  {
   CheckCandleAlert();
  }

void OnTimer()
  {
   bool connectionWasReady = KLC_ready;
   KLC_Pump();
   if(!connectionWasReady && KLC_ready) SetStatus("连接已准备，请在训练营验证连接");
   static uint panelTimerAt = 0;
   uint panelNow = GetTickCount();
   int panelInterval = gBridgeMode == BRIDGE_OFF ? 250 : gBridgePollMilliseconds;
   if(panelInterval <= 0) panelInterval = 50;
   if(panelInterval > 250) panelInterval = 250;
   if(panelTimerAt != 0 && (uint)(panelNow - panelTimerAt) < (uint)panelInterval) return;
   panelTimerAt = panelNow;
   CheckCandleAlert();

   if(gBridgeMode==BRIDGE_OFF)
      return;
   ExpirePendingBridge();
   ProcessBridgeCommand();
   if(gBridgePending)
     {
      int secondsLeft=(int)(gBridgePendingExpires-TimeLocal());
      if(secondsLeft<0)
         secondsLeft=0;
      if(secondsLeft!=gBridgeLastPendingSecond)
        {
         gBridgeLastPendingSecond=secondsLeft;
         SetText(BO_PREFIX+"BridgePending",
                 StringFormat("桥接待确认：%s 5单（剩余 %d 秒）",
                              gPendingBridgeCommand.direction, secondsLeft));
         ChartRedraw();
        }
     }
  }

void OnChartEvent(const int id, const long &lparam, const double &dparam, const string &sparam)
  {
   if(id==CHARTEVENT_OBJECT_CLICK)
     {
      if(ObjectFind(0, sparam)>=0 &&
         ObjectGetInteger(0, sparam, OBJPROP_TYPE)==OBJ_BUTTON)
         ObjectSetInteger(0, sparam, OBJPROP_STATE, false);
      HandleClick(sparam);
     }
   else if(id==CHARTEVENT_OBJECT_ENDEDIT)
      CommitNumericEdit(sparam);
  }

int KLC_GetPanelMagic() { return gMagicNumber; }
