import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import type { EIP1193Provider } from 'viem';
import { addressValue, assertWalletContext, discoverWallets, getSelectedProvider, walletActions } from '../src/lib';

afterEach(() => { walletActions.disconnect(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('never auto-connects or signs during discovery and rejects stale accounts, networks and wallet selection', async () => {
  const surface = new EventTarget();
  vi.stubGlobal('window', surface);
  const events = new EventEmitter();
  const owner = addressValue(`0x${'1'.repeat(40)}`);
  const changedOwner = addressValue(`0x${'2'.repeat(40)}`);
  let accounts = [owner];
  let network = '0x1';
  const request = vi.fn(async ({ method }: { method: string }) => {
    if (method === 'eth_chainId') return network;
    if (method === 'eth_accounts' || method === 'eth_requestAccounts') return accounts;
    if (method === 'wallet_switchEthereumChain') {
      network = '0x1'; events.emit('chainChanged', network); return null;
    }
    throw new Error(`Unexpected signing method ${method}`);
  });
  const provider = { request, on: events.on.bind(events), removeListener: events.removeListener.bind(events) } as unknown as EIP1193Provider;
  discoverWallets();
  surface.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: {
    info: { uuid: '11111111-1111-4111-8111-111111111111', name: 'Wallet A', icon: '' }, provider,
  } }));
  expect(getSelectedProvider()).toBe(provider);
  expect(request).not.toHaveBeenCalled();
  await expect(assertWalletContext(provider, owner)).rejects.toThrow(/changed/);
  await walletActions.connect();
  await expect(assertWalletContext(provider, owner)).resolves.toBeUndefined();
  // Even if a wallet misses its event, re-reading eth_accounts catches the changed selected account.
  accounts = [changedOwner];
  await expect(assertWalletContext(provider, owner)).rejects.toThrow(/changed/);
  events.emit('accountsChanged', accounts);
  await expect(assertWalletContext(provider, changedOwner)).resolves.toBeUndefined();
  network = '0xaa36a7';
  events.emit('chainChanged', network);
  await expect(assertWalletContext(provider, changedOwner)).rejects.toThrow(/mainnet/);
  expect(request.mock.calls.filter(([argument]) => argument.method === 'wallet_switchEthereumChain')).toHaveLength(0);
  await walletActions.switchToEthereum();
  expect(request.mock.calls.filter(([argument]) => argument.method === 'wallet_switchEthereumChain')).toHaveLength(1);
  await expect(assertWalletContext(provider, changedOwner)).resolves.toBeUndefined();
  const secondEvents = new EventEmitter();
  const secondProvider = { request, on: secondEvents.on.bind(secondEvents), removeListener: secondEvents.removeListener.bind(secondEvents) } as unknown as EIP1193Provider;
  surface.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: {
    info: { uuid: '22222222-2222-4222-8222-222222222222', name: 'Wallet B', icon: '' }, provider: secondProvider,
  } }));
  walletActions.selectWallet('22222222-2222-4222-8222-222222222222');
  await expect(assertWalletContext(provider, changedOwner)).rejects.toThrow(/changed/);
  expect(events.listenerCount('accountsChanged')).toBe(0);
  expect(request.mock.calls.every(([argument]) => !argument.method.includes('sendTransaction') && !argument.method.includes('sign'))).toBe(true);
});
