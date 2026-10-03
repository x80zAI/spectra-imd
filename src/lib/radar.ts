import { useCallback, useEffect, useRef, useState } from 'react';
import type { Address, Hash } from 'viem';
import { RADAR_ENDPOINT, UNIT, publicClient } from './constants';
import { addressValue, hashValue, simpleError, unsignedInteger } from './format';

export type RadarCoin = {
  address: Address; name: string; symbol: string; creator: Address;
  supply: bigint; virtualImd: bigint; virtualCoin: bigint; realImd: bigint;
  tradeCount: bigint; volumeEth: bigint; createdAt: number; lastTradeAt: number | null; priceImd: bigint | null;
};
export type RadarTrade = {
  id: string; txHash: Hash; buy: boolean; trader: Address; ethAmount: bigint;
  coinAmount: bigint; imdAmount: bigint; timestamp: number; coinAddress: Address;
};
export type RadarSnapshot = {
  coins: RadarCoin[]; trades: RadarTrade[];
  stats: { coins: bigint; trades: bigint; volumeEth: bigint; imdBurned: bigint };
  fetchedAt: number; complete: boolean; indexerBlock: number; indexerTimestamp: number;
  tradeWindow: 'Latest 50 indexed trades';
};

export function record(value: unknown, label = 'Response'): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} has an invalid format.`);
  return value as Record<string, unknown>;
}

function textValue(value: unknown, label: string, max = 128): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max || [...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) {
    throw new Error(`${label} is invalid in the indexer response.`);
  }
  return value;
}

export function timestampValue(value: unknown, nullable = false): number | null {
  if (value === null && nullable) return null;
  const time = unsignedInteger(value, 'Timestamp');
  if (time > 9_999_999_999n || time < 1_500_000_000n) throw new Error('The indexer timestamp is invalid.');
  return Number(time);
}

export const indicativePriceImd = (virtualImd: bigint, virtualCoin: bigint): bigint | null => {
  if (virtualImd < 0n || virtualCoin < 0n) throw new Error('Virtual reserves must be nonnegative.');
  return virtualCoin === 0n ? null : virtualImd * UNIT / virtualCoin;
};

export function parseRadarCoin(value: unknown): RadarCoin {
  const item = record(value, 'Coin');
  const virtualImd = unsignedInteger(item.virtualImd, 'Virtual IMD');
  const virtualCoin = unsignedInteger(item.virtualCoin, 'Virtual coins');
  return {
    address: addressValue(item.address, 'Coin contract'), name: textValue(item.name, 'Coin name'),
    symbol: textValue(item.symbol, 'Coin symbol', 64), creator: addressValue(item.creator, 'Creator'),
    supply: unsignedInteger(item.supply, 'Supply'), virtualImd, virtualCoin,
    realImd: unsignedInteger(item.realImd, 'Real IMD backing'),
    tradeCount: unsignedInteger(item.tradeCount, 'Trade count'), volumeEth: unsignedInteger(item.volumeEth, 'ETH volume'),
    createdAt: timestampValue(item.createdAt)!, lastTradeAt: timestampValue(item.lastTradeAt, true),
    priceImd: indicativePriceImd(virtualImd, virtualCoin),
  };
}

export function parseRadarTrade(value: unknown): RadarTrade {
  const item = record(value, 'Trade');
  if (typeof item.buy !== 'boolean') throw new Error('The trade direction is invalid.');
  return {
    id: textValue(item.id, 'Trade ID', 150), txHash: hashValue(item.txHash), buy: item.buy,
    trader: addressValue(item.trader, 'Trader'), ethAmount: unsignedInteger(item.ethAmount, 'Trade ETH'),
    coinAmount: unsignedInteger(item.coinAmount, 'Trade coins'), imdAmount: unsignedInteger(item.imdAmount, 'Trade IMD'),
    timestamp: timestampValue(item.timestamp)!, coinAddress: addressValue(record(item.coin, 'Trade coin').address, 'Coin contract'),
  };
}

export function assertIndexerFreshness(indexerTimestamp: number, chainTimestamp: number, now = Date.now()): void {
  if (indexerTimestamp > chainTimestamp + 60 || chainTimestamp - indexerTimestamp > 900) {
    throw new Error('The indexer is behind Ethereum. Current prices and activity are temporarily unavailable.');
  }
  if (now / 1000 - chainTimestamp > 1_200 || chainTimestamp - now / 1000 > 300) {
    throw new Error('A fresh Ethereum block could not be verified. Please check your device clock and try again.');
  }
}

const COIN_FIELDS = 'address name symbol creator supply virtualImd virtualCoin realImd tradeCount volumeEth createdAt lastTradeAt';
async function graphql(query: string, variables: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const response = await fetch(RADAR_ENDPOINT, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error('The IMD indexer could not be reached.');
  const envelope = record(await response.json());
  if (envelope.errors) throw new Error('The IMD indexer did not return a complete response.');
  return record(envelope.data, 'Indexer data');
}

function parsePage(value: unknown): { items: unknown[]; hasNext: boolean; cursor: string | null; totalCount: number } {
  const page = record(value, 'Page');
  const info = record(page.pageInfo, 'Page information');
  if (!Array.isArray(page.items) || typeof info.hasNextPage !== 'boolean' ||
      !Number.isSafeInteger(page.totalCount) || (page.totalCount as number) < 0 ||
      (info.endCursor !== null && typeof info.endCursor !== 'string')) throw new Error('The indexer page is incomplete.');
  if (info.hasNextPage && (!info.endCursor || page.items.length === 0)) throw new Error('The indexer pagination is invalid.');
  return { items: page.items, hasNext: info.hasNextPage, cursor: info.endCursor as string | null, totalCount: page.totalCount as number };
}

export async function fetchRadar(signal?: AbortSignal): Promise<RadarSnapshot> {
  const firstQuery = `query Radar($after: String) {
    coins(orderBy:"createdAt",orderDirection:"desc",limit:100,after:$after){items{${COIN_FIELDS}}pageInfo{hasNextPage endCursor}totalCount}
    trades(orderBy:"timestamp",orderDirection:"desc",limit:50){items{id txHash buy trader ethAmount coinAmount imdAmount timestamp coin{address}}pageInfo{hasNextPage endCursor}totalCount}
    stats(id:"launchpad"){coins trades volumeEth imdBurned}
    _meta{status}
  }`;
  const [first, chain] = await Promise.all([graphql(firstQuery, { after: null }, signal), publicClient.getBlock()]);
  const status = record(record(record(first._meta, 'Indexer metadata').status).mainnet);
  if (status.id !== 1) throw new Error('The indexer is not reporting Ethereum mainnet.');
  const block = record(status.block, 'Indexer block');
  const indexerBlock = unsignedInteger(block.number, 'Indexer block');
  if (indexerBlock > BigInt(Number.MAX_SAFE_INTEGER) || indexerBlock > chain.number + 5n) throw new Error('The indexer block is invalid.');
  const indexerTimestamp = timestampValue(block.timestamp)!;
  assertIndexerFreshness(indexerTimestamp, Number(chain.timestamp));
  let page = parsePage(first.coins);
  const expected = page.totalCount;
  const coins = page.items.map(parseRadarCoin);
  let stableCount = true;
  const seenCursors = new Set<string>();
  const pageQuery = `query Coins($after:String){coins(orderBy:"createdAt",orderDirection:"desc",limit:100,after:$after){items{${COIN_FIELDS}}pageInfo{hasNextPage endCursor}totalCount}}`;
  // Bound both cost and response size. A capped catalogue is explicitly marked incomplete.
  for (let i = 1; page.hasNext && i < 20; i++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (!page.cursor || seenCursors.has(page.cursor)) throw new Error('The indexer repeated a page.');
    seenCursors.add(page.cursor);
    page = parsePage((await graphql(pageQuery, { after: page.cursor }, signal)).coins);
    stableCount = stableCount && page.totalCount === expected;
    coins.push(...page.items.map(parseRadarCoin));
  }
  const addresses = new Set(coins.map(coin => coin.address.toLowerCase()));
  if (addresses.size !== coins.length) throw new Error('The indexer returned duplicate coin contracts. Refresh to load a consistent catalogue.');
  const stats = record(first.stats, 'Ecosystem statistics');
  const parsedStats = {
    coins: unsignedInteger(stats.coins, 'Coin count'), trades: unsignedInteger(stats.trades, 'Trade count'),
    volumeEth: unsignedInteger(stats.volumeEth, 'ETH volume'), imdBurned: unsignedInteger(stats.imdBurned, 'IMD burned'),
  };
  const trades = parsePage(first.trades).items.map(parseRadarTrade);
  if (new Set(trades.map(trade => trade.id)).size !== trades.length) throw new Error('The indexer returned duplicate trades.');
  if (coins.some(coin => coin.createdAt > indexerTimestamp + 60 || (coin.lastTradeAt ?? 0) > indexerTimestamp + 60) ||
      trades.some(trade => trade.timestamp > indexerTimestamp + 60)) throw new Error('The indexer contains unverified future activity.');
  return {
    coins, trades, stats: parsedStats, fetchedAt: Date.now(), indexerBlock: Number(indexerBlock), indexerTimestamp,
    complete: !page.hasNext && stableCount && coins.length === expected && parsedStats.coins === BigInt(expected),
    tradeWindow: 'Latest 50 indexed trades',
  };
}

export function useRadar() {
  const [state, setState] = useState<{ data: RadarSnapshot | null; status: 'loading' | 'ready' | 'error'; error: string | null }>({ data: null, status: 'loading', error: null });
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion(value => value + 1), []);
  const request = useRef(0);
  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      const id = ++request.current;
      try {
        const data = await fetchRadar(controller.signal);
        if (!controller.signal.aborted && request.current === id) setState({ data, status: 'ready', error: null });
      } catch (error) {
        if (!controller.signal.aborted && request.current === id) setState({ data: null, status: 'error', error: simpleError(error) });
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [version]);
  return { ...state, refresh };
}
