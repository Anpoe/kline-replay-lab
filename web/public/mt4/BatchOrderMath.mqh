#ifndef __BATCH_ORDER_MATH_MQH__
#define __BATCH_ORDER_MATH_MQH__

#define BO_MAX_ROWS 10

enum BOUnit
  {
   BO_UNIT_PIPS=0,
   BO_UNIT_PERCENT=1,
   BO_UNIT_PL=2
  };

enum BOLotMode
  {
   BO_LOTS_FIXED=0,
   BO_LOTS_RISK=1
  };

struct BOSymbolInfo
  {
   int digits;
   double point;
   double tickSize;
   double tickValue;
   double minLot;
   double maxLot;
   double lotStep;
   int stopLevelPoints;
   int freezeLevelPoints;
  };

struct BOOrderSpec
  {
   int slUnit;
   double slValue;
   int tpUnit;
   double tpValue;
  };

struct BOOrderPlan
  {
   bool valid;
   bool cappedAtMaxLot;
   string error;
   double referencePrice;
   double slDistance;
   double tpDistance;
   double slPrice;
   double tpPrice;
   double lots;
   double lossPerLot;
  };

double BO_PipSize(BOSymbolInfo &info)
  {
   if(info.point<=0.0)
      return(0.0);
   if(info.digits==3 || info.digits==5)
      return(info.point*10.0);
   return(info.point);
  }

bool BO_IsSupportedUnit(int unit)
  {
   return(unit==BO_UNIT_PIPS || unit==BO_UNIT_PERCENT || unit==BO_UNIT_PL);
  }

double BO_DistanceFromValue(int unit, double value, double referencePrice, BOSymbolInfo &info)
  {
   if(value<0.0 || !MathIsValidNumber(value))
      return(0.0);
   if(value==0.0)
      return(0.0);

   if(unit==BO_UNIT_PIPS)
      return(value*BO_PipSize(info));

   if(unit==BO_UNIT_PERCENT)
     {
      if(referencePrice<=0.0 || !MathIsValidNumber(referencePrice))
         return(0.0);
      return(referencePrice*value/100.0);
     }

   if(unit==BO_UNIT_PL)
     {
      if(info.tickSize<=0.0 || info.tickValue<=0.0)
         return(0.0);
      return(value/info.tickValue*info.tickSize);
     }

   return(0.0);
  }

double BO_FloorToTick(double price, BOSymbolInfo &info)
  {
   if(price<=0.0)
      return(0.0);
   if(info.tickSize<=0.0)
      return(NormalizeDouble(price, info.digits));

   double ticks=MathFloor(price/info.tickSize+0.000000001);
   return(NormalizeDouble(ticks*info.tickSize, info.digits));
  }

double BO_CeilToTick(double price, BOSymbolInfo &info)
  {
   if(price<=0.0)
      return(0.0);
   if(info.tickSize<=0.0)
      return(NormalizeDouble(price, info.digits));

   double ticks=MathCeil(price/info.tickSize-0.000000001);
   return(NormalizeDouble(ticks*info.tickSize, info.digits));
  }

bool BO_IsOpenOrder(int orderType)
  {
   return(orderType>=OP_BUY && orderType<=OP_SELLSTOP);
  }

bool BO_IsBuyOrder(int orderType)
  {
   return(orderType==OP_BUY || orderType==OP_BUYLIMIT || orderType==OP_BUYSTOP);
  }

int BO_EntryOrderType(int side, int mode)
  {
   if(mode==1) return(side==OP_BUY ? OP_BUYLIMIT : OP_SELLLIMIT);
   if(mode==2) return(side==OP_BUY ? OP_BUYSTOP : OP_SELLSTOP);
   return(side);
  }

bool BO_ValidatePendingPrice(int orderType, double bid, double ask, double price,
                             BOSymbolInfo &info, string &error)
  {
   if(!BO_IsOpenOrder(orderType)) { error="unsupported order type"; return(false); }
   if(orderType<OP_BUYLIMIT) return(true);
   if(price<=0.0 || !MathIsValidNumber(price) || bid<=0.0 || ask<=0.0 || info.tickSize<=0.0 || info.point<=0.0)
     { error="pending price or quote is invalid"; return(false); }
   if(MathAbs(price/info.tickSize-MathRound(price/info.tickSize))>0.00001 ||
      MathAbs(price/info.point-MathRound(price/info.point))>0.00001)
     { error="pending price does not match symbol tick size"; return(false); }
   double distance=0.0;
   if(orderType==OP_BUYLIMIT) distance=ask-price;
   else if(orderType==OP_SELLLIMIT) distance=price-bid;
   else if(orderType==OP_BUYSTOP) distance=price-ask;
   else distance=bid-price;
   if(distance<=0.0 || distance+info.point*0.00001<info.stopLevelPoints*info.point)
     { error="pending price direction or broker stop distance is invalid"; return(false); }
   return(true);
  }

bool BO_DirectionalPrices(int orderType, double referencePrice, double slDistance, double tpDistance,
                          BOSymbolInfo &info, double &slPrice, double &tpPrice)
  {
   slPrice=0.0;
   tpPrice=0.0;

   if(referencePrice<=0.0 || slDistance<0.0 || tpDistance<0.0)
      return(false);
   if(!BO_IsOpenOrder(orderType))
      return(false);

   if(BO_IsBuyOrder(orderType))
     {
      if(slDistance>0.0)
         slPrice=BO_FloorToTick(referencePrice-slDistance, info);
      if(tpDistance>0.0)
         tpPrice=BO_CeilToTick(referencePrice+tpDistance, info);
     }
   else
     {
      if(slDistance>0.0)
         slPrice=BO_CeilToTick(referencePrice+slDistance, info);
      if(tpDistance>0.0)
         tpPrice=BO_FloorToTick(referencePrice-tpDistance, info);
     }

   if(slDistance>0.0 && slPrice<=0.0)
      return(false);
   if(tpDistance>0.0 && tpPrice<=0.0)
      return(false);
   return(true);
  }

double BO_LossPerLot(double priceDistance, BOSymbolInfo &info)
  {
   if(priceDistance<=0.0 || info.tickSize<=0.0 || info.tickValue<=0.0)
      return(0.0);
   return(priceDistance/info.tickSize*info.tickValue);
  }

double BO_NormalizeLotsDown(double requestedLots, BOSymbolInfo &info)
  {
   if(requestedLots<=0.0 || !MathIsValidNumber(requestedLots) || info.lotStep<=0.0)
      return(0.0);

   double steps=MathFloor(requestedLots/info.lotStep+0.000000001);
   if(steps<=0.0)
      return(0.0);
   return(NormalizeDouble(steps*info.lotStep, 8));
  }

bool BO_IsMarketOrder(int orderType)
  {
   return(orderType==OP_BUY || orderType==OP_SELL);
  }

bool BO_ShouldCloseOrder(int orderType, string orderSymbol, int orderMagic, string currentSymbol,
                         int currentMagic, bool accountWide)
  {
   if(!BO_IsMarketOrder(orderType))
      return(false);
   if(accountWide)
      return(true);
   return(orderSymbol==currentSymbol && orderMagic==currentMagic);
  }

bool BO_ValidatePlanStops(int orderType, double bid, double ask, BOOrderPlan &plan,
                          BOSymbolInfo &info, string &error)
  {
   error="";
   if(!BO_IsOpenOrder(orderType))
     {
      error="unsupported order type";
      return(false);
     }
   if(bid<=0.0 || ask<=0.0 || info.point<=0.0)
     {
      error="invalid market prices";
      return(false);
     }

   double reference=BO_IsMarketOrder(orderType) ? (BO_IsBuyOrder(orderType) ? bid : ask) : plan.referencePrice;
   double minimumDistance=info.stopLevelPoints*info.point;
   double tolerance=info.point*0.5;

   if(BO_IsBuyOrder(orderType))
     {
      if(plan.slPrice>0.0 && plan.slPrice>reference-minimumDistance+tolerance)
        {
         error="SL is closer than broker stop level";
         return(false);
        }
      if(plan.tpPrice>0.0 && plan.tpPrice<reference+minimumDistance-tolerance)
        {
         error="TP is closer than broker stop level";
         return(false);
        }
     }
   else
     {
      if(plan.slPrice>0.0 && plan.slPrice<reference+minimumDistance-tolerance)
        {
         error="SL is closer than broker stop level";
         return(false);
        }
      if(plan.tpPrice>0.0 && plan.tpPrice>reference-minimumDistance+tolerance)
        {
         error="TP is closer than broker stop level";
         return(false);
        }
     }

   return(true);
  }

bool BO_ValidateOrderSpec(BOOrderSpec &spec, double referencePrice, BOSymbolInfo &info, string &error)
  {
   error="";
   if(!BO_IsSupportedUnit(spec.slUnit) || !BO_IsSupportedUnit(spec.tpUnit))
     {
      error="unsupported SL/TP unit";
      return(false);
     }
   if(spec.slValue<0.0 || spec.tpValue<0.0 ||
      !MathIsValidNumber(spec.slValue) || !MathIsValidNumber(spec.tpValue))
     {
      error="SL/TP values must be zero or positive";
      return(false);
     }

   if(spec.slValue>0.0 && BO_DistanceFromValue(spec.slUnit, spec.slValue, referencePrice, info)<=0.0)
     {
      error="SL value cannot be converted";
      return(false);
     }
   if(spec.tpValue>0.0 && BO_DistanceFromValue(spec.tpUnit, spec.tpValue, referencePrice, info)<=0.0)
     {
      error="TP value cannot be converted";
      return(false);
     }
   return(true);
  }

bool BO_ComputeBatchPlans(int orderType, double bid, double ask, double equity, int lotMode,
                          double fixedLots, double riskPercent, int activeCount,
                          BOOrderSpec &specs[], BOSymbolInfo &info, BOOrderPlan &plans[], string &error, double pendingPrice=0.0)
  {
   error="";

   if(activeCount<1 || activeCount>BO_MAX_ROWS)
     {
      error="order count must be between 1 and 10";
      return(false);
     }
   if(!BO_IsOpenOrder(orderType))
     {
      error="unsupported order type";
      return(false);
     }
   if(bid<=0.0 || ask<=0.0 || equity<=0.0)
     {
      error="invalid account or market data";
      return(false);
     }
   if(lotMode!=BO_LOTS_FIXED && lotMode!=BO_LOTS_RISK)
     {
      error="unsupported lot mode";
      return(false);
     }
   if(info.point<=0.0 || info.digits<0 || info.tickSize<=0.0 || info.tickValue<=0.0 ||
      info.minLot<=0.0 || info.maxLot<=0.0 || info.lotStep<=0.0)
     {
      error="invalid broker symbol data";
      return(false);
     }
   if(lotMode==BO_LOTS_FIXED && fixedLots<=0.0)
     {
      error="fixed lots must be positive";
      return(false);
     }
   if(lotMode==BO_LOTS_RISK && (riskPercent<=0.0 || riskPercent>100.0))
     {
      error="risk percent must be greater than 0 and no more than 100";
      return(false);
     }

   if(!BO_ValidatePendingPrice(orderType, bid, ask, pendingPrice, info, error)) return(false);
   double referencePrice=BO_IsMarketOrder(orderType) ? (BO_IsBuyOrder(orderType) ? ask : bid) : pendingPrice;
   double totalRisk=equity*riskPercent/100.0;
   double riskPerRow=(lotMode==BO_LOTS_RISK ? totalRisk/activeCount : 0.0);
   bool anyInvalid=false;

   for(int i=0; i<activeCount; i++)
     {
      plans[i].valid=false;
      plans[i].cappedAtMaxLot=false;
      plans[i].error="";
      plans[i].referencePrice=referencePrice;
      plans[i].slDistance=0.0;
      plans[i].tpDistance=0.0;
      plans[i].slPrice=0.0;
      plans[i].tpPrice=0.0;
      plans[i].lots=0.0;
      plans[i].lossPerLot=0.0;

      string rowError="";
      if(!BO_ValidateOrderSpec(specs[i], referencePrice, info, rowError))
        {
         plans[i].error=StringFormat("row %d: %s", i+1, rowError);
         anyInvalid=true;
         continue;
        }

      plans[i].slDistance=BO_DistanceFromValue(specs[i].slUnit, specs[i].slValue, referencePrice, info);
      plans[i].tpDistance=BO_DistanceFromValue(specs[i].tpUnit, specs[i].tpValue, referencePrice, info);
      if(!BO_DirectionalPrices(orderType, referencePrice, plans[i].slDistance, plans[i].tpDistance,
                               info, plans[i].slPrice, plans[i].tpPrice))
        {
         plans[i].error=StringFormat("row %d: invalid directional prices", i+1);
         anyInvalid=true;
         continue;
        }

      plans[i].lossPerLot=BO_LossPerLot(plans[i].slDistance, info);
      if(lotMode==BO_LOTS_RISK)
        {
         if(plans[i].slDistance<=0.0 || plans[i].lossPerLot<=0.0)
           {
            plans[i].error=StringFormat("row %d: risk mode requires a valid SL", i+1);
            anyInvalid=true;
            continue;
           }

         double requestedLots=riskPerRow/plans[i].lossPerLot;
         if(requestedLots>info.maxLot)
           {
            plans[i].lots=BO_NormalizeLotsDown(info.maxLot, info);
            plans[i].cappedAtMaxLot=true;
           }
         else
            plans[i].lots=BO_NormalizeLotsDown(requestedLots, info);
        }
      else
        {
         if(fixedLots>info.maxLot)
           {
            plans[i].error=StringFormat("row %d: fixed lots exceed broker maximum", i+1);
            anyInvalid=true;
            continue;
           }
         plans[i].lots=BO_NormalizeLotsDown(fixedLots, info);
        }

      if(plans[i].lots<info.minLot || plans[i].lots<=0.0)
        {
         plans[i].error=StringFormat("row %d: lots are below broker minimum after step rounding", i+1);
         anyInvalid=true;
         continue;
        }

      if(!BO_ValidatePlanStops(orderType, bid, ask, plans[i], info, rowError))
        {
         plans[i].error=StringFormat("row %d: %s", i+1, rowError);
         anyInvalid=true;
         continue;
        }

      plans[i].valid=true;
     }

   if(anyInvalid)
     {
      for(int j=0; j<activeCount; j++)
        {
         if(!plans[j].valid && plans[j].error!="")
           {
            if(error!="")
               error+="; ";
            error+=plans[j].error;
           }
        }
      if(error=="")
         error="one or more order rows are invalid";
      return(false);
     }

   return(true);
  }

#endif
