export type Decision = "allow" | "review" | "do_not_trade";

export type Side = "buy" | "sell";

export type OrderType = "limit" | "market";

export interface TradeProposal {
  dex: string;
  asset: string;
  side: Side;
  size: string;
  leverage?: number;
  order_type?: OrderType;
  limit_px?: string;
}

export interface AssetMeta {
  name: string;
  szDecimals: number;
  maxLeverage: number;
  marginTableId?: number;
  growthMode?: string;
  lastFeeScaleChangeTime?: string;
  deployerFeeScale?: string;
  isDelisted?: boolean;
  [key: string]: unknown;
}

export interface AssetCtx {
  funding: string;
  openInterest: string;
  prevDayPx?: string;
  dayNtlVlm?: string;
  premium?: string;
  oraclePx?: string;
  markPx: string;
  midPx?: string;
  impactPxs?: string[];
  dayBaseVlm?: string;
  [key: string]: unknown;
}

export interface Meta {
  universe: AssetMeta[];
  collateralToken?: number;
  [key: string]: unknown;
}

export interface Snapshot {
  dex: string;
  meta: Meta;
  assetCtxs: AssetCtx[];
}

export interface EvaluateTradeResult {
  decision: Decision;
  reasons: string[];
  summary: string;
  asset?: string;
  markPx?: string;
  notionalUsdc?: string;
  funding?: string;
}
