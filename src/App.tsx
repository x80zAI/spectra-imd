import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowClockwise, ArrowDown, ArrowRight, ArrowUpRight, Check, CheckCircle, CircleNotch, Copy, Cube, DownloadSimple, Fingerprint, Globe, MagnifyingGlass, Plus, ShieldCheck, Star, Wallet, X } from '@phosphor-icons/react';
import { formatUnits, isAddress, parseUnits, type Address } from 'viem';
import {
  IMD_ADDRESS, executePoolAction, explorerAddress, explorerTx, formatAmount, shortAddress,
  useDeployment, usePoolPosition, usePortfolio, useRadar, useWallet,
  type RadarCoin,
} from './lib';

type View = 'home' | 'stake' | 'radar' | 'portfolio' | 'about';
type WalletState = ReturnType<typeof useWallet>;
type DeploymentState = ReturnType<typeof useDeployment>;
type RadarState = ReturnType<typeof useRadar>;
const views: View[] = ['home', 'stake', 'radar', 'portfolio', 'about'];
const repository = 'https://github.com/x80zAI/spectra-imd';

function External({ href, children, className = '' }: { href: string; children: ReactNode; className?: string }) {
  return <a className={className} href={href} target="_blank" rel="noopener noreferrer">{children}<ArrowUpRight size={14} aria-hidden="true" /></a>;
}

function Status({ active = false, children }: { active?: boolean; children: ReactNode }) {
  return <span className={`status ${active ? 'status-live' : ''}`}><span aria-hidden="true" />{children}</span>;
}

function CopyAddress({ address }: { address: Address }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(address); setCopied(true); setFailed(false); }
    catch { setFailed(true); }
  }
  return <span className="copy-address"><External href={explorerAddress(address)}>{shortAddress(address)}</External><button type="button" className="icon-button" onClick={copy} aria-label={`Copy ${address}`}>{copied ? <Check size={15} /> : <Copy size={15} />}</button>{failed && <span className="field-note">Copy unavailable</span>}</span>;
}

function WalletDialog({ wallet, open, close }: { wallet: WalletState; open: boolean; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = dialog.current;
    if (open && !el?.open) el?.showModal();
    if (!open && el?.open) el.close();
  }, [open]);
  async function connect() { await wallet.connect(); }
  useEffect(() => { if (open && wallet.status === 'connected') close(); }, [wallet.status, open, close]);
  return <dialog ref={dialog} className="wallet-dialog" aria-labelledby="wallet-dialog-title" onCancel={close} onClick={event => { if (event.target === dialog.current) close(); }}>
    <div className="dialog-top"><span className="eyebrow">YOUR CONNECTION</span><button className="icon-button" onClick={close} aria-label="Close wallet dialog"><X size={20} /></button></div>
    <div className="dialog-symbol"><Wallet size={32} /></div>
    <h2 id="wallet-dialog-title">Bring your wallet.</h2>
    <p>Connect an Ethereum wallet to read your balances and manage your staking position.</p>
    {wallet.wallets.length > 0 ? <>
      <fieldset className="wallet-choices"><legend className="sr-only">Choose a wallet</legend>{wallet.wallets.map(item => <label className={`wallet-choice ${wallet.selectedWalletId === item.id ? 'selected' : ''}`} key={item.id}>
        <input type="radio" name="wallet" value={item.id} checked={wallet.selectedWalletId === item.id} onChange={() => wallet.selectWallet(item.id)} />
        <Wallet size={22} aria-hidden="true" /><span>{item.name}</span><CheckCircle size={20} className="choice-check" />
      </label>)}</fieldset>
      <button className="button button-primary full" disabled={wallet.status === 'connecting' || !wallet.selectedWalletId} onClick={connect}>{wallet.status === 'connecting' ? <><CircleNotch className="spin" /> Connecting…</> : <>Connect wallet <ArrowRight /></>}</button>
    </> : <div className="empty-wallet"><p>No Ethereum wallet was detected in this browser.</p><p>Install a wallet extension, then refresh this page.</p><div className="inline-links"><External href="https://metamask.io/">MetaMask</External><External href="https://rabby.io/">Rabby</External></div></div>}
    {wallet.error && <p className="error-message" role="alert">{wallet.error}</p>}
    <p className="dialog-foot"><ShieldCheck size={16} /> Connecting does not send a transaction. Never share your recovery phrase.</p>
  </dialog>;
}

function PageHeading({ label, title, description, children }: { label: string; title: ReactNode; description: string; children?: ReactNode }) {
  return <div className="page-heading"><div><div className="eyebrow"><span className="tiny-line" />{label}</div><h1>{title}</h1><p>{description}</p></div>{children}</div>;
}

function Home({ go, activated }: { go: (view: View) => void; activated: boolean }) {
  const [artLoaded, setArtLoaded] = useState(true);
  return <>
    <section className="hero">
      <div className="hero-grain" aria-hidden="true" />
      <div className="hero-text"><div className="eyebrow"><span className="tiny-line" />PEOPLE. IDENTITY. ETHEREUM.</div>
        <h1>A human signal.<br /><span>An Ethereum<br />future.</span></h1>
        <p>A new perspective on the IMD ecosystem.<br className="desktop-break" /> Connect with real on-chain activity, explore community coins, and make your next move.</p>
        <div className="hero-actions"><button className="button button-primary" onClick={() => go('radar')}>Explore IMD Radar <ArrowUpRight size={18} /></button><button className="button button-outline" onClick={() => go('stake')}>Discover staking <ArrowRight size={18} /></button></div>
        <div className="hero-proof"><Globe size={15} /><span>Built on Ethereum</span><span className="proof-divider" /><span>Independent by design</span></div>
      </div>
      <div className="hero-art" aria-hidden="true">
        <div className="art-halo" />
        {artLoaded ? <img src="/hero.png" alt="" onError={() => setArtLoaded(false)} fetchPriority="high" /> : <div className="ethereum-art"><span /><span /><span /><span /></div>}
        <div className="art-coordinate coordinate-top">HUMAN × ON-CHAIN</div>
        <div className="art-coordinate coordinate-bottom"><span className="crosshair">+</span> A DIFFERENT KIND OF CONNECTION</div>
        <div className="orbit-card"><div className="orbit-symbol"><Fingerprint size={29} /></div><div><span>SPECTRA IMD</span><p>Identity, in a new light.</p></div><span className="orbit-spark" /></div>
      </div>
      <div className="hero-bottom"><span><span className="small-dot" /> THE SPECTRA ECOSYSTEM</span><button onClick={() => document.getElementById('discover')?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })}>Find your signal <ArrowDown size={15} /></button></div>
    </section>
    <section className="discover section-wrap" id="discover">
      <div className="section-intro"><div className="eyebrow">MORE THAN A TOKEN</div><h2>Your identity.<br /><span>Your next connection.</span></h2><p>Useful tools for people moving through the IMD ecosystem. Open information. Your wallet. Your decisions.</p></div>
      <div className="utility-grid">
        <button className="utility-card radar-card" onClick={() => go('radar')}><span className="card-number">01 / DISCOVER</span><div className="utility-icon"><Globe size={30} /></div><h3>IMD Radar</h3><p>Find community coins. Follow real activity. Build a personal watchlist from live indexed data.</p><span className="utility-link">Read the ecosystem <ArrowUpRight size={20} /></span><div className="card-orbit" aria-hidden="true" /></button>
        <button className="utility-card staking-card" onClick={() => go('stake')}><span className="card-number">02 / PARTICIPATE</span><div className="utility-icon"><Cube size={30} /></div><h3>Two ways to stake.</h3><p>Stake SPECTRA or IMD in separate pools. Both distribute SPECTRA from a fixed reward reserve.</p><span className="utility-link">Explore the pools <ArrowUpRight size={20} /></span><Status active={activated}>{activated ? 'Contracts activated' : 'Awaiting on-chain activation'}</Status></button>
        <button className="utility-card portfolio-card" onClick={() => go('portfolio')}><span className="card-number">03 / CONNECT</span><div className="utility-icon"><Wallet size={30} /></div><h3>A clearer view.</h3><p>Read your IMD and SPECTRA balances directly from Ethereum. No connection needed to check a public address.</p><span className="utility-link">Open your portfolio <ArrowUpRight size={20} /></span></button>
      </div>
    </section>
    <section className="manifesto section-wrap"><div className="manifesto-mark" aria-hidden="true"><img src="/logo.svg" alt="" /></div><div><div className="eyebrow">THE HUMAN LAYER</div><h2>Ideas become signals.<br />Signals become <span>connections.</span></h2><p>SPECTRA IMD brings a human perspective to an open ecosystem. An independent project with its own token, transparent allocation, and tools that read what is happening on Ethereum.</p><button className="text-button" onClick={() => go('about')}>Meet SPECTRA IMD <ArrowRight size={18} /></button></div></section>
  </>;
}

function Stake({ wallet, deploymentState, connect }: { wallet: WalletState; deploymentState: DeploymentState; connect: () => void }) {
  const [kind, setKind] = useState<'spectra' | 'imd'>('spectra');
  const active = deploymentState.status === 'ready';
  return <section className="app-page section-wrap">
    <PageHeading label="PARTICIPATE / STAKING" title={<>Two assets.<br /><span>One new spectrum.</span></>} description="Choose a pool. Stake SPECTRA or original IMD. Both distribute SPECTRA from their own funded reserve."><Status active={active}>{active ? 'Contracts activated' : deploymentState.status === 'loading' ? 'Checking Ethereum…' : 'Awaiting on-chain activation'}</Status></PageHeading>
    <div className="stake-layout"><div className="stake-context"><div className="pool-selector" role="tablist" aria-label="Staking pools"><button role="tab" aria-selected={kind === 'spectra'} className={kind === 'spectra' ? 'selected' : ''} onClick={() => setKind('spectra')}><img src="/logo.svg" alt="" /><span>Stake SPECTRA<small>Receive SPECTRA</small></span><ArrowUpRight /></button><button role="tab" aria-selected={kind === 'imd'} className={kind === 'imd' ? 'selected' : ''} onClick={() => setKind('imd')}><span className="imd-token">I</span><span>Stake IMD<small>Receive SPECTRA</small></span><ArrowUpRight /></button></div>
      <div className="stake-principles"><div><ShieldCheck size={20} /><p><strong>Your principal stays yours.</strong><span>Withdraw at any time. No project withdrawal fee. Ethereum gas fees still apply.</span></p></div><div><Cube size={20} /><p><strong>A fixed reward reserve.</strong><span>1,000,000 SPECTRA per pool, distributed over 180 days from that pool’s first stake.</span></p></div><div><Fingerprint size={20} /><p><strong>No promised return.</strong><span>Your share depends on your stake, pool participation, and the remaining reward period.</span></p></div></div>
      <External className="source-link" href={repository + '/tree/main/contracts'}>Inspect the contract source</External>
    </div><PoolPanel key={kind} kind={kind} wallet={wallet} deploymentState={deploymentState} connect={connect} /></div>
    {deploymentState.error && <div className="error-message" role="alert">{deploymentState.error}<button className="text-button" onClick={deploymentState.refresh}>Check again <ArrowClockwise size={14} /></button></div>}
    <div className="staking-note"><span className="eyebrow">HOW REWARDS WORK</span><p>Each pool starts its own 180-day schedule on its first accepted deposit. Rewards are shared in proportion to the amount staked. Unallocated rewards during an empty pool period are not assigned to a later depositor. The total token supply is fixed at 10,000,000 SPECTRA.</p></div>
  </section>;
}

function PoolPanel({ kind, wallet, deploymentState, connect }: { kind: 'spectra' | 'imd'; wallet: WalletState; deploymentState: DeploymentState; connect: () => void }) {
  const deployment = deploymentState.deployment;
  const position = usePoolPosition(deployment, kind, wallet.address);
  const [operation, setOperation] = useState<'stake' | 'withdraw'>('stake');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const token = kind === 'spectra' ? 'SPECTRA' : 'IMD';
  const ready = deploymentState.status === 'ready' && deployment;
  let units = 0n;
  try { if (/^\d*(\.\d{0,18})?$/.test(amount) && amount !== '' && amount !== '.') units = parseUnits(amount, 18); } catch { /* Invalid amounts are never submitted. */ }
  const available = operation === 'stake' ? position.data?.walletBalance ?? 0n : position.data?.staked ?? 0n;
  const amountValid = units > 0n && units <= available;
  const approvalNeeded = operation === 'stake' && units > (position.data?.allowance ?? 0n);
  const resetNeeded = approvalNeeded && (position.data?.allowance ?? 0n) > 0n;
  async function transact(action: 'approve' | 'reset-approval' | 'stake' | 'withdraw' | 'claim' | 'exit') {
    if (!deployment || !wallet.address || !wallet.provider) return;
    setError(null); setReceipt(null); setBusy(action);
    try { const hash = await executePoolAction({ deployment, kind, provider: wallet.provider, account: wallet.address, action, amount }); setReceipt(hash); if (action === 'stake' || action === 'withdraw' || action === 'exit') setAmount(''); position.refresh(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'The transaction could not be completed.'); }
    finally { setBusy(null); }
  }
  const primaryAction = operation === 'withdraw' ? 'withdraw' : resetNeeded ? 'reset-approval' : approvalNeeded ? 'approve' : 'stake';
  const primaryLabel = operation === 'withdraw' ? `Withdraw ${token}` : resetNeeded ? 'Reset existing allowance' : approvalNeeded ? `Approve ${token}` : `Stake ${token}`;
  return <div className="pool-panel" role="tabpanel" aria-label={`${token} staking pool`}>
    <div className="panel-top"><span className="eyebrow">{token} POOL</span><span className="chain-label"><span className="eth-mini" /> ETHEREUM</span></div>
    <h2>Make your signal<br /><span>part of the spectrum.</span></h2>
    {!ready ? <>
      <div className="activation-notice"><span className="notice-icon"><Cube size={25} /></span><h3>Awaiting on-chain activation</h3><p>The token and both pools need to be deployed and funded on Ethereum before staking opens.</p><p>No deposits are accepted until the published contracts pass the website’s checks.</p></div>
      <div className="pool-spec"><div><span>Approved reward allocation</span><strong>1,000,000 <small>SPECTRA</small></strong></div><div><span>Distribution period</span><strong>180 <small>days</small></strong></div></div>
      <div className="panel-foot">Approved allocation · Not a live pool balance</div>
    </> : <>
      <div className="position-grid"><div><span>Your staked {token}</span><strong>{position.data ? formatAmount(position.data.staked) : '—'}</strong></div><div><span>Claimable SPECTRA</span><strong className="mint-text">{position.data ? formatAmount(position.data.earned) : '—'}</strong></div></div>
      <div className="segment-control" role="tablist" aria-label="Pool action"><button role="tab" aria-selected={operation === 'stake'} className={operation === 'stake' ? 'selected' : ''} onClick={() => { setOperation('stake'); setAmount(''); setError(null); }}>Stake</button><button role="tab" aria-selected={operation === 'withdraw'} className={operation === 'withdraw' ? 'selected' : ''} onClick={() => { setOperation('withdraw'); setAmount(''); setError(null); }}>Withdraw</button></div>
      <label className="amount-label" htmlFor="pool-amount">Amount to {operation}</label><div className="amount-input"><input id="pool-amount" type="text" inputMode="decimal" autoComplete="off" placeholder="0.00" value={amount} onChange={event => setAmount(event.target.value)} disabled={!!busy} /><span>{token}</span><button disabled={!position.data || !!busy} onClick={() => setAmount(formatUnits(available, 18))}>MAX</button></div>
      <div className="balance-line"><span>Available: {position.data ? formatAmount(available, 18, 6) : '—'} {token}</span>{wallet.address && <button className="icon-button" onClick={position.refresh} aria-label="Refresh pool position" disabled={!!busy || position.status === 'loading'}><ArrowClockwise className={position.status === 'loading' ? 'spin' : ''} size={14} /></button>}</div>
      {!wallet.address ? <button className="button button-primary full" onClick={connect}>Connect wallet <Wallet size={18} /></button> : wallet.chainId !== 1 ? <button className="button button-primary full" onClick={wallet.switchToEthereum}>Switch to Ethereum <ArrowRight size={18} /></button> : <button className="button button-primary full" disabled={!amountValid || !!busy || position.status !== 'ready'} onClick={() => transact(primaryAction)}>{busy ? <><CircleNotch className="spin" /> Confirming transaction…</> : <>{primaryLabel} <ArrowUpRight size={18} /></>}</button>}
      {amount && !amountValid && <p className="field-note">Enter a positive amount within your available balance, with up to 18 decimal places.</p>}
      {wallet.address && operation === 'stake' && approvalNeeded && <p className="field-note">{resetNeeded ? 'Reset your existing allowance to zero first. Then approve your chosen amount.' : 'Approve only your chosen amount. After confirmation, submit a separate staking transaction.'}</p>}
      <div className="pool-secondary-actions"><button className="button button-outline" disabled={!!busy || wallet.chainId !== 1 || !position.data || position.data.earned === 0n} onClick={() => transact('claim')}>Claim rewards</button><button className="button button-outline" disabled={!!busy || wallet.chainId !== 1 || !position.data || (position.data.staked === 0n && position.data.earned === 0n)} onClick={() => transact('exit')}>Withdraw & claim</button></div>
      {receipt && <div className="success-message" role="status"><CheckCircle size={18} /><External href={explorerTx(receipt as `0x${string}`)}>Transaction confirmed</External></div>}
      {(error || position.error || wallet.error) && <p className="error-message" role="alert">{error || position.error || wallet.error}</p>}
      <div className="pool-details"><div><span>Total staked</span><strong>{position.data ? formatAmount(position.data.totalStaked) : '—'} {token}</strong></div><div><span>Reward budget</span><strong>{position.data ? formatAmount(position.data.rewardBudget) : '—'} SPECTRA</strong></div><div><span>Schedule</span><strong>{position.data?.endTime ? `Ends ${new Date(Number(position.data.endTime) * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}` : 'Starts on first deposit'}</strong></div><div><span>Pool contract</span><CopyAddress address={kind === 'spectra' ? deployment.spectraPool : deployment.imdPool} /></div></div>
      <div className="panel-foot">No project fee · Ethereum gas applies · Wallet approval required</div>
    </>}
  </div>;
}

function readWatchlist(): string[] {
  try { const value: unknown = JSON.parse(localStorage.getItem('spectra-watchlist') || '[]'); return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && isAddress(item)).map(item => item.toLowerCase()) : []; } catch { return []; }
}

function Radar({ radar }: { radar: RadarState }) {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('recent');
  const [mode, setMode] = useState<'all' | 'watchlist'>('all');
  const [watchlist, setWatchlist] = useState<string[]>(readWatchlist);
  const [storageNotice, setStorageNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<RadarCoin | null>(null);
  const coins = radar.data?.coins ?? [];
  const query = search.trim().toLowerCase();
  const filtered = coins.filter(coin => (mode === 'all' || watchlist.includes(coin.address.toLowerCase())) && `${coin.name} ${coin.symbol} ${coin.address}`.toLowerCase().includes(query)).sort((a, b) => {
    if (sort === 'name') return a.name.localeCompare(b.name);
    if (sort === 'reserve') return a.realImd === b.realImd ? 0 : a.realImd > b.realImd ? -1 : 1;
    if (sort === 'price') return (a.priceImd ?? 0n) === (b.priceImd ?? 0n) ? 0 : (a.priceImd ?? 0n) > (b.priceImd ?? 0n) ? -1 : 1;
    return (b.createdAt ?? 0) - (a.createdAt ?? 0);
  });
  function toggle(coin: RadarCoin) {
    const address = coin.address.toLowerCase(); const next = watchlist.includes(address) ? watchlist.filter(item => item !== address) : [...watchlist, address]; setWatchlist(next);
    try { localStorage.setItem('spectra-watchlist', JSON.stringify(next)); setStorageNotice(null); } catch { setStorageNotice('Browser storage is unavailable. Your watchlist will last only for this visit.'); }
  }
  function exportWatchlist() {
    const saved = coins.filter(coin => watchlist.includes(coin.address.toLowerCase()));
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), network: 'Ethereum', addresses: watchlist, indexedCoins: saved.map(coin => ({ name: coin.name, symbol: coin.symbol, address: coin.address })) }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = 'spectra-imd-watchlist.json'; link.click(); URL.revokeObjectURL(url);
  }
  const lastUpdated = radar.data ? new Date(radar.data.fetchedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) : null;
  return <section className="app-page section-wrap">
    <PageHeading label="DISCOVER / IMD RADAR" title={<>Follow the ecosystem.<br /><span>Find your signal.</span></>} description="Explore community coins and indexed trading activity from the IMD ecosystem. Every address and transaction is open to inspection."><Status active={radar.status === 'ready'}>{radar.status === 'loading' ? 'Fetching indexed data…' : radar.status === 'ready' ? 'Indexed data connected' : 'Data source unavailable'}</Status></PageHeading>
    <div className="radar-stats"><div><span>Indexed community coins</span><strong>{radar.data ? radar.data.stats.coins.toLocaleString('en-US') : '—'}</strong></div><div><span>Indexed trades</span><strong>{radar.data ? radar.data.stats.trades.toLocaleString('en-US') : '—'}</strong></div><div><span>Indexed trade volume</span><strong>{radar.data ? formatAmount(radar.data.stats.volumeEth, 18, 3) : '—'} <small>ETH</small></strong></div><div><span>Indexed IMD burned</span><strong>{radar.data ? formatAmount(radar.data.stats.imdBurned, 18, 2) : '—'} <small>IMD</small></strong></div></div>
    <div className="radar-toolbar"><div className="radar-tabs" role="tablist" aria-label="Coin collection"><button role="tab" aria-selected={mode === 'all'} className={mode === 'all' ? 'selected' : ''} onClick={() => setMode('all')}>Community coins <span>{coins.length || '—'}</span></button><button role="tab" aria-selected={mode === 'watchlist'} className={mode === 'watchlist' ? 'selected' : ''} onClick={() => setMode('watchlist')}>Watchlist <span>{watchlist.length}</span></button></div><div className="toolbar-actions"><button className="icon-button" onClick={exportWatchlist} disabled={watchlist.length === 0} aria-label="Export watchlist as JSON"><DownloadSimple size={20} /></button><button className="button button-small button-outline" disabled={radar.status === 'loading'} onClick={radar.refresh}><ArrowClockwise size={15} className={radar.status === 'loading' ? 'spin' : ''} />Refresh</button></div></div>
    <div className="search-toolbar"><label className="search-field"><MagnifyingGlass size={18} /><input aria-label="Search community coins" placeholder="Search a coin, symbol, or contract…" value={search} onChange={event => setSearch(event.target.value)} />{search && <button className="icon-button" onClick={() => setSearch('')} aria-label="Clear search"><X size={15} /></button>}</label><label className="sort-select"><span>Sort</span><select aria-label="Sort coins" value={sort} onChange={event => setSort(event.target.value)}><option value="recent">Recently created</option><option value="reserve">IMD backing</option><option value="price">IMD quote</option><option value="name">Name A–Z</option></select></label></div>
    {storageNotice && <p className="field-note" role="status">{storageNotice}</p>}
    {radar.error && <div className="error-message" role="alert">{radar.error} <button className="text-button" onClick={radar.refresh}>Try again <ArrowClockwise size={14} /></button></div>}
    <div className="coins-table"><div className="table-heading"><span>Community coin</span><span>Indicative IMD quote</span><span>Real IMD backing</span><span>Indexed trades</span><span className="sr-only">Actions</span></div>
      {filtered.map(coin => <div className="coin-row" key={coin.address}><button className="coin-name" onClick={() => setSelected(coin)}><span className="coin-monogram">{coin.symbol.slice(0, 2).toUpperCase()}</span><span><strong>{coin.name}</strong><small>{coin.symbol} <span>· {shortAddress(coin.address)}</span></small></span></button><div className="coin-value"><span className="mobile-label">Indicative quote</span><strong>{coin.priceImd === null ? 'Unavailable' : formatAmount(coin.priceImd, 18, 8)} <small>{coin.priceImd === null ? '' : 'IMD'}</small></strong></div><div className="coin-value"><span className="mobile-label">Real backing</span><strong>{formatAmount(coin.realImd, 18, 2)} <small>IMD</small></strong></div><div className="coin-value coin-trades"><span className="mobile-label">Trades</span><strong>{coin.tradeCount.toLocaleString('en-US')}</strong></div><div className="coin-actions"><button className={`icon-button favorite ${watchlist.includes(coin.address.toLowerCase()) ? 'saved' : ''}`} aria-label={`${watchlist.includes(coin.address.toLowerCase()) ? 'Remove' : 'Add'} ${coin.name} ${watchlist.includes(coin.address.toLowerCase()) ? 'from' : 'to'} watchlist`} aria-pressed={watchlist.includes(coin.address.toLowerCase())} onClick={() => toggle(coin)}><Star size={18} weight={watchlist.includes(coin.address.toLowerCase()) ? 'fill' : 'regular'} /></button><button className="icon-button" aria-label={`View ${coin.name} details`} onClick={() => setSelected(coin)}><ArrowUpRight size={18} /></button></div></div>)}
      {filtered.length === 0 && <div className="empty-state">{radar.status === 'loading' && !radar.data ? <><CircleNotch className="spin" size={30} /><h3>Reading the ecosystem.</h3><p>Fetching community coins from the live IMD index.</p></> : radar.status === 'error' && !radar.data ? <><Globe size={30} /><h3>The index is unavailable.</h3><p>Refresh to try the data source again.</p></> : mode === 'watchlist' && watchlist.length === 0 ? <><Star size={30} /><h3>Your watchlist starts with you.</h3><p>Use the star beside a coin to save it in this browser.</p><button className="text-button" onClick={() => setMode('all')}>Explore community coins <ArrowRight size={16} /></button></> : <><MagnifyingGlass size={30} /><h3>No coins match this view.</h3><p>Try another search or open all community coins.</p><button className="text-button" onClick={() => { setSearch(''); setMode('all'); }}>Clear filters <ArrowRight size={16} /></button></>}</div>}
    </div>
    <div className="data-foot"><p>{lastUpdated ? `Fetched at ${lastUpdated} UTC. ` : ''}{radar.data ? `Source indexed through Ethereum block ${radar.data.indexerBlock.toLocaleString('en-US')}. ` : ''}{radar.data && !radar.data.complete ? 'The coin list is a partial indexed snapshot. ' : ''}Quotes use the virtual reserve ratio and are indicative; they do not include trading fees, price impact, or gas. Backing and activity do not establish safety.</p><External href="https://communitycoins.imd.fun/">Community Coins</External></div>
    <div className="activity-section"><div className="activity-title"><h2>Signals on the chain.</h2><span className="eyebrow">LATEST INDEXED TRADES</span></div><p className="section-description">The latest 50 indexed trades available from the source. Indexing can lag Ethereum.</p>
      <div className="trade-list">{(radar.data?.trades ?? []).slice(0, 10).map(trade => { const coin = coins.find(item => item.address.toLowerCase() === trade.coinAddress.toLowerCase()); return <div className="trade-row" key={trade.id}><span className={`trade-direction ${trade.buy ? 'buy' : 'sell'}`}>{trade.buy ? <Plus size={17} /> : <ArrowUpRight size={17} />}</span><div><strong>{trade.buy ? 'Bought' : 'Sold'} {coin?.symbol ?? shortAddress(trade.coinAddress)}</strong><External href={explorerAddress(trade.trader)}>{shortAddress(trade.trader)}</External></div><div className="trade-amount"><strong>{formatAmount(trade.coinAmount, 18, 3)} <small>{coin?.symbol ?? 'tokens'}</small></strong><span>{formatAmount(trade.ethAmount, 18, 5)} ETH · {new Date(trade.timestamp * 1000).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })} UTC</span></div><External className="trade-link" href={explorerTx(trade.txHash)}><span className="sr-only">View transaction</span></External></div>; })}{!radar.data?.trades.length && <div className="empty-state compact"><p>{radar.status === 'loading' ? 'Fetching indexed transactions…' : 'No indexed transactions are available from the current response.'}</p></div>}</div>
    </div><CoinDialog coin={selected} close={() => setSelected(null)} />
  </section>;
}

function CoinDialog({ coin, close }: { coin: RadarCoin | null; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (coin && !dialog.current?.open) dialog.current?.showModal(); if (!coin && dialog.current?.open) dialog.current.close(); }, [coin]);
  return <dialog className="wallet-dialog coin-dialog" ref={dialog} aria-labelledby="coin-title" onCancel={close} onClick={event => { if (event.target === dialog.current) close(); }}><div className="dialog-top"><span className="eyebrow">COMMUNITY COIN / ETHEREUM</span><button className="icon-button" onClick={close} aria-label="Close coin details"><X size={20} /></button></div>{coin && <><div className="coin-detail-heading"><span className="coin-monogram">{coin.symbol.slice(0, 2).toUpperCase()}</span><div><h2 id="coin-title">{coin.name}</h2><p>{coin.symbol}</p></div></div><div className="coin-detail-grid"><div><span>Indicative quote</span><strong>{coin.priceImd === null ? 'Unavailable' : `${formatAmount(coin.priceImd, 18, 8)} IMD`}</strong></div><div><span>Real IMD backing</span><strong>{formatAmount(coin.realImd)} IMD</strong></div><div><span>Token supply</span><strong>{formatAmount(coin.supply, 18, 2)}</strong></div><div><span>Indexed trade count</span><strong>{coin.tradeCount.toLocaleString('en-US')}</strong></div><div><span>Coin contract</span><CopyAddress address={coin.address} /></div><div><span>Creator</span><CopyAddress address={coin.creator} /></div></div><p className="field-note">IMD quotes are indicative virtual reserve ratios, not executable prices. A coin appearing here is not a recommendation or verification of its safety.</p><External className="button button-primary full" href="https://communitycoins.imd.fun/">Open Community Coins</External></>}</dialog>;
}

function Portfolio({ wallet, deploymentState, connect }: { wallet: WalletState; deploymentState: DeploymentState; connect: () => void }) {
  const [input, setInput] = useState('');
  const [address, setAddress] = useState<Address | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const balances = usePortfolio(deploymentState.deployment, address);
  const spectraPosition = usePoolPosition(deploymentState.deployment, 'spectra', address);
  const imdPosition = usePoolPosition(deploymentState.deployment, 'imd', address);
  function submit(event: FormEvent) { event.preventDefault(); const value = input.trim(); if (!isAddress(value)) { setInputError('Enter a valid public Ethereum address beginning with 0x.'); return; } setInputError(null); setAddress(value); }
  function useConnected() { if (!wallet.address) { connect(); return; } setInput(wallet.address); setAddress(wallet.address); setInputError(null); }
  function refresh() { balances.refresh(); spectraPosition.refresh(); imdPosition.refresh(); }
  return <section className="app-page section-wrap portfolio-page"><PageHeading label="CONNECT / YOUR PORTFOLIO" title={<>Your identity.<br /><span>Your on-chain view.</span></>} description="Read public Ethereum balances and staking positions. Connect your wallet or enter any public address. No signature is required." />
    <form className="portfolio-search" onSubmit={submit}><label htmlFor="portfolio-address" className="eyebrow">PUBLIC ETHEREUM ADDRESS</label><div className="portfolio-input"><Wallet size={22} /><input id="portfolio-address" placeholder="0x…" value={input} onChange={event => setInput(event.target.value)} spellCheck={false} autoComplete="off" /><button type="submit" className="button button-primary">Read wallet <ArrowRight size={18} /></button></div><button type="button" className="text-button" onClick={useConnected}>{wallet.address ? 'Use connected wallet' : 'Connect my wallet'} <ArrowUpRight size={15} /></button>{inputError && <p className="error-message" role="alert">{inputError}</p>}</form>
    {!address ? <div className="portfolio-empty"><div className="portfolio-orbit" aria-hidden="true"><Wallet size={40} /><span /><span /></div><h2>See the signal<br /><span>behind your address.</span></h2><p>Your portfolio is read directly from Ethereum.<br />Your wallet remains in your control.</p></div> : <>
      <div className="portfolio-result-top"><div><Status active={balances.status === 'ready'}>{balances.status === 'loading' ? 'Reading Ethereum…' : balances.status === 'error' ? 'Read unavailable' : 'Ethereum balances'}</Status><CopyAddress address={address} /></div><button className="button button-outline button-small" disabled={balances.status === 'loading'} onClick={refresh}><ArrowClockwise size={16} className={balances.status === 'loading' ? 'spin' : ''} />Refresh</button></div>
      {balances.error && <p className="error-message" role="alert">{balances.error}</p>}
      <div className="balance-cards"><div className="balance-card"><span className="imd-token">I</span><span className="eyebrow">ORIGINAL IMD</span><strong>{balances.data ? formatAmount(balances.data.imd, 18, 6) : '—'} <small>IMD</small></strong><External href={explorerAddress(IMD_ADDRESS)}>Token contract</External></div><div className="balance-card"><img src="/logo.svg" alt="" /><span className="eyebrow">SPECTRA</span><strong>{balances.data?.spectra !== null && balances.data?.spectra !== undefined ? formatAmount(balances.data.spectra, 18, 6) : '—'} <small>SPECTRA</small></strong>{deploymentState.deployment ? <External href={explorerAddress(deploymentState.deployment.token)}>Token contract</External> : <span className="field-note">Awaiting token deployment</span>}</div></div>
      <div className="portfolio-positions"><h2>Your staking positions.</h2>{deploymentState.status !== 'ready' ? <div className="subtle-notice"><Cube size={20} /><span>Staking positions will be available after on-chain activation.</span></div> : <div className="positions-table"><div className="positions-head"><span>Pool</span><span>Staked principal</span><span>Claimable SPECTRA</span></div><div><strong>SPECTRA pool</strong><span>{spectraPosition.data ? formatAmount(spectraPosition.data.staked, 18, 6) : '—'} SPECTRA</span><span>{spectraPosition.data ? formatAmount(spectraPosition.data.earned, 18, 6) : '—'}</span></div><div><strong>IMD pool</strong><span>{imdPosition.data ? formatAmount(imdPosition.data.staked, 18, 6) : '—'} IMD</span><span>{imdPosition.data ? formatAmount(imdPosition.data.earned, 18, 6) : '—'}</span></div>{(spectraPosition.error || imdPosition.error) && <p className="error-message" role="alert">{spectraPosition.error || imdPosition.error}</p>}</div>}</div>
    </>}
  </section>;
}

function About({ deploymentState }: { deploymentState: DeploymentState }) {
  const deployment = deploymentState.deployment;
  return <section className="app-page section-wrap about-page"><PageHeading label="THE PROJECT / SPECTRA IMD" title={<>Human at heart.<br /><span>Ethereum by design.</span></>} description="An independent project with an original token and a clear allocation. Built to give people a more useful view of the IMD ecosystem." />
    <div className="about-intro"><div className="about-logo"><img src="/logo.svg" alt="SPECTRA IMD prism" /><span className="eyebrow">A NEW PERSPECTIVE</span></div><div><h2>A spectrum of<br />possibilities.</h2><p>SPECTRA is a separate Ethereum token. IMD Radar reads public community coin data, and the portfolio reads balances directly from Ethereum. The staking system contains two independent reward pools: one for SPECTRA deposits, one for original IMD deposits.</p><p>SPECTRA IMD is independently operated and is not affiliated with, endorsed by, or an official product of identity.md, IMD, or IMDFORGE.</p></div></div>
    <div className="allocation-section"><div className="section-intro"><div className="eyebrow">FIXED SUPPLY / APPROVED ALLOCATION</div><h2>10,000,000 <span>SPECTRA.</span></h2><p>The approved supply is fixed. The token contract does not include a function to mint additional tokens after deployment.</p></div><div className="allocation-bar" aria-label="Allocation: 80 percent project treasury, 10 percent SPECTRA pool, 10 percent IMD pool"><span /><span /><span /></div><div className="allocation-grid"><div><span className="allocation-dot treasury" /><span>Project treasury</span><strong>8,000,000 <small>80%</small></strong><p>Held by the project’s treasury wallet.</p></div><div><span className="allocation-dot spectra" /><span>SPECTRA pool rewards</span><strong>1,000,000 <small>10%</small></strong><p>Reserved for SPECTRA depositors.</p></div><div><span className="allocation-dot imd" /><span>IMD pool rewards</span><strong>1,000,000 <small>10%</small></strong><p>Reserved for original IMD depositors.</p></div></div><p className="field-note">These are approved allocations. {deploymentState.status === 'ready' ? 'Activated contract addresses are listed below.' : 'They do not represent deployed tokens or funded on-chain balances.'}</p></div>
    <div className="transparency-grid"><div className="transparency-card"><span className="eyebrow">ON-CHAIN STATUS</span><h3>Verify, then participate.</h3><Status active={deploymentState.status === 'ready'}>{deploymentState.status === 'ready' ? 'Contracts activated' : 'Awaiting on-chain activation'}</Status>{deployment ? <div className="contract-links"><div><span>SPECTRA token</span><CopyAddress address={deployment.token} /></div><div><span>SPECTRA pool</span><CopyAddress address={deployment.spectraPool} /></div><div><span>IMD pool</span><CopyAddress address={deployment.imdPool} /></div><div><span>Treasury</span><CopyAddress address={deployment.treasury} /></div><External href={explorerTx(deployment.deploymentTx)}>Deployment transaction</External></div> : <p>The token and staking pools require publication and funding on Ethereum. This website enables staking only when its contract checks succeed.</p>}<External href={repository + '/tree/main/contracts'}>Read the contract source</External></div><div className="transparency-card"><span className="eyebrow">PARTICIPATION</span><h3>A few clear principles.</h3><div className="principle-list"><p><CheckCircle size={18} /><span>Withdraw at any time, with no project fee.</span></p><p><CheckCircle size={18} /><span>Ethereum transaction fees still apply.</span></p><p><CheckCircle size={18} /><span>Each reward pool runs for 180 days from its first stake.</span></p><p><CheckCircle size={18} /><span>Returns depend on pool participation. They are not guaranteed.</span></p></div><p className="field-note">Smart contracts can carry risks. The source is available for inspection; an independent security audit has not been completed.</p></div></div>
    <div className="data-about"><div><div className="eyebrow">OPEN DATA / REAL UTILITY</div><h2>See the source.<br /><span>Follow the signal.</span></h2></div><p>IMD Radar uses indexed community coin records and trading activity. Portfolio and staking balances use Ethereum reads. Prices shown in IMD are indicative reserve ratios, not guaranteed trade quotes. Source outages and indexing delays are displayed in the interface.</p><External href="https://communitycoins.imd.fun/">Visit Community Coins</External></div>
  </section>;
}

export default function App() {
  const [view, setView] = useState<View>(() => { const hash = window.location.hash.slice(1) as View; return views.includes(hash) ? hash : 'home'; });
  const [walletOpen, setWalletOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const wallet = useWallet();
  const deploymentState = useDeployment();
  const radar = useRadar();
  function navigate(next: View) { setView(next); window.location.hash = next === 'home' ? '' : next; setMenuOpen(false); window.scrollTo({ top: 0, behavior: 'instant' }); }
  useEffect(() => { const change = () => { const hash = window.location.hash.slice(1) as View; setView(views.includes(hash) ? hash : 'home'); setMenuOpen(false); }; window.addEventListener('hashchange', change); return () => window.removeEventListener('hashchange', change); }, []);
  const closeWallet = () => setWalletOpen(false);
  return <div className="app-shell"><a className="skip-link" href="#main" onClick={event => { event.preventDefault(); document.getElementById('main')?.focus(); }}>Skip to content</a>
    <header className="site-header"><a className="brand" href="#" onClick={event => { event.preventDefault(); navigate('home'); }} aria-label="SPECTRA IMD home"><img src="/logo.svg" alt="" /><span>SPECTRA <small>IMD</small></span></a><nav className={`main-nav ${menuOpen ? 'mobile-open' : ''}`} aria-label="Main navigation">{(['stake', 'radar', 'portfolio', 'about'] as View[]).map(item => <a key={item} className={view === item ? 'active' : ''} href={`#${item}`} onClick={event => { event.preventDefault(); navigate(item); }} aria-current={view === item ? 'page' : undefined}>{item === 'radar' ? 'IMD Radar' : item.charAt(0).toUpperCase() + item.slice(1)}</a>)}</nav><div className="header-actions"><span className="network-badge"><span className="eth-mini" />Ethereum</span>{wallet.address ? <div className="wallet-connected"><button className="button button-wallet" onClick={() => navigate('portfolio')} aria-label="Open portfolio for connected wallet"><span className="connected-dot" />{shortAddress(wallet.address)}</button><button className="icon-button disconnect-wallet" onClick={wallet.disconnect} aria-label="Disconnect wallet"><X size={14} /></button></div> : <button className="button button-wallet" onClick={() => setWalletOpen(true)}><Wallet size={16} />Connect wallet</button>}<button className={`menu-toggle ${menuOpen ? 'open' : ''}`} aria-label={menuOpen ? 'Close menu' : 'Open menu'} aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}><span /><span /></button></div></header>
    <main id="main" tabIndex={-1}>{view === 'home' && <Home go={navigate} activated={deploymentState.status === 'ready'} />}{view === 'stake' && <Stake wallet={wallet} deploymentState={deploymentState} connect={() => setWalletOpen(true)} />}{view === 'radar' && <Radar radar={radar} />}{view === 'portfolio' && <Portfolio wallet={wallet} deploymentState={deploymentState} connect={() => setWalletOpen(true)} />}{view === 'about' && <About deploymentState={deploymentState} />}</main>
    <footer className="site-footer section-wrap"><div><a className="brand" href="#" onClick={event => { event.preventDefault(); navigate('home'); }}><img src="/logo.svg" alt="" /><span>SPECTRA <small>IMD</small></span></a><p>A human signal. An Ethereum future.</p></div><div className="footer-links"><button onClick={() => navigate('about')}>Project & transparency</button><External href={repository}>Source code</External><External href={explorerAddress(IMD_ADDRESS)}>Original IMD contract</External></div><div className="footer-bottom"><span>Independent project on Ethereum.</span><span>Public data. Personal decisions.</span></div></footer>
    <WalletDialog wallet={wallet} open={walletOpen} close={closeWallet} />
  </div>;
}
