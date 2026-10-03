import { useEffect, useSyncExternalStore } from 'react';
import type { Address, EIP1193Provider } from 'viem';
import { addressValue, simpleError } from './format';

export type WalletOption = { id: string; name: string; icon: string };
type WalletEntry = WalletOption & { provider: EIP1193Provider };
type WalletState = {
  wallets: WalletOption[]; selectedWalletId: string | null; provider: EIP1193Provider | null;
  address: Address | null; chainId: number | null; status: 'disconnected' | 'connecting' | 'connected'; error: string | null;
};
const initialState: WalletState = { wallets: [], selectedWalletId: null, provider: null, address: null, chainId: null, status: 'disconnected', error: null };
let state: WalletState = initialState;
const entries = new Map<string, WalletEntry>();
const listeners = new Set<() => void>();
let discoveryStarted = false;
let epoch = 0;
let unsubscribeProvider: (() => void) | null = null;

function update(patch: Partial<WalletState>) {
  state = { ...state, ...patch };
  listeners.forEach(listener => listener());
}
function providerValue(value: unknown): EIP1193Provider | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<EIP1193Provider>;
  return typeof candidate.request === 'function' && typeof candidate.on === 'function' && typeof candidate.removeListener === 'function' ? candidate as EIP1193Provider : null;
}

export function parseChainId(value: unknown): number {
  if (typeof value !== 'string' || !/^0x[0-9a-f]+$/i.test(value) || value.length > 16) throw new Error('The wallet returned an invalid network.');
  const chainId = Number(BigInt(value));
  if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new Error('The wallet returned an invalid network.');
  return chainId;
}

function addWallet(entry: WalletEntry) {
  // EIP-6963 UUIDs keep two wallets distinct. A legacy injected provider is removed once announced.
  if (entry.id !== 'injected' && entries.get('injected')?.provider === entry.provider) {
    entries.delete('injected');
    if (state.selectedWalletId === 'injected') update({ selectedWalletId: entry.id });
  }
  const existing = entries.get(entry.id);
  if (existing && existing.provider !== entry.provider) return;
  entries.set(entry.id, entry);
  update({ wallets: [...entries.values()].map(({ id, name, icon }) => ({ id, name, icon })) });
  if (!state.selectedWalletId && entries.size === 1) selectWallet(entry.id);
}

export function discoverWallets() {
  if (discoveryStarted || typeof window === 'undefined') return;
  discoveryStarted = true;
  window.addEventListener('eip6963:announceProvider', ((event: CustomEvent<unknown>) => {
    const detail = event.detail;
    if (!detail || typeof detail !== 'object') return;
    const announced = detail as { info?: { uuid?: unknown; name?: unknown; icon?: unknown }; provider?: unknown };
    const info = announced.info;
    const provider = providerValue(announced.provider);
    if (!info || !provider || typeof info.uuid !== 'string' || !/^[0-9a-f-]{36}$/i.test(info.uuid) || typeof info.name !== 'string' || info.name.length === 0 || info.name.length > 100) return;
    const icon = typeof info.icon === 'string' && /^data:image\/(png|jpeg|webp|svg\+xml);/i.test(info.icon) && info.icon.length < 200_000 ? info.icon : '';
    addWallet({ id: info.uuid, name: info.name, icon, provider });
  }) as EventListener);
  window.dispatchEvent(new Event('eip6963:requestProvider'));
  const injected = providerValue((window as unknown as { ethereum?: unknown }).ethereum);
  if (injected && ![...entries.values()].some(entry => entry.provider === injected)) {
    addWallet({ id: 'injected', name: 'Browser wallet', icon: '', provider: injected });
  }
}

function selectWallet(id: string): void {
  const entry = entries.get(id);
  if (!entry) { update({ error: 'Choose an available browser wallet.' }); return; }
  epoch++;
  unsubscribeProvider?.();
  unsubscribeProvider = null;
  update({ selectedWalletId: id, provider: entry.provider, address: null, chainId: null, status: 'disconnected', error: null });
}

function observeProvider(provider: EIP1193Provider) {
  unsubscribeProvider?.();
  const onAccounts = (accounts: Address[]) => {
    if (provider !== state.provider) return;
    epoch++;
    try {
      const address = accounts.length ? addressValue(accounts[0]) : null;
      update({ address, status: address ? 'connected' : 'disconnected', error: null });
    } catch { update({ address: null, status: 'disconnected', error: 'The wallet returned an invalid account.' }); }
  };
  const onChain = (chainId: string) => {
    if (provider !== state.provider) return;
    epoch++;
    try { update({ chainId: parseChainId(chainId), error: null }); }
    catch { update({ chainId: null, error: 'The wallet returned an invalid network.' }); }
  };
  const onDisconnect = () => {
    if (provider !== state.provider) return;
    epoch++;
    update({ address: null, chainId: null, status: 'disconnected', error: null });
  };
  provider.on('accountsChanged', onAccounts);
  provider.on('chainChanged', onChain);
  provider.on('disconnect', onDisconnect);
  unsubscribeProvider = () => {
    provider.removeListener('accountsChanged', onAccounts);
    provider.removeListener('chainChanged', onChain);
    provider.removeListener('disconnect', onDisconnect);
  };
}

async function connect(): Promise<void> {
  const provider = state.provider;
  if (!provider) { update({ error: 'Install a compatible Ethereum browser wallet, then reload this page.' }); return; }
  const id = ++epoch;
  update({ status: 'connecting', error: null, address: null, chainId: null });
  try {
    await provider.request({ method: 'eth_requestAccounts' });
    const [accounts, network] = await Promise.all([
      provider.request({ method: 'eth_accounts' }), provider.request({ method: 'eth_chainId' }),
    ]);
    if (id !== epoch || provider !== state.provider) return;
    if (!Array.isArray(accounts) || accounts.length === 0) throw new Error('No account was shared by the wallet.');
    const address = addressValue(accounts[0]);
    observeProvider(provider);
    update({ address, chainId: parseChainId(network), status: 'connected', error: null });
  } catch (error) {
    if (id === epoch && provider === state.provider) update({ address: null, chainId: null, status: 'disconnected', error: simpleError(error) });
  }
}

function disconnect(): void {
  epoch++;
  unsubscribeProvider?.();
  unsubscribeProvider = null;
  update({ address: null, chainId: null, status: 'disconnected', error: null });
}

async function switchToEthereum(): Promise<void> {
  const provider = state.provider;
  if (!provider || !state.address) { update({ error: 'Connect your selected wallet first.' }); return; }
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x1' }] });
    const network = await provider.request({ method: 'eth_chainId' });
    if (provider === state.provider) update({ chainId: parseChainId(network), error: null });
  } catch (error) { if (provider === state.provider) update({ error: simpleError(error) }); }
}

export const getSelectedProvider = (): EIP1193Provider | null => state.provider;
export const walletActions = { selectWallet, connect, disconnect, switchToEthereum };

export async function assertWalletContext(provider: EIP1193Provider, account: Address): Promise<void> {
  if (provider !== state.provider || state.status !== 'connected' || state.address?.toLowerCase() !== account.toLowerCase()) {
    throw new Error('Your selected wallet account changed. Review the action and try again.');
  }
  const [chainId, accounts] = await Promise.all([
    provider.request({ method: 'eth_chainId' }), provider.request({ method: 'eth_accounts' }),
  ]);
  if (parseChainId(chainId) !== 1) throw new Error('Switch your wallet to Ethereum mainnet before sending this transaction.');
  if (!Array.isArray(accounts) || accounts.length === 0 || addressValue(accounts[0]).toLowerCase() !== account.toLowerCase() || provider !== state.provider || state.address?.toLowerCase() !== account.toLowerCase()) {
    throw new Error('Your wallet account changed. Review the action and try again.');
  }
}

export function useWallet() {
  const snapshot = useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener); }, () => state, () => initialState);
  useEffect(() => { discoverWallets(); }, []);
  return { ...snapshot, selectWallet, connect, disconnect, switchToEthereum };
}
