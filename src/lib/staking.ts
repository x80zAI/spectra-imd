import { useCallback, useEffect, useState } from 'react';
import { createWalletClient, custom, decodeEventLog, type Address, type EIP1193Provider, type Hash } from 'viem';
import { mainnet } from 'viem/chains';
import { IMD_ADDRESS, poolAbi, publicClient, tokenAbi } from './constants';
import { type Deployment, verifyDeployment } from './deployment';
import { addressValue, parseTokenAmount, simpleError } from './format';
import { assertWalletContext } from './wallet';

export type PoolKind = 'spectra' | 'imd';
export type PoolAction = 'approve' | 'reset-approval' | 'stake' | 'withdraw' | 'claim' | 'exit';
export type PoolPosition = {
  walletBalance: bigint; staked: bigint; earned: bigint; allowance: bigint; totalStaked: bigint;
  rewardBudget: bigint; rewardsPaid: bigint; startTime: bigint; endTime: bigint; blockNumber: bigint; readAt: number;
};
const poolAddress = (deployment: Deployment, kind: PoolKind) => kind === 'spectra' ? deployment.spectraPool : deployment.imdPool;
const stakeToken = (deployment: Deployment, kind: PoolKind) => kind === 'spectra' ? deployment.token : IMD_ADDRESS;

export async function readPoolPosition(deployment: Deployment, kind: PoolKind, account: Address): Promise<PoolPosition> {
  const owner = addressValue(account);
  const blockNumber = await publicClient.getBlockNumber();
  const address = poolAddress(deployment, kind);
  const token = stakeToken(deployment, kind);
  const p = { address, abi: poolAbi, blockNumber };
  const t = { address: token, abi: tokenAbi, blockNumber };
  const [walletBalance, staked, earned, allowance, totalStaked, rewardBudget, rewardsPaid, startTime, endTime] = await Promise.all([
    publicClient.readContract({ ...t, functionName: 'balanceOf', args: [owner] }),
    publicClient.readContract({ ...p, functionName: 'balanceOf', args: [owner] }),
    publicClient.readContract({ ...p, functionName: 'earned', args: [owner] }),
    publicClient.readContract({ ...t, functionName: 'allowance', args: [owner, address] }),
    publicClient.readContract({ ...p, functionName: 'totalStaked' }),
    publicClient.readContract({ ...p, functionName: 'rewardBudget' }),
    publicClient.readContract({ ...p, functionName: 'claimedRewards' }),
    publicClient.readContract({ ...p, functionName: 'startTime' }),
    publicClient.readContract({ ...p, functionName: 'finishTime' }),
  ]);
  return { walletBalance, staked, earned, allowance, totalStaked, rewardBudget, rewardsPaid, startTime, endTime, blockNumber, readAt: Date.now() };
}

export async function executePoolAction(input: {
  deployment: Deployment; kind: PoolKind; provider: EIP1193Provider; account: Address; action: PoolAction; amount?: string;
}): Promise<Hash> {
  const { deployment, kind, provider, action } = input;
  const account = addressValue(input.account);
  const needsAmount = action === 'approve' || action === 'stake' || action === 'withdraw';
  const amount = needsAmount ? parseTokenAmount(input.amount ?? '') : 0n;
  await assertWalletContext(provider, account);
  await verifyDeployment(deployment);
  const position = await readPoolPosition(deployment, kind, account);
  const address = poolAddress(deployment, kind);
  const token = stakeToken(deployment, kind);
  if ((action === 'approve' || action === 'stake') && amount > position.walletBalance) throw new Error('The amount exceeds your current token balance.');
  if (action === 'stake' && position.allowance < amount) throw new Error('Approve this amount first, then choose Stake in a separate transaction.');
  if (action === 'withdraw' && amount > position.staked) throw new Error('The withdrawal amount exceeds your current stake.');
  if (action === 'claim' && position.earned === 0n) throw new Error('There are no earned rewards to claim.');
  if (action === 'exit' && position.earned === 0n && position.staked === 0n) throw new Error('There are no deposits or earned rewards to withdraw.');
  if (action === 'reset-approval' && position.allowance === 0n) throw new Error('This pool already has no token approval.');
  const client = createWalletClient({ chain: mainnet, transport: custom(provider) });
  // Every call below prepares and sends exactly one transaction. No automatic follow-up approval or stake.
  let hash: Hash;
  if (action === 'approve' || action === 'reset-approval') {
    let simulation;
    try {
      simulation = await publicClient.simulateContract({ address: token, abi: tokenAbi, functionName: 'approve', args: [address, action === 'reset-approval' ? 0n : amount], account });
    } catch (error) {
      if (action === 'approve' && position.allowance > 0n) throw new Error('This token may require resetting its existing approval to zero. Choose Reset approval first, then approve your amount.', { cause: error });
      throw error;
    }
    if (simulation.result !== true) throw new Error('The token did not confirm that the approval can be completed.');
    await assertWalletContext(provider, account);
    hash = await client.writeContract(simulation.request);
  } else if (action === 'stake' || action === 'withdraw') {
    const simulation = await publicClient.simulateContract({ address, abi: poolAbi, functionName: action, args: [amount], account });
    await assertWalletContext(provider, account);
    hash = await client.writeContract(simulation.request);
  } else {
    const simulation = await publicClient.simulateContract({ address, abi: poolAbi, functionName: action, account });
    await assertWalletContext(provider, account);
    hash = await client.writeContract(simulation.request);
  }
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 2, timeout: 180_000 });
  if (receipt.status !== 'success') throw new Error('The transaction failed on Ethereum. Check its receipt before trying again.');
  const same = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();
  if (!same(receipt.from, account) || !receipt.to || !same(receipt.to, action === 'approve' || action === 'reset-approval' ? token : address)) {
    throw new Error(`The transaction receipt did not match your chosen action. Review transaction ${receipt.transactionHash} on Etherscan.`);
  }
  if (action === 'approve' || action === 'reset-approval') {
    const approval = receipt.logs.filter(log => same(log.address, token)).some(log => {
      try {
        const event = decodeEventLog({ abi: tokenAbi, eventName: 'Approval', data: log.data, topics: log.topics });
        return same(event.args.owner, account) && same(event.args.spender, address) && event.args.value === (action === 'reset-approval' ? 0n : amount);
      } catch { return false; }
    });
    if (!approval) throw new Error(`The expected token approval was not found. Review transaction ${receipt.transactionHash} on Etherscan.`);
  } else {
    const events = receipt.logs.filter(log => same(log.address, address)).flatMap(log => {
      try { return [decodeEventLog({ abi: poolAbi, data: log.data, topics: log.topics })]; }
      catch { return []; }
    });
    const verified = events.some(event => {
      if (!same(event.args.account, account)) return false;
      if (action === 'stake') return event.eventName === 'Staked' && event.args.amount === amount;
      if (action === 'withdraw') return event.eventName === 'Withdrawn' && event.args.amount === amount;
      if (action === 'claim') return event.eventName === 'RewardPaid' && event.args.amount > 0n;
      return (event.eventName === 'Withdrawn' || event.eventName === 'RewardPaid') && event.args.amount > 0n;
    });
    if (!verified) throw new Error(`The expected staking event was not found. Review transaction ${receipt.transactionHash} on Etherscan.`);
  }
  // Re-read the effect of the confirmed transaction. The UI is refreshed independently for the currently selected account.
  // A temporary read failure must not hide a transaction already confirmed by Ethereum.
  await Promise.allSettled([readPoolPosition(deployment, kind, account)]);
  return receipt.transactionHash;
}

type ReadState<T> = { key: string; data: T | null; status: 'loading' | 'ready' | 'error'; error: string | null };
export function usePoolPosition(deployment: Deployment | null, kind: PoolKind, account: Address | null) {
  const key = deployment && account ? `${deployment.factory}:${kind}:${account}` : '';
  const [state, setState] = useState<ReadState<PoolPosition>>({ key: '', data: null, status: 'loading', error: null });
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion(value => value + 1), []);
  useEffect(() => {
    if (!deployment || !account) return;
    let active = true;
    let sequence = 0;
    const load = async () => {
      const current = ++sequence;
      try {
        const data = await readPoolPosition(deployment, kind, account);
        if (active && sequence === current) setState({ key, data, status: 'ready', error: null });
      } catch (error) {
        if (active && sequence === current) setState({ key, data: null, status: 'error', error: simpleError(error) });
      }
    };
    void load();
    const interval = window.setInterval(() => void load(), 15_000);
    return () => { active = false; window.clearInterval(interval); };
  }, [deployment, account, kind, key, version]);
  if (!key) return { data: null, status: 'idle' as const, error: null, refresh };
  if (state.key !== key) return { data: null, status: 'loading' as const, error: null, refresh };
  return { data: state.data, status: state.status, error: state.error, refresh };
}

export type Portfolio = { imd: bigint; spectra: bigint | null };
export async function readPortfolio(deployment: Deployment | null, account: Address): Promise<Portfolio> {
  const owner = addressValue(account);
  const blockNumber = await publicClient.getBlockNumber();
  const [imd, spectra] = await Promise.all([
    publicClient.readContract({ address: IMD_ADDRESS, abi: tokenAbi, functionName: 'balanceOf', args: [owner], blockNumber }),
    deployment ? publicClient.readContract({ address: deployment.token, abi: tokenAbi, functionName: 'balanceOf', args: [owner], blockNumber }) : Promise.resolve(null),
  ]);
  return { imd, spectra };
}

export function usePortfolio(deployment: Deployment | null, account: Address | null) {
  const key = account ? `${deployment?.factory ?? 'undeployed'}:${account}` : '';
  const [state, setState] = useState<ReadState<Portfolio>>({ key: '', data: null, status: 'loading', error: null });
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion(value => value + 1), []);
  useEffect(() => {
    if (!account) return;
    let active = true;
    let sequence = 0;
    const load = async () => {
      const current = ++sequence;
      try {
        const data = await readPortfolio(deployment, account);
        if (active && sequence === current) setState({ key, data, status: 'ready', error: null });
      } catch (error) {
        if (active && sequence === current) setState({ key, data: null, status: 'error', error: simpleError(error) });
      }
    };
    void load();
    const interval = window.setInterval(() => void load(), 30_000);
    return () => { active = false; window.clearInterval(interval); };
  }, [deployment, account, key, version]);
  if (!key) return { data: null, status: 'idle' as const, error: null, refresh };
  if (state.key !== key) return { data: null, status: 'loading' as const, error: null, refresh };
  return { data: state.data, status: state.status, error: state.error, refresh };
}
