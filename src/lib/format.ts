import { getAddress, isAddress, parseUnits, type Address, type Hash } from 'viem';

export function addressValue(value: unknown, label = 'Address'): Address {
  if (typeof value !== 'string' || !isAddress(value, { strict: false }) || /^0x0{40}$/i.test(value)) {
    throw new Error(`${label} is not a valid Ethereum address.`);
  }
  return getAddress(value);
}

export function hashValue(value: unknown): Hash {
  if (typeof value !== 'string' || !/^0x[0-9a-f]{64}$/i.test(value)) throw new Error('Invalid transaction hash.');
  return value as Hash;
}

export function unsignedInteger(value: unknown, label = 'Amount'): bigint {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} is invalid.`);
    return BigInt(value);
  }
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value) || value.length > 78) {
    throw new Error(`${label} is invalid.`);
  }
  const parsed = BigInt(value);
  if (parsed > 2n ** 256n - 1n) throw new Error(`${label} is too large.`);
  return parsed;
}

export function parseTokenAmount(value: string, decimals = 18): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) throw new Error('Unsupported token precision.');
  const clean = value.trim();
  if (!/^(0|[1-9]\d*)(\.\d+)?$/.test(clean) || clean.length > 120) {
    throw new Error('Enter a positive amount using a decimal point.');
  }
  if ((clean.split('.')[1]?.length ?? 0) > decimals) throw new Error(`Use no more than ${decimals} decimal places.`);
  const amount = parseUnits(clean, decimals);
  if (amount <= 0n || amount > 2n ** 256n - 1n) throw new Error('Enter an amount greater than zero within the token limit.');
  return amount;
}

export function formatAmount(value: bigint, decimals = 18, maxFraction = 4): string {
  if (value < 0n) return `-${formatAmount(-value, decimals, maxFraction)}`;
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36 || !Number.isInteger(maxFraction) || maxFraction < 0 || maxFraction > decimals) {
    throw new Error('Invalid display precision.');
  }
  const scale = 10n ** BigInt(decimals);
  const whole = (value / scale).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  if (maxFraction === 0) return whole;
  const fraction = (value % scale).toString().padStart(decimals, '0').slice(0, maxFraction).replace(/0+$/, '');
  if (value > 0n && value < 10n ** BigInt(decimals - maxFraction)) return `<0.${'0'.repeat(maxFraction - 1)}1`;
  return fraction ? `${whole}.${fraction}` : whole;
}

export const shortAddress = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;
export const explorerAddress = (address: string) => `https://etherscan.io/address/${addressValue(address)}`;
export const explorerTx = (hash: string) => `https://etherscan.io/tx/${hashValue(hash)}`;

export function simpleError(error: unknown): string {
  const details = error instanceof Error ? error.message : String(error);
  if (/user rejected|user denied|4001/i.test(details)) return 'The wallet request was cancelled. No transaction was sent.';
  if (/insufficient funds/i.test(details)) return 'Your wallet needs enough ETH to pay the Ethereum network fee.';
  if (/ProgramFinished/i.test(details)) return 'This staking program has ended. Withdrawals and reward claims remain available.';
  if (/InsufficientStake/i.test(details)) return 'The withdrawal amount exceeds your current stake.';
  if (/NothingToClaim/i.test(details)) return 'There are no earned rewards to claim.';
  if (/NothingToExit/i.test(details)) return 'There are no deposits or earned rewards to withdraw.';
  if (/InsufficientFunding/i.test(details)) return 'The staking reward reserve could not be verified. No deposit was sent.';
  if (/UnsupportedTransferBehavior/i.test(details)) return 'This token transfer is incompatible with the staking pool. No deposit was sent.';
  if (/timeout|fetch|http|network request|rpc/i.test(details)) return 'The live service could not be reached. Please try again.';
  if (/ChainMismatch|wallet.*(?:chain|network)|(?:chain|network).*wallet/i.test(details)) return 'Check that your wallet is connected to Ethereum mainnet, then try again.';
  if (error instanceof Error && error.name === 'Error' && details.length < 240) return details;
  return 'The request could not be completed. Check your wallet and try again.';
}
