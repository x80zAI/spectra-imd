import { useCallback, useEffect, useState } from 'react';
import { decodeEventLog, encodeDeployData, type Abi, type Address, type Hash, type Hex } from 'viem';
import { IMD_ADDRESS, POOL_REWARD_BUDGET, PROGRAM_DURATION, TOKEN_SUPPLY, UNIT, factoryAbi, poolAbi, publicClient, tokenAbi } from './constants';
import { addressValue, hashValue, simpleError } from './format';
import { record } from './radar';

export type Deployment = {
  chainId: 1; factory: Address; token: Address; spectraPool: Address; imdPool: Address; treasury: Address; deploymentTx: Hash;
};
const DEPLOYMENT_KEYS = ['chainId', 'factory', 'token', 'spectraPool', 'imdPool', 'treasury', 'deploymentTx'];
export function parseDeployment(value: unknown): Deployment | null {
  if (value === null) return null;
  const item = record(value, 'Deployment configuration');
  if (Object.keys(item).length !== DEPLOYMENT_KEYS.length || !DEPLOYMENT_KEYS.every(key => Object.hasOwn(item, key)) || item.chainId !== 1) {
    throw new Error('The deployment configuration must describe Ethereum mainnet with every required field.');
  }
  const deployment: Deployment = {
    chainId: 1, factory: addressValue(item.factory), token: addressValue(item.token),
    spectraPool: addressValue(item.spectraPool), imdPool: addressValue(item.imdPool),
    treasury: addressValue(item.treasury), deploymentTx: hashValue(item.deploymentTx),
  };
  const contracts = [deployment.factory, deployment.token, deployment.spectraPool, deployment.imdPool, deployment.treasury, IMD_ADDRESS].map(address => address.toLowerCase());
  if (new Set(contracts).size !== contracts.length) throw new Error('Deployment addresses must be distinct.');
  return deployment;
}

type ImmutableReference = { start: number; length: number };
export function runtimeMatches(actual: Hex, expected: Hex, immutableReferences: unknown = {}): boolean {
  if (!/^0x(?:[a-f0-9]{2})+$/i.test(actual) || !/^0x(?:[a-f0-9]{2})+$/i.test(expected) || actual.length !== expected.length) return false;
  const references = record(immutableReferences, 'Immutable references');
  let normalizedActual = actual.toLowerCase();
  let normalizedExpected = expected.toLowerCase();
  for (const slots of Object.values(references)) {
    if (!Array.isArray(slots)) return false;
    for (const slot of slots) {
      const entry = record(slot) as unknown as ImmutableReference;
      if (!Number.isSafeInteger(entry.start) || !Number.isSafeInteger(entry.length) || entry.start < 0 || entry.length !== 32 || entry.start * 2 + entry.length * 2 > actual.length - 2) return false;
      const from = 2 + entry.start * 2;
      const to = from + entry.length * 2;
      normalizedActual = normalizedActual.slice(0, from) + '0'.repeat(entry.length * 2) + normalizedActual.slice(to);
      normalizedExpected = normalizedExpected.slice(0, from) + '0'.repeat(entry.length * 2) + normalizedExpected.slice(to);
    }
  }
  return normalizedActual === normalizedExpected;
}

const equalAddress = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();

export async function verifyDeployment(deployment: Deployment): Promise<void> {
  // Pin all state checks to one block, so principal and rewards are compared coherently.
  const blockNumber = await publicClient.getBlockNumber();
  const read = <T extends typeof factoryAbi | typeof poolAbi | typeof tokenAbi>(address: Address, abi: T) => ({ address, abi, blockNumber });
  const [chainId, factoryCode, tokenCode, spectraCode, imdCode, originalCode, artifactResponse, receipt, transaction] = await Promise.all([
    publicClient.getChainId(),
    publicClient.getBytecode({ address: deployment.factory, blockNumber }),
    publicClient.getBytecode({ address: deployment.token, blockNumber }),
    publicClient.getBytecode({ address: deployment.spectraPool, blockNumber }),
    publicClient.getBytecode({ address: deployment.imdPool, blockNumber }),
    publicClient.getBytecode({ address: IMD_ADDRESS, blockNumber }),
    fetch('/contracts.json', { cache: 'no-store', signal: AbortSignal.timeout(20_000) }),
    publicClient.getTransactionReceipt({ hash: deployment.deploymentTx }),
    publicClient.getTransaction({ hash: deployment.deploymentTx }),
  ]);
  if (chainId !== 1 || !factoryCode || !tokenCode || !spectraCode || !imdCode || !originalCode || !artifactResponse.ok) {
    throw new Error('The Ethereum contracts could not be verified. Staking is unavailable.');
  }
  const artifacts = record(await artifactResponse.json(), 'Contract artifacts');
  for (const [key, code] of [['factory', factoryCode], ['token', tokenCode], ['pool', spectraCode], ['pool', imdCode]] as const) {
    const artifact = record(artifacts[key], 'Contract artifact');
    if (typeof artifact.deployedBytecode !== 'string' || !runtimeMatches(code, artifact.deployedBytecode as Hex, artifact.immutableReferences)) {
      throw new Error('The published contract code does not match this project. Staking is unavailable.');
    }
  }
  const factoryArtifact = record(artifacts.factory, 'Factory artifact');
  if (!Array.isArray(factoryArtifact.abi) || typeof factoryArtifact.bytecode !== 'string') throw new Error('The factory build artifact is invalid.');
  const expectedInput = encodeDeployData({ abi: factoryArtifact.abi as Abi, bytecode: factoryArtifact.bytecode as Hex, args: [IMD_ADDRESS] });
  if (receipt.status !== 'success' || !receipt.contractAddress || !equalAddress(receipt.contractAddress, deployment.factory) ||
      !equalAddress(receipt.from, deployment.treasury) || transaction.to !== null || !equalAddress(transaction.from, deployment.treasury) ||
      transaction.input.toLowerCase() !== expectedInput.toLowerCase()) {
    throw new Error('The deployment transaction does not match the configured factory.');
  }
  const creation = receipt.logs.filter(log => equalAddress(log.address, deployment.factory)).flatMap(log => {
    try { return [decodeEventLog({ abi: factoryAbi, data: log.data, topics: log.topics, eventName: 'ProjectCreated' })]; }
    catch { return []; }
  });
  if (creation.length !== 1) throw new Error('The verified project creation event was not found.');
  const args = creation[0].args;
  if (!equalAddress(args.treasury, deployment.treasury) || !equalAddress(args.token, deployment.token) ||
      !equalAddress(args.spectraPool, deployment.spectraPool) || !equalAddress(args.imdPool, deployment.imdPool) || !equalAddress(args.imdToken, IMD_ADDRESS)) {
    throw new Error('The project creation event does not match the deployment configuration.');
  }
  const f = read(deployment.factory, factoryAbi);
  const t = read(deployment.token, tokenAbi);
  const [treasury, imdToken, token, spectraPool, imdPool, budget, treasuryAllocation, name, symbol, decimals, supply, imdDecimals, imdSymbol] = await Promise.all([
    publicClient.readContract({ ...f, functionName: 'treasury' }), publicClient.readContract({ ...f, functionName: 'imdToken' }),
    publicClient.readContract({ ...f, functionName: 'token' }), publicClient.readContract({ ...f, functionName: 'spectraPool' }),
    publicClient.readContract({ ...f, functionName: 'imdPool' }), publicClient.readContract({ ...f, functionName: 'POOL_REWARDS' }),
    publicClient.readContract({ ...f, functionName: 'TREASURY_ALLOCATION' }),
    publicClient.readContract({ ...t, functionName: 'name' }), publicClient.readContract({ ...t, functionName: 'symbol' }),
    publicClient.readContract({ ...t, functionName: 'decimals' }), publicClient.readContract({ ...t, functionName: 'totalSupply' }),
    publicClient.readContract({ address: IMD_ADDRESS, abi: tokenAbi, blockNumber, functionName: 'decimals' }),
    publicClient.readContract({ address: IMD_ADDRESS, abi: tokenAbi, blockNumber, functionName: 'symbol' }),
  ]);
  if (!equalAddress(treasury as string, deployment.treasury) || !equalAddress(imdToken as string, IMD_ADDRESS) ||
      !equalAddress(token as string, deployment.token) || !equalAddress(spectraPool as string, deployment.spectraPool) ||
      !equalAddress(imdPool as string, deployment.imdPool) || budget !== POOL_REWARD_BUDGET || treasuryAllocation !== 8_000_000n * UNIT ||
      name !== 'Spectra IMD' || symbol !== 'SPECTRA' || decimals !== 18 || supply !== TOKEN_SUPPLY || imdDecimals !== 18 || imdSymbol !== 'IMD') {
    throw new Error('The token or staking configuration does not match the fixed project terms.');
  }
  await Promise.all((['spectra', 'imd'] as const).map(async kind => {
    const address = kind === 'spectra' ? deployment.spectraPool : deployment.imdPool;
    const p = read(address, poolAbi);
    const [stakeToken, rewardsToken, poolTreasury, rewardBudget, duration, totalStaked, outstanding, rewardBalance, stakeBalance, start, finish, rewardRate] = await Promise.all([
      publicClient.readContract({ ...p, functionName: 'stakingToken' }), publicClient.readContract({ ...p, functionName: 'rewardsToken' }),
      publicClient.readContract({ ...p, functionName: 'treasury' }), publicClient.readContract({ ...p, functionName: 'rewardBudget' }),
      publicClient.readContract({ ...p, functionName: 'DURATION' }), publicClient.readContract({ ...p, functionName: 'totalStaked' }),
      publicClient.readContract({ ...p, functionName: 'outstandingRewards' }),
      publicClient.readContract({ ...t, functionName: 'balanceOf', args: [address] }),
      publicClient.readContract({ address: kind === 'spectra' ? deployment.token : IMD_ADDRESS, abi: tokenAbi, blockNumber, functionName: 'balanceOf', args: [address] }),
      publicClient.readContract({ ...p, functionName: 'startTime' }), publicClient.readContract({ ...p, functionName: 'finishTime' }),
      publicClient.readContract({ ...p, functionName: 'rewardRate' }),
    ]);
    if (!equalAddress(stakeToken as string, kind === 'spectra' ? deployment.token : IMD_ADDRESS) || !equalAddress(rewardsToken as string, deployment.token) ||
        !equalAddress(poolTreasury as string, deployment.treasury) || rewardBudget !== POOL_REWARD_BUDGET || duration !== PROGRAM_DURATION ||
        rewardRate !== POOL_REWARD_BUDGET / PROGRAM_DURATION || (start === 0n ? finish !== 0n : finish !== (start as bigint) + PROGRAM_DURATION) ||
        (stakeBalance as bigint) < (totalStaked as bigint) || (rewardBalance as bigint) < (outstanding as bigint) + (kind === 'spectra' ? totalStaked as bigint : 0n) ||
        (start === 0n && (rewardBalance as bigint) < POOL_REWARD_BUDGET)) {
      throw new Error('The staking pool configuration or protected funding could not be verified.');
    }
  }));
}

export async function loadDeployment(signal?: AbortSignal): Promise<Deployment | null> {
  const response = await fetch('/deployment.json', { cache: 'no-store', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error('The project deployment configuration could not be loaded.');
  const deployment = parseDeployment(await response.json());
  if (deployment) await verifyDeployment(deployment);
  return deployment;
}

export function useDeployment() {
  const [state, setState] = useState<{ deployment: Deployment | null; status: 'loading' | 'not-deployed' | 'ready' | 'error'; error: string | null }>({ deployment: null, status: 'loading', error: null });
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion(value => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    void loadDeployment(controller.signal).then(deployment => {
      if (!controller.signal.aborted) setState({ deployment, status: deployment ? 'ready' : 'not-deployed', error: null });
    }).catch(error => {
      if (!controller.signal.aborted) setState({ deployment: null, status: 'error', error: simpleError(error) });
    });
    return () => controller.abort();
  }, [version]);
  return { ...state, refresh };
}
