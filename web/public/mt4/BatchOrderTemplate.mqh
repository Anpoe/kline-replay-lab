#ifndef __BATCH_ORDER_TEMPLATE_MQH__
#define __BATCH_ORDER_TEMPLATE_MQH__

#include "BatchOrderMath.mqh"
#include "BatchOrderBridge.mqh"

const int BO_TEMPLATE_VERSION = 1;
string BO_TEMPLATE_FOLDER = "BatchOrderPanelTemplates";

string BO_SanitizeTemplateName(string name)
  {
   name=StringTrimLeft(StringTrimRight(name));
   string sanitized="";
   for(int i=0; i<StringLen(name); i++)
     {
      int code=StringGetCharacter(name, i);
      if((code>=48 && code<=57) ||
         (code>=65 && code<=90) ||
         (code>=97 && code<=122) ||
         code==45 || code==46 || code==95)
         sanitized+=StringSubstr(name, i, 1);
     }
   return(sanitized);
  }

string BO_TemplatePath(string name)
  {
   string safeName=BO_SanitizeTemplateName(name);
   if(safeName=="")
      return("");
   return(BO_TEMPLATE_FOLDER+"\\"+safeName+".tpl");
  }

bool BO_ValidTemplateRows(int orderCount, int lotMode, double fixedLots, double riskPercent,
                          int &slUnits[], double &slValues[], int &tpUnits[], double &tpValues[],
                          string &error)
  {
   error="";
   if(orderCount<1 || orderCount>BO_MAX_ROWS)
     {
      error="template order count must be between 1 and 10";
      return(false);
     }
   if(lotMode!=BO_LOTS_FIXED && lotMode!=BO_LOTS_RISK)
     {
      error="template lot mode is invalid";
      return(false);
     }
   if(fixedLots<0.0 || riskPercent<0.0)
     {
      error="template lot values cannot be negative";
      return(false);
     }

   for(int i=0; i<BO_MAX_ROWS; i++)
     {
      if(!BO_IsSupportedUnit(slUnits[i]) || !BO_IsSupportedUnit(tpUnits[i]))
        {
         error=StringFormat("template row %d has an invalid unit", i+1);
         return(false);
        }
      if(slValues[i]<0.0 || tpValues[i]<0.0 ||
         !MathIsValidNumber(slValues[i]) || !MathIsValidNumber(tpValues[i]))
        {
         error=StringFormat("template row %d has a negative or invalid value", i+1);
         return(false);
        }
     }
   return(true);
  }

bool BO_SaveTemplate(string name, string symbol, int orderCount, int lotMode, double fixedLots,
                     double riskPercent, int &slUnits[], double &slValues[], int &tpUnits[],
                     double &tpValues[], string &error)
  {
   error="";
   string path=BO_TemplatePath(name);
   if(path=="")
     {
      error="template name must contain letters, numbers, dot, dash, or underscore";
      return(false);
     }
   if(symbol=="")
     {
      error="template symbol cannot be empty";
      return(false);
     }
   if(!BO_ValidTemplateRows(orderCount, lotMode, fixedLots, riskPercent,
                            slUnits, slValues, tpUnits, tpValues, error))
      return(false);

   ResetLastError();
   FolderCreate(BO_TEMPLATE_FOLDER, FILE_COMMON);

   ResetLastError();
   int handle=INVALID_HANDLE;
   for(int attempt=0; attempt<5; attempt++)
     {
      handle=FileOpen(path, FILE_CSV|FILE_WRITE|FILE_ANSI|FILE_COMMON|FILE_SHARE_READ|FILE_SHARE_WRITE, ';');
      if(handle!=INVALID_HANDLE)
         break;
      Sleep(20);
     }
   if(handle==INVALID_HANDLE)
     {
      error=StringFormat("cannot open template for writing, error %d", GetLastError());
      return(false);
     }

   FileWrite(handle, "version", BO_TEMPLATE_VERSION);
   FileWrite(handle, "symbol", symbol);
   FileWrite(handle, "orderCount", orderCount);
   FileWrite(handle, "lotMode", lotMode);
   FileWrite(handle, "fixedLots", DoubleToString(fixedLots, 8));
   FileWrite(handle, "riskPercent", DoubleToString(riskPercent, 8));

   for(int i=0; i<BO_MAX_ROWS; i++)
     {
      FileWrite(handle, StringFormat("row%d.slUnit", i+1), slUnits[i]);
      FileWrite(handle, StringFormat("row%d.slValue", i+1), DoubleToString(slValues[i], 8));
      FileWrite(handle, StringFormat("row%d.tpUnit", i+1), tpUnits[i]);
      FileWrite(handle, StringFormat("row%d.tpValue", i+1), DoubleToString(tpValues[i], 8));
     }

   FileClose(handle);
   return(true);
  }

// Overload for backward compatibility (without candle alert parameters)
bool BO_SavePanelState(string stateKey, string symbol, int orderCount, int lotMode,
                       double fixedLots, double riskPercent, int slippagePoints,
                       bool accountWideClose, bool confirmClose, bool settingsExpanded,
                       int bridgeMode, int bridgePollMilliseconds,
                       int bridgeOpenTtlSeconds, int bridgeCloseTtlSeconds,
                       int bridgeConfirmSeconds,
                       string templateName, int &slUnits[], double &slValues[],
                       int &tpUnits[], double &tpValues[], string &error)
  {
   return(BO_SavePanelState(stateKey, symbol, orderCount, lotMode, fixedLots, riskPercent, slippagePoints,
                            accountWideClose, confirmClose, settingsExpanded,
                            bridgeMode, bridgePollMilliseconds, bridgeOpenTtlSeconds,
                            bridgeCloseTtlSeconds, bridgeConfirmSeconds,
                            true, 10,
                            templateName, slUnits, slValues, tpUnits, tpValues, error));
  }

// Overload for older version without bridge parameters
bool BO_SavePanelState(string stateKey, string symbol, int orderCount, int lotMode,
                       double fixedLots, double riskPercent, int slippagePoints,
                       bool accountWideClose, bool confirmClose, bool settingsExpanded,
                       string templateName, int &slUnits[], double &slValues[],
                       int &tpUnits[], double &tpValues[], string &error)
  {
   return(BO_SavePanelState(stateKey, symbol, orderCount, lotMode, fixedLots, riskPercent, slippagePoints,
                            accountWideClose, confirmClose, settingsExpanded,
                            BRIDGE_OFF, 50, 5, 30, 15,
                            true, 10,
                            templateName, slUnits, slValues, tpUnits, tpValues, error));
  }

bool BO_LoadTemplate(string name, string currentSymbol, string &savedSymbol, int &orderCount,
                     int &lotMode, double &fixedLots, double &riskPercent, int &slUnits[],
                     double &slValues[], int &tpUnits[], double &tpValues[], string &warning,
                     string &error)
  {
   savedSymbol="";
   warning="";
   error="";
   orderCount=0;
   lotMode=BO_LOTS_FIXED;
   fixedLots=0.0;
   riskPercent=0.0;

   for(int i=0; i<BO_MAX_ROWS; i++)
     {
      slUnits[i]=BO_UNIT_PIPS;
      slValues[i]=0.0;
      tpUnits[i]=BO_UNIT_PIPS;
      tpValues[i]=0.0;
     }

   string path=BO_TemplatePath(name);
   if(path=="")
     {
      error="template name must contain letters, numbers, dot, dash, or underscore";
      return(false);
     }

   if(!FileIsExist(path, FILE_COMMON))
     {
      error="template file does not exist";
      return(false);
     }

   ResetLastError();
   int handle=INVALID_HANDLE;
   for(int attempt=0; attempt<5; attempt++)
     {
      handle=FileOpen(path, FILE_CSV|FILE_READ|FILE_ANSI|FILE_COMMON|FILE_SHARE_READ|FILE_SHARE_WRITE, ';');
      if(handle!=INVALID_HANDLE)
         break;
      Sleep(20);
     }
   if(handle==INVALID_HANDLE)
     {
      error=StringFormat("cannot open template for reading, error %d", GetLastError());
      return(false);
     }

   int version=0;
   bool hasVersion=false;
   bool hasSymbol=false;
   bool hasCount=false;
   bool hasLotMode=false;
   bool hasFixedLots=false;
   bool hasRiskPercent=false;
   int hasSlUnit[10];
   int hasSlValue[10];
   int hasTpUnit[10];
   int hasTpValue[10];
   ArrayInitialize(hasSlUnit, 0);
   ArrayInitialize(hasSlValue, 0);
   ArrayInitialize(hasTpUnit, 0);
   ArrayInitialize(hasTpValue, 0);
   for(int j=0; j<BO_MAX_ROWS; j++)
     {
      hasSlUnit[j]=false;
      hasSlValue[j]=false;
      hasTpUnit[j]=false;
      hasTpValue[j]=false;
     }

   while(!FileIsEnding(handle))
     {
      string key=FileReadString(handle);
      if(key=="" && FileIsEnding(handle))
         break;
      string value=FileReadString(handle);

      if(key=="version") { version=StrToInteger(value); hasVersion=true; }
      else if(key=="symbol") { savedSymbol=value; hasSymbol=true; }
      else if(key=="orderCount") { orderCount=StrToInteger(value); hasCount=true; }
      else if(key=="lotMode") { lotMode=StrToInteger(value); hasLotMode=true; }
      else if(key=="fixedLots") { fixedLots=StrToDouble(value); hasFixedLots=true; }
      else if(key=="riskPercent") { riskPercent=StrToDouble(value); hasRiskPercent=true; }
      else
        {
         for(int row=0; row<BO_MAX_ROWS; row++)
           {
            if(key==StringFormat("row%d.slUnit", row+1)) { slUnits[row]=StrToInteger(value); hasSlUnit[row]=true; }
            else if(key==StringFormat("row%d.slValue", row+1)) { slValues[row]=StrToDouble(value); hasSlValue[row]=true; }
            else if(key==StringFormat("row%d.tpUnit", row+1)) { tpUnits[row]=StrToInteger(value); hasTpUnit[row]=true; }
            else if(key==StringFormat("row%d.tpValue", row+1)) { tpValues[row]=StrToDouble(value); hasTpValue[row]=true; }
           }
        }
     }
   FileClose(handle);

   if(!hasVersion || version!=BO_TEMPLATE_VERSION)
     {
      error=StringFormat("unsupported or missing template version, expected %d", BO_TEMPLATE_VERSION);
      return(false);
     }
   if(!hasSymbol || !hasCount || !hasLotMode || !hasFixedLots || !hasRiskPercent)
     {
      error="template is missing required fields";
      return(false);
     }
   for(int k=0; k<BO_MAX_ROWS; k++)
     {
      if(!hasSlUnit[k] || !hasSlValue[k] || !hasTpUnit[k] || !hasTpValue[k])
        {
         error=StringFormat("template row %d is incomplete", k+1);
         return(false);
        }
     }

   if(!BO_ValidTemplateRows(orderCount, lotMode, fixedLots, riskPercent,
                            slUnits, slValues, tpUnits, tpValues, error))
      return(false);

   if(savedSymbol!=currentSymbol)
      warning=StringFormat("template was saved for %s; current chart is %s", savedSymbol, currentSymbol);
   return(true);
  }

bool BO_DeleteTemplate(string name)
  {
   string path=BO_TemplatePath(name);
   if(path=="")
      return(false);
   return(FileDelete(path, FILE_COMMON));
  }

const int BO_PANEL_STATE_VERSION = 3;

string BO_PanelStatePath(string stateKey)
  {
   string safeName=BO_SanitizeTemplateName(stateKey);
   if(safeName=="")
      return("");
   return(BO_TEMPLATE_FOLDER+"\\"+safeName+".state");
  }

bool BO_SavePanelState(string stateKey, string symbol, int orderCount, int lotMode,
                       double fixedLots, double riskPercent, int slippagePoints,
                       bool accountWideClose, bool confirmClose, bool settingsExpanded,
                       int bridgeMode, int bridgePollMilliseconds,
                       int bridgeOpenTtlSeconds, int bridgeCloseTtlSeconds,
                       int bridgeConfirmSeconds,
                       bool candleAlertEnabled, int candleAlertSeconds,
                       string templateName, int &slUnits[], double &slValues[],
                       int &tpUnits[], double &tpValues[], string &error, int entryMode=0, double pendingPrice=0.0)
  {
   error="";
   if(entryMode<0 || entryMode>2 || !MathIsValidNumber(pendingPrice) || pendingPrice<0.0)
     { error="panel order mode or pending price is invalid"; return(false); }
   string path=BO_PanelStatePath(stateKey);
   if(path=="")
     {
      error="panel state key is empty or invalid";
      return(false);
     }
   if(symbol=="")
     {
      error="panel state symbol cannot be empty";
      return(false);
     }
   if(!MathIsValidNumber(fixedLots) || !MathIsValidNumber(riskPercent) ||
      fixedLots<0.0 || riskPercent<0.0 || riskPercent>100.0)
     {
      error="panel state lot values are invalid";
      return(false);
     }
   if(slippagePoints<0)
     {
      error="panel state slippage cannot be negative";
      return(false);
     }
   if(!BO_ValidBridgePanelSettings(bridgeMode, bridgePollMilliseconds,
                                   bridgeOpenTtlSeconds, bridgeCloseTtlSeconds,
                                   bridgeConfirmSeconds, error))
      return(false);
   if(!BO_ValidTemplateRows(orderCount, lotMode, fixedLots, riskPercent,
                            slUnits, slValues, tpUnits, tpValues, error))
      return(false);

   ResetLastError();
   FolderCreate(BO_TEMPLATE_FOLDER, FILE_COMMON);

   ResetLastError();
   int handle=INVALID_HANDLE;
   for(int attempt=0; attempt<5; attempt++)
     {
      handle=FileOpen(path, FILE_CSV|FILE_WRITE|FILE_ANSI|FILE_COMMON|FILE_SHARE_READ|FILE_SHARE_WRITE, ';');
      if(handle!=INVALID_HANDLE)
         break;
      Sleep(20);
     }
   if(handle==INVALID_HANDLE)
     {
      error=StringFormat("cannot open panel state for writing, error %d", GetLastError());
      return(false);
     }

   FileWrite(handle, "version", BO_PANEL_STATE_VERSION);
   FileWrite(handle, "symbol", symbol);
   FileWrite(handle, "orderCount", orderCount);
   FileWrite(handle, "lotMode", lotMode);
   FileWrite(handle, "fixedLots", DoubleToString(fixedLots, 8));
   FileWrite(handle, "riskPercent", DoubleToString(riskPercent, 8));
   FileWrite(handle, "slippagePoints", slippagePoints);
   FileWrite(handle, "accountWideClose", accountWideClose ? 1 : 0);
   FileWrite(handle, "confirmClose", confirmClose ? 1 : 0);
   FileWrite(handle, "settingsExpanded", settingsExpanded ? 1 : 0);
   FileWrite(handle, "bridgeMode", bridgeMode);
   FileWrite(handle, "bridgePollMilliseconds", bridgePollMilliseconds);
   FileWrite(handle, "bridgeOpenTtlSeconds", bridgeOpenTtlSeconds);
   FileWrite(handle, "bridgeCloseTtlSeconds", bridgeCloseTtlSeconds);
   FileWrite(handle, "bridgeConfirmSeconds", bridgeConfirmSeconds);
   FileWrite(handle, "candleAlertEnabled", candleAlertEnabled ? 1 : 0);
   FileWrite(handle, "candleAlertSeconds", candleAlertSeconds);
   FileWrite(handle, "templateName", BO_SanitizeTemplateName(templateName));

   for(int i=0; i<BO_MAX_ROWS; i++)
     {
      FileWrite(handle, StringFormat("row%d.slUnit", i+1), slUnits[i]);
      FileWrite(handle, StringFormat("row%d.slValue", i+1), DoubleToString(slValues[i], 8));
      FileWrite(handle, StringFormat("row%d.tpUnit", i+1), tpUnits[i]);
      FileWrite(handle, StringFormat("row%d.tpValue", i+1), DoubleToString(tpValues[i], 8));
     }

   FileWrite(handle, "entryMode", entryMode);
   FileWrite(handle, "pendingPrice", DoubleToString(pendingPrice, 8));
   FileClose(handle);
   return(true);
  }

bool BO_LoadPanelState(string stateKey, string currentSymbol, string &savedSymbol,
                       int &orderCount, int &lotMode, double &fixedLots,
                       double &riskPercent, int &slippagePoints,
                       bool &accountWideClose, bool &confirmClose, bool &settingsExpanded,
                       int &bridgeMode, int &bridgePollMilliseconds,
                       int &bridgeOpenTtlSeconds, int &bridgeCloseTtlSeconds,
                       int &bridgeConfirmSeconds,
                       bool &candleAlertEnabled, int &candleAlertSeconds,
                       string &templateName, int &slUnits[], double &slValues[],
                       int &tpUnits[], double &tpValues[], int &entryMode, double &pendingPrice, string &error)
  {
   entryMode=0; pendingPrice=0.0;
   savedSymbol="";
   orderCount=0;
   lotMode=BO_LOTS_FIXED;
   fixedLots=0.0;
   riskPercent=0.0;
   slippagePoints=0;
   accountWideClose=false;
   confirmClose=true;
   settingsExpanded=false;
   candleAlertEnabled=true;
   candleAlertSeconds=10;
   templateName="";
   error="";

   for(int i=0; i<BO_MAX_ROWS; i++)
     {
      slUnits[i]=BO_UNIT_PIPS;
      slValues[i]=0.0;
      tpUnits[i]=BO_UNIT_PIPS;
      tpValues[i]=0.0;
     }

   string path=BO_PanelStatePath(stateKey);
   if(path=="")
     {
      error="panel state key is empty or invalid";
      return(false);
     }

   // 如果文件不存在，属于首次使用或未保存过状态，静默返回 false，不记录错误
   if(!FileIsExist(path, FILE_COMMON))
      return(false);

   ResetLastError();
   int handle=INVALID_HANDLE;
   for(int attempt=0; attempt<5; attempt++)
     {
      handle=FileOpen(path, FILE_CSV|FILE_READ|FILE_ANSI|FILE_COMMON|FILE_SHARE_READ|FILE_SHARE_WRITE, ';');
      if(handle!=INVALID_HANDLE)
         break;
      Sleep(20);
     }

   if(handle==INVALID_HANDLE)
     {
      error=StringFormat("cannot open panel state for reading, error %d", GetLastError());
      return(false);
     }

   int version=0;
   int savedSlippage=0;
   int savedAccountWide=-1;
   int savedConfirm=-1;
   int savedExpanded=-1;
   int savedBridgeMode=bridgeMode;
   int savedBridgePollMilliseconds=bridgePollMilliseconds;
   int savedBridgeOpenTtlSeconds=bridgeOpenTtlSeconds;
   int savedBridgeCloseTtlSeconds=bridgeCloseTtlSeconds;
   int savedBridgeConfirmSeconds=bridgeConfirmSeconds;
   int savedCandleAlertEnabled=1;
   int savedCandleAlertSeconds=10;
   string savedTemplateName="";
   bool hasVersion=false;
   bool hasSymbol=false;
   bool hasCount=false;
   bool hasLotMode=false;
   bool hasFixedLots=false;
   bool hasRiskPercent=false;
   bool hasSlippage=false;
   bool hasAccountWide=false;
   bool hasConfirm=false;
   bool hasExpanded=false;
   bool hasBridgeMode=false;
   bool hasBridgePollMilliseconds=false;
   bool hasBridgeOpenTtlSeconds=false;
   bool hasBridgeCloseTtlSeconds=false;
   bool hasBridgeConfirmSeconds=false;
   bool hasCandleAlertEnabled=false;
   bool hasCandleAlertSeconds=false;
   bool hasTemplateName=false;
   int hasSlUnit[BO_MAX_ROWS];
   int hasSlValue[BO_MAX_ROWS];
   int hasTpUnit[BO_MAX_ROWS];
   int hasTpValue[BO_MAX_ROWS];
   ArrayInitialize(hasSlUnit, 0);
   ArrayInitialize(hasSlValue, 0);
   ArrayInitialize(hasTpUnit, 0);
   ArrayInitialize(hasTpValue, 0);

   while(!FileIsEnding(handle))
     {
      string key=FileReadString(handle);
      if(key=="" && FileIsEnding(handle))
         break;
      string value=FileReadString(handle);

      if(key=="version") { version=StrToInteger(value); hasVersion=true; }
      else if(key=="symbol") { savedSymbol=value; hasSymbol=true; }
      else if(key=="orderCount") { orderCount=StrToInteger(value); hasCount=true; }
      else if(key=="lotMode") { lotMode=StrToInteger(value); hasLotMode=true; }
      else if(key=="fixedLots") { fixedLots=StrToDouble(value); hasFixedLots=true; }
      else if(key=="riskPercent") { riskPercent=StrToDouble(value); hasRiskPercent=true; }
      else if(key=="slippagePoints") { savedSlippage=StrToInteger(value); hasSlippage=true; }
      else if(key=="accountWideClose") { savedAccountWide=StrToInteger(value); hasAccountWide=true; }
      else if(key=="confirmClose") { savedConfirm=StrToInteger(value); hasConfirm=true; }
      else if(key=="settingsExpanded") { savedExpanded=StrToInteger(value); hasExpanded=true; }
      else if(key=="bridgeMode") { savedBridgeMode=StrToInteger(value); hasBridgeMode=true; }
      else if(key=="bridgePollMilliseconds") { savedBridgePollMilliseconds=StrToInteger(value); hasBridgePollMilliseconds=true; }
      else if(key=="bridgeOpenTtlSeconds") { savedBridgeOpenTtlSeconds=StrToInteger(value); hasBridgeOpenTtlSeconds=true; }
      else if(key=="bridgeCloseTtlSeconds") { savedBridgeCloseTtlSeconds=StrToInteger(value); hasBridgeCloseTtlSeconds=true; }
      else if(key=="bridgeConfirmSeconds") { savedBridgeConfirmSeconds=StrToInteger(value); hasBridgeConfirmSeconds=true; }
      else if(key=="candleAlertEnabled") { savedCandleAlertEnabled=StrToInteger(value); hasCandleAlertEnabled=true; }
      else if(key=="candleAlertSeconds") { savedCandleAlertSeconds=StrToInteger(value); hasCandleAlertSeconds=true; }
      else if(key=="entryMode") { entryMode=StrToInteger(value); }
      else if(key=="pendingPrice") { pendingPrice=StrToDouble(value); }
      else if(key=="templateName") { savedTemplateName=value; hasTemplateName=true; }
      else
        {
         for(int row=0; row<BO_MAX_ROWS; row++)
           {
            if(key==StringFormat("row%d.slUnit", row+1)) { slUnits[row]=StrToInteger(value); hasSlUnit[row]=true; }
            else if(key==StringFormat("row%d.slValue", row+1)) { slValues[row]=StrToDouble(value); hasSlValue[row]=true; }
            else if(key==StringFormat("row%d.tpUnit", row+1)) { tpUnits[row]=StrToInteger(value); hasTpUnit[row]=true; }
            else if(key==StringFormat("row%d.tpValue", row+1)) { tpValues[row]=StrToDouble(value); hasTpValue[row]=true; }
           }
        }
     }
   FileClose(handle);

   if(!hasVersion || (version < 1 || version > BO_PANEL_STATE_VERSION))
     {
      error=StringFormat("unsupported or missing panel state version, expected <= %d", BO_PANEL_STATE_VERSION);
      return(false);
     }
   if(version>=2 && (!hasBridgeMode || !hasBridgePollMilliseconds ||
                     !hasBridgeOpenTtlSeconds || !hasBridgeCloseTtlSeconds ||
                     !hasBridgeConfirmSeconds))
     {
      error="panel state is missing bridge settings";
      return(false);
     }
   if(!hasSymbol || !hasCount || !hasLotMode || !hasFixedLots || !hasRiskPercent ||
      !hasSlippage || !hasAccountWide || !hasConfirm || !hasExpanded || !hasTemplateName)
     {
      error="panel state is missing required fields";
      return(false);
     }
   if(currentSymbol!="" && savedSymbol!=currentSymbol)
     {
      error=StringFormat("panel state was saved for %s; current chart is %s", savedSymbol, currentSymbol);
      return(false);
     }
   if(savedAccountWide<0 || savedAccountWide>1 || savedConfirm<0 || savedConfirm>1 ||
      savedExpanded<0 || savedExpanded>1)
     {
      error="panel state toggle value is invalid";
      return(false);
     }
   if(!MathIsValidNumber(fixedLots) || !MathIsValidNumber(riskPercent) ||
      fixedLots<0.0 || riskPercent<0.0 || riskPercent>100.0 || savedSlippage<0)
     {
      error="panel state scalar value is invalid";
      return(false);
     }
   for(int j=0; j<BO_MAX_ROWS; j++)
     {
      if(!hasSlUnit[j] || !hasSlValue[j] || !hasTpUnit[j] || !hasTpValue[j])
        {
         error=StringFormat("panel state row %d is incomplete", j+1);
         return(false);
        }
     }
   if(!BO_ValidTemplateRows(orderCount, lotMode, fixedLots, riskPercent,
                            slUnits, slValues, tpUnits, tpValues, error))
      return(false);
   if(!BO_ValidBridgePanelSettings(savedBridgeMode, savedBridgePollMilliseconds,
                                   savedBridgeOpenTtlSeconds, savedBridgeCloseTtlSeconds,
                                   savedBridgeConfirmSeconds, error))
      return(false);

   if(entryMode<0 || entryMode>2 || !MathIsValidNumber(pendingPrice) || pendingPrice<0.0)
     { error="panel order mode or pending price is invalid"; return(false); }
   slippagePoints=savedSlippage;
   accountWideClose=(savedAccountWide==1);
   confirmClose=(savedConfirm==1);
   settingsExpanded=(savedExpanded==1);
   bridgeMode=savedBridgeMode;
   bridgePollMilliseconds=savedBridgePollMilliseconds;
   bridgeOpenTtlSeconds=savedBridgeOpenTtlSeconds;
   bridgeCloseTtlSeconds=savedBridgeCloseTtlSeconds;
   bridgeConfirmSeconds=savedBridgeConfirmSeconds;
   if(hasCandleAlertEnabled)
      candleAlertEnabled=(savedCandleAlertEnabled==1);
   if(hasCandleAlertSeconds && savedCandleAlertSeconds>0)
      candleAlertSeconds=savedCandleAlertSeconds;
   templateName=BO_SanitizeTemplateName(savedTemplateName);
   return(true);
  }

bool BO_LoadPanelState(string stateKey, string currentSymbol, string &savedSymbol,
                       int &orderCount, int &lotMode, double &fixedLots,
                       double &riskPercent, int &slippagePoints,
                       bool &accountWideClose, bool &confirmClose, bool &settingsExpanded,
                       int &bridgeMode, int &bridgePollMilliseconds,
                       int &bridgeOpenTtlSeconds, int &bridgeCloseTtlSeconds,
                       int &bridgeConfirmSeconds,
                       bool &candleAlertEnabled, int &candleAlertSeconds,
                       string &templateName, int &slUnits[], double &slValues[],
                       int &tpUnits[], double &tpValues[], string &error)
  {
   int entryMode=0; double pendingPrice=0.0;
   return(BO_LoadPanelState(stateKey, currentSymbol, savedSymbol, orderCount, lotMode,
                            fixedLots, riskPercent, slippagePoints, accountWideClose,
                            confirmClose, settingsExpanded, bridgeMode, bridgePollMilliseconds,
                            bridgeOpenTtlSeconds, bridgeCloseTtlSeconds, bridgeConfirmSeconds,
                            candleAlertEnabled, candleAlertSeconds, templateName,
                            slUnits, slValues, tpUnits, tpValues, entryMode, pendingPrice, error));
  }

// Overload for backward compatibility (without candle alert parameters)
bool BO_LoadPanelState(string stateKey, string currentSymbol, string &savedSymbol,
                       int &orderCount, int &lotMode, double &fixedLots,
                       double &riskPercent, int &slippagePoints,
                       bool &accountWideClose, bool &confirmClose, bool &settingsExpanded,
                       int &bridgeMode, int &bridgePollMilliseconds,
                       int &bridgeOpenTtlSeconds, int &bridgeCloseTtlSeconds,
                       int &bridgeConfirmSeconds,
                       string &templateName, int &slUnits[], double &slValues[],
                       int &tpUnits[], double &tpValues[], string &error)
  {
   bool dummyAlert=true;
   int dummySec=10;
   return(BO_LoadPanelState(stateKey, currentSymbol, savedSymbol, orderCount, lotMode,
                            fixedLots, riskPercent, slippagePoints, accountWideClose,
                            confirmClose, settingsExpanded, bridgeMode, bridgePollMilliseconds,
                            bridgeOpenTtlSeconds, bridgeCloseTtlSeconds, bridgeConfirmSeconds,
                            dummyAlert, dummySec,
                            templateName, slUnits, slValues, tpUnits, tpValues, error));
  }

// Overload for older version without bridge parameters (used in tests)
bool BO_LoadPanelState(string stateKey, string currentSymbol, string &savedSymbol,
                       int &orderCount, int &lotMode, double &fixedLots,
                       double &riskPercent, int &slippagePoints,
                       bool &accountWideClose, bool &confirmClose, bool &settingsExpanded,
                       string &templateName, int &slUnits[], double &slValues[],
                       int &tpUnits[], double &tpValues[], string &error)
  {
   int dummyBridgeMode=BRIDGE_OFF;
   int dummyPoll=50, dummyOpen=5, dummyClose=30, dummyConfirm=15;
   bool dummyAlert=true;
   int dummySec=10;
   return(BO_LoadPanelState(stateKey, currentSymbol, savedSymbol, orderCount, lotMode,
                            fixedLots, riskPercent, slippagePoints, accountWideClose,
                            confirmClose, settingsExpanded, dummyBridgeMode, dummyPoll,
                            dummyOpen, dummyClose, dummyConfirm,
                            dummyAlert, dummySec,
                            templateName, slUnits, slValues, tpUnits, tpValues, error));
  }

bool BO_DeletePanelState(string stateKey)
  {
   string path=BO_PanelStatePath(stateKey);
   if(path=="")
      return(false);
   return(FileDelete(path, FILE_COMMON));
  }

#endif
