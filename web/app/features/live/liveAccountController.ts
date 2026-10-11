import { liveAccountRuntimeDefaultsForMarket, type AppSettings } from "../settings/settingsContracts.ts";
import { accountMarketValue, type LiveMarketAccountSnapshot } from "../../lib/tradingAccount.ts";

export type LiveAccountLifecycleType = "pause-account" | "resume-account" | "end-account" | "switch-account" | "reset-account";

export function buildLiveAccountLifecycleCommand(
  account: LiveMarketAccountSnapshot,
  type: LiveAccountLifecycleType,
  settings: AppSettings,
  commandId: string,
  newAccountId: string,
  timestamp: number,
) {
  const defaults = liveAccountRuntimeDefaultsForMarket(settings, account.market);
  return {
    commandId, type, environment: "live" as const,
    accountId: account.id, market: account.market, timestamp,
    observedAccountVersion: account.version,
    ...(type === "reset-account" ? {
      newAccountId,
      tradingMode: defaults.tradingMode,
      initialCapital: defaults.tradingMode === "capital" ? defaults.initialCapital : null,
      riskCapital: defaults.tradingMode === "return" ? defaults.initialCapital : null,
      displayName: account.displayName,
      executionProfile: { ...settings.executionProfile },
      executionProfileVersion: settings.executionProfileVersion,
    } : {}),
  };
}

export function livePortfolioMatchesScope(
  portfolio: { accountId?: string },
  scope: string,
  accounts: Pick<LiveMarketAccountSnapshot, "id" | "status">[],
) {
  if (scope === "all") return true;
  const account = accounts.find(item => item.id === portfolio.accountId);
  if (scope === "unlinked") return !account;
  if (scope === "current") return Boolean(account && account.status !== "archived");
  return account?.id === scope;
}

type MarkedPortfolio = {
  accountId?: string;
  instrumentId: string;
  latestClose: number;
  positions: Parameters<typeof accountMarketValue>[0];
};

export function sharedLiveAccountEquity(
  account: Pick<LiveMarketAccountSnapshot, "id" | "tradingMode" | "cashBalance" | "equity">,
  portfolios: MarkedPortfolio[],
  current?: { instrumentId: string; price: number; positions: MarkedPortfolio["positions"] },
) {
  if (account.tradingMode !== "capital") return account.equity;
  return account.cashBalance + portfolios.filter(item => item.accountId === account.id).reduce((sum, item) => (
    sum + accountMarketValue(
      current?.instrumentId === item.instrumentId ? current.positions : item.positions,
      current?.instrumentId === item.instrumentId ? current.price : item.latestClose,
    )
  ), 0);
}
