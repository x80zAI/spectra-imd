import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  UNIT, addressValue, assertIndexerFreshness, fetchRadar, formatAmount, indicativePriceImd,
  parseChainId, parseDeployment, parseRadarCoin, parseRadarTrade, parseTokenAmount, publicClient,
  runtimeMatches, unsignedInteger,
} from '../src/lib';

const addr = (digit: string) => `0x${digit.repeat(40)}`;
const hash = `0x${'a'.repeat(64)}`;
const timestamp = Math.floor(Date.now() / 1000);
const coin = (digit = '1') => ({
  address: addr(digit), creator: addr('f'), name: 'A coin', symbol: 'COIN', supply: '1000000000000000000000000000',
  virtualImd: '123456789012345678901234567890', virtualCoin: '9999999999999999999999999999999999',
  realImd: '1234', tradeCount: 0, volumeEth: '0', createdAt: String(timestamp - 100), lastTradeAt: null,
});
const page = (items: unknown[], hasNext = false, cursor: string | null = null) => ({ items, pageInfo: { hasNextPage: hasNext, endCursor: cursor }, totalCount: 3 });
const firstResponse = () => ({ data: {
  coins: page([coin('1'), coin('2')], true, 'cursor-one'), trades: { ...page([]), totalCount: 0 },
  stats: { coins: 3, trades: 0, volumeEth: '0', imdBurned: '0' },
  _meta: { status: { mainnet: { id: 1, block: { number: 100, timestamp } } } },
} });

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('exact token amounts', () => {
  it('preserves large integer and smallest token unit without floating point rounding', () => {
    expect(parseTokenAmount('9007199254740993.000000000000000001')).toBe(9007199254740993n * UNIT + 1n);
    expect(formatAmount(9007199254740993n * UNIT + 2345n * 10n ** 14n, 18, 4)).toBe('9,007,199,254,740,993.2345');
    expect(formatAmount(1n)).toBe('<0.0001');
    expect(formatAmount(0n)).toBe('0');
  });
  it.each(['0', '-1', '1e18', '1,000', '+1', '.1', '1.', '01', 'NaN', '1.0000000000000000001'])('rejects ambiguous or invalid amount %s', value => {
    expect(() => parseTokenAmount(value)).toThrow();
  });
  it('rejects uint256 overflow and imprecise JSON numbers', () => {
    expect(() => unsignedInteger(Number.MAX_SAFE_INTEGER + 1)).toThrow();
    expect(() => unsignedInteger((2n ** 256n).toString())).toThrow();
    expect(() => parseTokenAmount((2n ** 256n).toString())).toThrow();
  });
  it('computes indicative price using integer reserves while preserving actual backing separately', () => {
    const item = parseRadarCoin(coin());
    expect(item.priceImd).toBe(BigInt(coin().virtualImd) * UNIT / BigInt(coin().virtualCoin));
    expect(item.realImd).toBe(1234n);
    expect(indicativePriceImd(1n, 0n)).toBeNull();
  });
});

describe('configuration and live response integrity', () => {
  const deployment = { chainId: 1, factory: addr('1'), token: addr('2'), spectraPool: addr('3'), imdPool: addr('4'), treasury: addr('5'), deploymentTx: hash };
  it('keeps unactivated contracts unavailable and requires every real deployment field', () => {
    expect(parseDeployment(null)).toBeNull();
    expect(parseDeployment(deployment)?.chainId).toBe(1);
    expect(() => parseDeployment({ ...deployment, token: null })).toThrow();
    expect(() => parseDeployment({ ...deployment, chainId: 11155111 })).toThrow();
    expect(() => parseDeployment({ ...deployment, approved: true })).toThrow();
    expect(() => parseDeployment({ ...deployment, spectraPool: deployment.token })).toThrow();
    expect(() => addressValue(`0x${'0'.repeat(40)}`)).toThrow();
  });
  it('compares runtime code while ignoring only valid 32 byte immutable locations', () => {
    const expected = `0x01${'0'.repeat(64)}02` as const;
    const actual = `0x01${'f'.repeat(64)}02` as const;
    expect(runtimeMatches(actual, expected, { slot: [{ start: 1, length: 32 }] })).toBe(true);
    expect(runtimeMatches(`0x03${'f'.repeat(64)}02`, expected, { slot: [{ start: 1, length: 32 }] })).toBe(false);
    expect(runtimeMatches(actual, expected, { slot: [{ start: 0, length: 34 }] })).toBe(false);
    expect(runtimeMatches(actual, expected)).toBe(false);
  });
  it('rejects missing and malformed coin/trade fields instead of replacing them with zero', () => {
    expect(() => parseRadarCoin({ ...coin(), realImd: undefined })).toThrow();
    expect(() => parseRadarCoin({ ...coin(), tradeCount: -1 })).toThrow();
    expect(() => parseRadarCoin({ ...coin(), virtualImd: '1.2' })).toThrow();
    expect(() => parseRadarTrade({ buy: 'true' })).toThrow();
    expect(() => parseChainId('1')).toThrow();
    expect(parseChainId('0x1')).toBe(1);
  });
  it('rejects an indexer lagging Ethereum or a stale/future chain timestamp', () => {
    const now = timestamp * 1000;
    expect(() => assertIndexerFreshness(timestamp - 901, timestamp, now)).toThrow(/behind/);
    expect(() => assertIndexerFreshness(timestamp, timestamp - 61, now)).toThrow(/behind/);
    expect(() => assertIndexerFreshness(timestamp - 1300, timestamp - 1300, now)).toThrow(/fresh/);
    expect(() => assertIndexerFreshness(timestamp + 400, timestamp + 400, now)).toThrow(/clock/);
    expect(() => assertIndexerFreshness(timestamp - 12, timestamp, now)).not.toThrow();
  });
});

describe('paginated IMD catalogue', () => {
  function mockBlock() {
    vi.spyOn(publicClient, 'getBlock').mockResolvedValue({ number: 101n, timestamp: BigInt(timestamp) } as Awaited<ReturnType<typeof publicClient.getBlock>>);
  }
  it('follows cursor pagination and only marks a complete consistent catalogue complete', async () => {
    mockBlock();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(firstResponse()), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { coins: page([coin('3')]) } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const snapshot = await fetchRadar();
    expect(snapshot.coins).toHaveLength(3);
    expect(snapshot.complete).toBe(true);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).variables.after).toBe('cursor-one');
    expect(snapshot.tradeWindow).toBe('Latest 50 indexed trades');
  });
  it('rejects duplicate page results rather than counting a coin twice', async () => {
    mockBlock();
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(firstResponse()), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { coins: page([coin('1')]) } }), { status: 200 })));
    await expect(fetchRadar()).rejects.toThrow(/duplicate/);
  });
  it('fails closed when the indexer metadata is stale', async () => {
    mockBlock();
    const response = firstResponse();
    response.data._meta.status.mainnet.block.timestamp = timestamp - 1000;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(response), { status: 200 })));
    await expect(fetchRadar()).rejects.toThrow(/behind/);
  });
});
