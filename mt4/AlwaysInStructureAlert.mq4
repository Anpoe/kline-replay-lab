#property strict
#property version   "1.0"
#property description "Alert-only Always In Long/Short structure monitor."

input int  InpEmaPeriod          = 20;
input int  InpPivotStrength       = 2;
input int  InpFollowThroughBars   = 2;
input int  InpEmaSlopeBars        = 3;
input int  InpStateLookback       = 120;
input int  InpRecentBreakoutBars  = 18;
input int  InpControlWindow       = 12;
input int  InpMinimumTrendCloses  = 9;
input int  InpMaximumEmaCrosses   = 1;
input int  InpCooldownBars        = 10;
input int  InpHistoryBars         = 5000;
input bool InpEnableSound         = true;
input string InpSoundFile         = "alert.wav";
input bool InpEnablePush          = false;
input bool InpEnableEmail         = false;

struct BarData
{
   datetime time;
   double open;
   double high;
   double low;
   double close;
};

struct SwingPoint
{
   int index;
   double price;
};

struct PendingBreakout
{
   int index;
   double high;
   double low;
   int pivotIndex;
};

BarData g_bars[];
datetime g_lastSeenCurrentBar = 0;
datetime g_lastAlertBar = 0;
bool g_initialized = false;

int ClampInt(int value, int fallback, int minimum, int maximum)
{
   int safe = value;
   if(safe < minimum || safe > maximum)
      safe = fallback;
   if(safe < minimum)
      safe = minimum;
   if(safe > maximum)
      safe = maximum;
   return safe;
}

int MinimumHistoryBars()
{
   int emaPeriod = ClampInt(InpEmaPeriod, 20, 5, 100);
   int pivotStrength = ClampInt(InpPivotStrength, 2, 1, 5);
   int followThroughBars = ClampInt(InpFollowThroughBars, 2, 1, 4);
   int emaSlopeBars = ClampInt(InpEmaSlopeBars, 3, 1, 10);
   int stateLookback = ClampInt(InpStateLookback, 120, 20, 500);
   int controlWindow = ClampInt(InpControlWindow, 12, 6, 40);
   return stateLookback + emaPeriod * 4 + pivotStrength * 4
      + followThroughBars + emaSlopeBars + controlWindow + pivotStrength + 2;
}

int LoadClosedBars()
{
   int totalBars = iBars(Symbol(), Period());
   if(totalBars < 3)
      return 0;

   int maximumClosedBars = totalBars - 1;
   int requested = InpHistoryBars;
   if(requested < MinimumHistoryBars())
      requested = MinimumHistoryBars();
   if(requested > maximumClosedBars)
      requested = maximumClosedBars;
   if(requested < MinimumHistoryBars())
      return 0;

   ArrayResize(g_bars, requested);
   for(int position = 0; position < requested; position++)
   {
      int shift = requested - position;
      g_bars[position].time = iTime(Symbol(), Period(), shift);
      g_bars[position].open = iOpen(Symbol(), Period(), shift);
      g_bars[position].high = iHigh(Symbol(), Period(), shift);
      g_bars[position].low = iLow(Symbol(), Period(), shift);
      g_bars[position].close = iClose(Symbol(), Period(), shift);
   }
   return requested;
}

double EmaAt(const double &closes[], int count, int index, int period)
{
   if(count <= 0 || index < 0 || index >= count)
      return 0.0;
   int start = index - period * 4;
   if(start < 0)
      start = 0;
   double multiplier = 2.0 / (period + 1.0);
   double result = closes[start];
   for(int cursor = start + 1; cursor <= index; cursor++)
      result = closes[cursor] * multiplier + result * (1.0 - multiplier);
   return result;
}

bool EmaMoves(const double &ema[], int index, int direction, int slopeBars)
{
   if(index < slopeBars)
      return false;
   for(int cursor = index - slopeBars + 1; cursor <= index; cursor++)
   {
      if(direction == 1 && ema[cursor] <= ema[cursor - 1])
         return false;
      if(direction == -1 && ema[cursor] >= ema[cursor - 1])
         return false;
   }
   return true;
}

bool ConfirmedPivot(int index, int direction, int knownIndex, int pivotStrength)
{
   if(index < pivotStrength || index + pivotStrength > knownIndex)
      return false;
   double price = direction == 1 ? g_bars[index].high : g_bars[index].low;
   for(int offset = 1; offset <= pivotStrength; offset++)
   {
      double left = direction == 1 ? g_bars[index - offset].high : g_bars[index - offset].low;
      double right = direction == 1 ? g_bars[index + offset].high : g_bars[index + offset].low;
      if(direction == 1 && (price <= left || price <= right))
         return false;
      if(direction == -1 && (price >= left || price >= right))
         return false;
   }
   return true;
}

int EvaluateAlwaysInState(int count)
{
   if(count <= 0)
      return 0;

   int emaPeriod = ClampInt(InpEmaPeriod, 20, 5, 100);
   int pivotStrength = ClampInt(InpPivotStrength, 2, 1, 5);
   int followThroughBars = ClampInt(InpFollowThroughBars, 2, 1, 4);
   int emaSlopeBars = ClampInt(InpEmaSlopeBars, 3, 1, 10);
   int stateLookback = ClampInt(InpStateLookback, 120, 20, 500);
   int recentBreakoutBars = ClampInt(InpRecentBreakoutBars, 18, 4, 60);
   int controlWindow = ClampInt(InpControlWindow, 12, 6, 40);
   int minimumTrendCloses = ClampInt(InpMinimumTrendCloses, 9, 3, controlWindow);
   int maximumEmaCrosses = ClampInt(InpMaximumEmaCrosses, 1, 0, 6);

   double closes[];
   double ema[];
   ArrayResize(closes, count);
   ArrayResize(ema, count);
   for(int index = 0; index < count; index++)
      closes[index] = g_bars[index].close;
   double multiplier = 2.0 / (emaPeriod + 1.0);
   ema[0] = closes[0];
   for(int index = 1; index < count; index++)
      ema[index] = closes[index] * multiplier + ema[index - 1] * (1.0 - multiplier);

   SwingPoint swingHighs[];
   SwingPoint swingLows[];
   int highCount = 0;
   int lowCount = 0;
   int state = 0;
   int lastStateEvent = -1;
   int usedBullPivotIndex = -1;
   int usedBearPivotIndex = -1;
   bool pendingBullActive = false;
   bool pendingBearActive = false;
   PendingBreakout pendingBull;
   PendingBreakout pendingBear;

   for(int index = 0; index < count; index++)
   {
      int pivotIndex = index - pivotStrength;
      if(ConfirmedPivot(pivotIndex, 1, index, pivotStrength))
      {
         if(highCount < 2)
         {
            ArrayResize(swingHighs, highCount + 1);
            swingHighs[highCount].index = pivotIndex;
            swingHighs[highCount].price = g_bars[pivotIndex].high;
            highCount++;
         }
         else
         {
            swingHighs[0] = swingHighs[1];
            swingHighs[1].index = pivotIndex;
            swingHighs[1].price = g_bars[pivotIndex].high;
         }
      }
      if(ConfirmedPivot(pivotIndex, -1, index, pivotStrength))
      {
         if(lowCount < 2)
         {
            ArrayResize(swingLows, lowCount + 1);
            swingLows[lowCount].index = pivotIndex;
            swingLows[lowCount].price = g_bars[pivotIndex].low;
            lowCount++;
         }
         else
         {
            swingLows[0] = swingLows[1];
            swingLows[1].index = pivotIndex;
            swingLows[1].price = g_bars[pivotIndex].low;
         }
      }

      bool bullStructure = highCount == 2 && lowCount == 2
         && swingHighs[1].price > swingHighs[0].price
         && swingLows[1].price > swingLows[0].price;
      bool bearStructure = highCount == 2 && lowCount == 2
         && swingHighs[1].price < swingHighs[0].price
         && swingLows[1].price < swingLows[0].price;
      BarData current = g_bars[index];

      if(pendingBullActive)
      {
         int age = index - pendingBull.index;
         if(current.close < pendingBull.low || age > followThroughBars)
            pendingBullActive = false;
         else if(age >= 1 && current.close > pendingBull.high
            && current.close > current.open && current.close > ema[index]
            && EmaMoves(ema, index, 1, emaSlopeBars) && bullStructure)
         {
            state = 1;
            lastStateEvent = index;
            usedBullPivotIndex = pendingBull.pivotIndex;
            pendingBullActive = false;
            pendingBearActive = false;
         }
      }
      if(pendingBearActive)
      {
         int age = index - pendingBear.index;
         if(current.close > pendingBear.high || age > followThroughBars)
            pendingBearActive = false;
         else if(age >= 1 && current.close < pendingBear.low
            && current.close < current.open && current.close < ema[index]
            && EmaMoves(ema, index, -1, emaSlopeBars) && bearStructure)
         {
            state = -1;
            lastStateEvent = index;
            usedBearPivotIndex = pendingBear.pivotIndex;
            pendingBearActive = false;
            pendingBullActive = false;
         }
      }

      if(state != 0 && lastStateEvent >= 0 && index - lastStateEvent > stateLookback)
         state = 0;

      bool hasPrevious = index > 0;
      if(!pendingBullActive && highCount > 0 && swingHighs[highCount - 1].index > usedBullPivotIndex && hasPrevious
         && g_bars[index - 1].close <= swingHighs[highCount - 1].price
         && current.close > swingHighs[highCount - 1].price && current.close > current.open)
      {
         pendingBull.index = index;
         pendingBull.high = current.high;
         pendingBull.low = current.low;
         pendingBull.pivotIndex = swingHighs[highCount - 1].index;
         pendingBullActive = true;
      }
      if(!pendingBearActive && lowCount > 0 && swingLows[lowCount - 1].index > usedBearPivotIndex && hasPrevious
         && g_bars[index - 1].close >= swingLows[lowCount - 1].price
         && current.close < swingLows[lowCount - 1].price && current.close < current.open)
      {
         pendingBear.index = index;
         pendingBear.high = current.high;
         pendingBear.low = current.low;
         pendingBear.pivotIndex = swingLows[lowCount - 1].index;
         pendingBearActive = true;
      }

      bool structureMatches = state == 1 ? bullStructure : state == -1 ? bearStructure : false;
      int windowStart = index - controlWindow + 1;
      int trendSideCloses = 0;
      int emaCrosses = 0;
      if(state != 0 && windowStart >= 0)
      {
         int previousSide = 0;
         double firstDifference = g_bars[windowStart].close - ema[windowStart];
         if(firstDifference > 0.0)
            previousSide = 1;
         else if(firstDifference < 0.0)
            previousSide = -1;
         for(int cursor = windowStart; cursor <= index; cursor++)
         {
            double difference = g_bars[cursor].close - ema[cursor];
            int side = difference > 0.0 ? 1 : difference < 0.0 ? -1 : 0;
            if(state == 1 && side > 0)
               trendSideCloses++;
            if(state == -1 && side < 0)
               trendSideCloses++;
            if(cursor > windowStart && side != 0 && previousSide != 0 && side != previousSide)
               emaCrosses++;
            if(side != 0)
               previousSide = side;
         }
      }
      bool directionStillControls = state != 0 && structureMatches && lastStateEvent >= 0
         && index - lastStateEvent <= recentBreakoutBars && windowStart >= 0
         && trendSideCloses >= minimumTrendCloses && emaCrosses <= maximumEmaCrosses;
      if(directionStillControls)
      {
         if(state == 1)
            directionStillControls = current.close > ema[index]
               && ema[index] > ema[windowStart]
               && current.close > g_bars[windowStart].close;
         else
            directionStillControls = current.close < ema[index]
               && ema[index] < ema[windowStart]
               && current.close < g_bars[windowStart].close;
      }
      if(!directionStillControls)
      {
         if(index == count - 1)
            return 0;
      }
      else if(index == count - 1)
         return state;
   }
   return 0;
}

string TimeframeLabel()
{
   switch(Period())
   {
      case PERIOD_M1: return "M1";
      case PERIOD_M5: return "M5";
      case PERIOD_M15: return "M15";
      case PERIOD_M30: return "M30";
      case PERIOD_H1: return "H1";
      case PERIOD_H4: return "H4";
      case PERIOD_D1: return "D1";
      case PERIOD_W1: return "W1";
      case PERIOD_MN1: return "MN1";
   }
   return IntegerToString(Period());
}

bool CooldownPassed()
{
   if(g_lastAlertBar == 0)
      return true;
   int shift = iBarShift(Symbol(), Period(), g_lastAlertBar, true);
   if(shift < 0)
      return true;
   int barsSinceAlert = shift - 1;
   return barsSinceAlert > InpCooldownBars;
}

void AlertDirection(int direction, datetime signalTime)
{
   string side = direction == 1 ? "Always In Long" : "Always In Short";
   string message = StringFormat("%s | %s %s | closed=%s | cooldown=%d bars",
      side, Symbol(), TimeframeLabel(), TimeToString(signalTime, TIME_DATE | TIME_MINUTES), InpCooldownBars);
   Print(message);
   Alert(message);
   if(InpEnableSound && StringLen(InpSoundFile) > 0)
      PlaySound(InpSoundFile);
   if(InpEnablePush)
      SendNotification(message);
   if(InpEnableEmail)
      SendMail("MT4 Always In alert", message);
   g_lastAlertBar = signalTime;
}

void EvaluateClosedBar()
{
   int count = LoadClosedBars();
   if(count < MinimumHistoryBars())
      return;
   int direction = EvaluateAlwaysInState(count);
   if(direction == 0 || !CooldownPassed())
      return;
   AlertDirection(direction, g_bars[count - 1].time);
}

int OnInit()
{
   if(InpCooldownBars != 10 || InpHistoryBars < MinimumHistoryBars())
      return INIT_PARAMETERS_INCORRECT;
   g_lastSeenCurrentBar = iTime(Symbol(), Period(), 0);
   g_initialized = g_lastSeenCurrentBar > 0;
   Print("AlwaysInStructureAlert initialized on ", Symbol(), " ", TimeframeLabel(), "; alert-only mode.");
   return INIT_SUCCEEDED;
}

void OnTick()
{
   datetime currentBar = iTime(Symbol(), Period(), 0);
   if(currentBar <= 0)
      return;
   if(!g_initialized)
   {
      g_lastSeenCurrentBar = currentBar;
      g_initialized = true;
      return;
   }
   if(currentBar == g_lastSeenCurrentBar)
      return;
   g_lastSeenCurrentBar = currentBar;
   EvaluateClosedBar();
}
