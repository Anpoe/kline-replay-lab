#ifndef __BATCH_ORDER_BRIDGE_MQH__
#define __BATCH_ORDER_BRIDGE_MQH__

#property strict

#define BO_BRIDGE_PROTOCOL_VERSION 1
#define BO_BRIDGE_OPEN "OPEN"
#define BO_BRIDGE_CLOSE "CLOSE"
#define BO_BRIDGE_BUY "BUY"
#define BO_BRIDGE_SELL "SELL"
#define BO_BRIDGE_FOLDER "YouTubeTradeBridge"
#define BO_BRIDGE_COMMAND_FILE "YouTubeTradeBridge\\command.csv"
#define BO_BRIDGE_ACK_FILE "YouTubeTradeBridge\\ack.csv"
#define BO_BRIDGE_LAST_EVENT_FILE "YouTubeTradeBridge\\last_event.txt"

enum BOBridgeMode
  {
   BRIDGE_OFF=0,
   BRIDGE_CONFIRM=1,
   BRIDGE_DEMO_AUTO=2
  };

int BO_NextBridgeMode(int mode)
  {
   if(mode==BRIDGE_OFF)
      return(BRIDGE_CONFIRM);
   if(mode==BRIDGE_CONFIRM)
      return(BRIDGE_DEMO_AUTO);
   return(BRIDGE_OFF);
  }

bool BO_ValidBridgePanelSettings(int mode, int pollMilliseconds,
                                 int openTtlSeconds, int closeTtlSeconds,
                                 int confirmSeconds, string &error)
  {
   error="";
   if(mode!=BRIDGE_OFF && mode!=BRIDGE_CONFIRM && mode!=BRIDGE_DEMO_AUTO)
     {
      error="bridge mode is invalid";
      return(false);
     }
   if(pollMilliseconds<10 || pollMilliseconds>1000)
     {
      error="bridge poll interval must be 10 to 1000 milliseconds";
      return(false);
     }
   if(openTtlSeconds<1 || openTtlSeconds>300)
     {
      error="bridge OPEN TTL must be 1 to 300 seconds";
      return(false);
     }
   if(closeTtlSeconds<1 || closeTtlSeconds>600)
     {
      error="bridge CLOSE TTL must be 1 to 600 seconds";
      return(false);
     }
   if(confirmSeconds<1 || confirmSeconds>300)
     {
      error="bridge confirmation timeout must be 1 to 300 seconds";
      return(false);
     }
   return(true);
  }

struct BOBridgeCommand
  {
   int version;
   string eventId;
   long timestampMs;
   string action;
   string direction;
   int count;
  };

bool BO_IsUnsignedIntegerText(string value)
  {
   int length=StringLen(value);
   if(length<=0)
      return(false);
   for(int i=0; i<length; i++)
     {
      ushort code=StringGetCharacter(value, i);
      if(code<'0' || code>'9')
         return(false);
     }
   return(true);
  }

bool BO_IsSafeEventId(string eventId)
  {
   int length=StringLen(eventId);
   if(length<=0 || length>96)
      return(false);
   for(int i=0; i<length; i++)
     {
      ushort code=StringGetCharacter(eventId, i);
      if(code<=32 || code==';' || code==',' || code=='\r' || code=='\n')
         return(false);
     }
   return(true);
  }

bool BO_ParseBridgeFields(string versionText, string eventId, string timestampText,
                          string action, string direction, string countText,
                          BOBridgeCommand &command, string &error)
  {
   error="";
   if(!BO_IsUnsignedIntegerText(versionText) || StringToInteger(versionText)!=BO_BRIDGE_PROTOCOL_VERSION)
     {
      error="unsupported protocol version";
      return(false);
     }
   if(!BO_IsSafeEventId(eventId))
     {
      error="invalid event id";
      return(false);
     }
   if(!BO_IsUnsignedIntegerText(timestampText) || StringToInteger(timestampText)<=0)
     {
      error="invalid timestamp";
      return(false);
     }
   if(!BO_IsUnsignedIntegerText(countText))
     {
      error="invalid order count";
      return(false);
     }

   int count=(int)StringToInteger(countText);
   if(action!=BO_BRIDGE_OPEN && action!=BO_BRIDGE_CLOSE)
     {
      error="invalid action";
      return(false);
     }
   if(action==BO_BRIDGE_OPEN &&
      ((direction!=BO_BRIDGE_BUY && direction!=BO_BRIDGE_SELL) || count!=5))
     {
      error="OPEN requires BUY or SELL and five orders";
      return(false);
     }
   if(action==BO_BRIDGE_CLOSE && (direction!="" || count!=0))
     {
      error="CLOSE requires empty direction and zero orders";
      return(false);
     }

   command.version=BO_BRIDGE_PROTOCOL_VERSION;
   command.eventId=eventId;
   command.timestampMs=StringToInteger(timestampText);
   command.action=action;
   command.direction=direction;
   command.count=count;
   return(true);
  }

bool BO_IsCommandExpired(BOBridgeCommand &command, long nowMs,
                          int openTtlSeconds, int closeTtlSeconds)
  {
   int ttlSeconds=(command.action==BO_BRIDGE_CLOSE ? closeTtlSeconds : openTtlSeconds);
   if(ttlSeconds<1 || nowMs<command.timestampMs)
      return(false);
   return(nowMs-command.timestampMs>ttlSeconds*1000);
  }

bool BO_IsNewEvent(string candidateId, string persistedLastId)
  {
   return(StringLen(candidateId)>0 && candidateId!=persistedLastId);
  }

bool BO_IsAutomaticExecutionAllowed(int mode, bool demoAccount)
  {
   return(mode==BRIDGE_DEMO_AUTO && demoAccount);
  }

int BO_BridgeOrderType(string direction)
  {
   if(direction==BO_BRIDGE_BUY)
      return(OP_BUY);
   if(direction==BO_BRIDGE_SELL)
      return(OP_SELL);
   return(-1);
  }

// Summarize the managed market orders without treating a mixed hedge as a
// valid single-direction position.  The EA uses -1 for flat and -2 for mixed
// direction so a reversal can close the old batch before opening a new one.
int BO_BridgePositionDirection(int buyCount, int sellCount)
  {
   if(buyCount<=0 && sellCount<=0)
      return(-1);
   if(buyCount>0 && sellCount<=0)
      return(OP_BUY);
   if(sellCount>0 && buyCount<=0)
      return(OP_SELL);
   return(-2);
  }

bool BO_IsManagedMarketOrder(int orderType, string orderSymbol, int orderMagic,
                             string currentSymbol, int currentMagic)
  {
   return((orderType==OP_BUY || orderType==OP_SELL) &&
          orderSymbol==currentSymbol && orderMagic==currentMagic);
  }

long BO_BridgeNowMs()
  {
   return((long)TimeGMT()*1000);
  }

bool BO_BridgeEnsureFolder()
  {
   FolderCreate(BO_BRIDGE_FOLDER, FILE_COMMON);
   return(true);
  }

bool BO_ReadBridgeCommand(BOBridgeCommand &command, string &error)
  {
   error="";
   int handle=FileOpen(BO_BRIDGE_COMMAND_FILE, FILE_CSV|FILE_READ|FILE_ANSI|FILE_COMMON|FILE_SHARE_READ|FILE_SHARE_WRITE, ';');
   if(handle==INVALID_HANDLE)
      return(false);
   string versionText=FileReadString(handle);
   string eventId=FileReadString(handle);
   string timestampText=FileReadString(handle);
   string action=FileReadString(handle);
   string direction=FileReadString(handle);
   string countText=FileReadString(handle);
   FileClose(handle);
   if(versionText=="" && eventId=="" && timestampText=="" && action=="" && direction=="" && countText=="")
      return(false);
   return(BO_ParseBridgeFields(versionText, eventId, timestampText, action, direction, countText,
                               command, error));
  }

string BO_ReadLastEventId()
  {
   int handle=FileOpen(BO_BRIDGE_LAST_EVENT_FILE, FILE_TXT|FILE_READ|FILE_ANSI|FILE_COMMON|FILE_SHARE_READ|FILE_SHARE_WRITE);
   if(handle==INVALID_HANDLE)
      return("");
   string eventId=FileReadString(handle);
   FileClose(handle);
   return(eventId);
  }

bool BO_WriteLastEventId(string eventId)
  {
   BO_BridgeEnsureFolder();
   int handle=FileOpen(BO_BRIDGE_LAST_EVENT_FILE, FILE_TXT|FILE_WRITE|FILE_ANSI|FILE_COMMON|FILE_SHARE_READ|FILE_SHARE_WRITE);
   if(handle==INVALID_HANDLE)
      return(false);
   FileWriteString(handle, eventId);
   FileClose(handle);
   return(true);
  }

bool BO_WriteBridgeAck(string eventId, string result, string reason)
  {
   BO_BridgeEnsureFolder();
   int handle=FileOpen(BO_BRIDGE_ACK_FILE, FILE_CSV|FILE_WRITE|FILE_ANSI|FILE_COMMON|FILE_SHARE_READ|FILE_SHARE_WRITE, ';');
   if(handle==INVALID_HANDLE)
      return(false);
   FileWrite(handle, BO_BRIDGE_PROTOCOL_VERSION, eventId, BO_BridgeNowMs(), result, reason);
   FileClose(handle);
   return(true);
  }

#endif
