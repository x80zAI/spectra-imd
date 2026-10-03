import { env, stdout } from 'node:process';
import { expect, it } from 'vitest';
import { fetchRadar, IMD_ADDRESS, publicClient, tokenAbi } from '../src/lib';

// Opt-in check of public mainnet sources. This never requests a wallet or sends a transaction.
it.skipIf(env.SPECTRA_LIVE_VERIFY !== '1')('verifies the live IMD catalogue and mainnet token metadata', async () => {
  const [radar, decimals, symbol] = await Promise.all([
    fetchRadar(),
    publicClient.readContract({ address: IMD_ADDRESS, abi: tokenAbi, functionName: 'decimals' }),
    publicClient.readContract({ address: IMD_ADDRESS, abi: tokenAbi, functionName: 'symbol' }),
  ]);
  expect(radar.complete).toBe(true);
  expect(BigInt(radar.coins.length)).toBe(radar.stats.coins);
  expect(radar.trades.length).toBeLessThanOrEqual(50);
  expect(decimals).toBe(18);
  expect(symbol).toBe('IMD');
  stdout.write(`Verified ${radar.coins.length} coin contracts, ${radar.trades.length} recent indexed trades, indexer block ${radar.indexerBlock}, Ethereum mainnet IMD metadata.\n`);
}, 60_000);
