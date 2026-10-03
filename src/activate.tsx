import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createWalletClient, custom, encodeDeployData, formatEther, getAddress, parseEther, type Abi, type Address, type Hex } from 'viem';
import { mainnet } from 'viem/chains';
import { publicClient, useWallet, IMD_ADDRESS, assertWalletContext, parseDeployment, verifyDeployment } from './lib';
import '@fontsource-variable/manrope';
import './activation.css';

type Build = { compilerVersion: string; buildInputSha256: string; factory: { abi: Abi; bytecode: Hex }; token: { abi: Abi }; pool: { abi: Abi } };
type Result = { chainId: 1; factory: Address; token: Address; spectraPool: Address; imdPool: Address; treasury: Address; deploymentTx: Hex };
type Quote = { account: Address; data: Hex; gas: bigint; fee: bigint; tip: bigint; maximum: bigint; at: number };
const storageKey = 'spectra.activation.transaction';
const safeError = (error: unknown) => error instanceof Error && /reject|denied/i.test(error.message) ? 'The request was cancelled in your wallet.' : error instanceof Error ? error.message.split('\n')[0].slice(0,220) : 'The operation could not be completed. Please try again.';
const short = (address: string) => `${address.slice(0,8)}…${address.slice(-6)}`;

function Activation() {
  const wallet = useWallet();
  const [build,setBuild] = useState<Build|null>(null);
  const [existing,setExisting] = useState(false);
  const [ready,setReady] = useState(false);
  const [quote,setQuote] = useState<Quote|null>(null);
  const [reviewed,setReviewed] = useState(false);
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState('Loading the verified build…');
  const [hash,setHash] = useState<Hex|null>(() => { try { const h=localStorage.getItem(storageKey);return h && /^0x[0-9a-fA-F]{64}$/.test(h) ? h as Hex : null; } catch { return null; } });
  const [result,setResult] = useState<Result|null>(null);
  useEffect(() => {
    const controller=new AbortController();
    void Promise.all([fetch('/contracts.json',{signal:controller.signal,cache:'no-store'}),fetch('/deployment.json',{signal:controller.signal,cache:'no-store'})]).then(async ([b,d])=>{
      if(!b.ok||!d.ok) throw new Error('The deployment files could not be loaded.');
      const artifact=await b.json() as Build;
      const deployment=await d.json();
      if(!artifact.compilerVersion?.startsWith('0.8.30') || !Array.isArray(artifact.factory?.abi) || !/^0x[0-9a-fA-F]{100,}$/.test(artifact.factory?.bytecode??'') || !/^[0-9a-f]{64}$/i.test(artifact.buildInputSha256)) throw new Error('This contract build is not valid.');
      const configured=parseDeployment(deployment)!==null;
      setExisting(configured);setBuild(artifact);setReady(true);setMessage(configured?'A deployment is already configured. Use the main website.':'Connect your project wallet to review the deployment cost.');
    }).catch(error=>{ if(!controller.signal.aborted) setMessage(safeError(error)); });
    return ()=>controller.abort();
  },[]);
  async function currentAccount() {
    if(!wallet.provider || !wallet.address) throw new Error('Connect your project wallet first.');
    await assertWalletContext(wallet.provider,wallet.address);
    return getAddress(wallet.address);
  }
  async function estimate() {
    setBusy(true);setReviewed(false);setQuote(null);
    try {
      if(!build||!ready||existing) throw new Error('Activation is not available.');
      const account=await currentAccount();
      const [chain,code,decimals]=await Promise.all([publicClient.getChainId(),publicClient.getBytecode({address:IMD_ADDRESS}),publicClient.readContract({address:IMD_ADDRESS,abi:[{type:'function',name:'decimals',stateMutability:'view',inputs:[],outputs:[{type:'uint8'}]}],functionName:'decimals'})]);
      if(chain!==1||!code||code==='0x'||decimals!==18) throw new Error('The original IMD contract could not be verified on Ethereum.');
      const data=encodeDeployData({abi:build.factory.abi,bytecode:build.factory.bytecode,args:[IMD_ADDRESS]});
      const estimated=await publicClient.estimateGas({account,data});
      const gas=(estimated*120n+99n)/100n;
      const fees=await publicClient.estimateFeesPerGas();
      const fee=fees.maxFeePerGas;
      const tip=fees.maxPriorityFeePerGas;
      if(!fee||fee<=0n||tip===undefined) throw new Error('The Ethereum fee estimate is unavailable.');
      await currentAccount();
      setQuote({account,data,gas,fee,tip,maximum:gas*fee,at:Date.now()});
      setMessage('Review the wallet address, allocation and maximum estimated network fee below.');
    } catch(error) {setMessage(safeError(error));} finally {setBusy(false);}
  }
  async function recover(txHash: Hex) {
    if(!build) throw new Error('Load the contract build first.');
    const receipt=await publicClient.waitForTransactionReceipt({hash:txHash,confirmations:2,timeout:180_000});
    if(receipt.status!=='success'||!receipt.contractAddress) {
      setHash(null);setQuote(null);setReviewed(false);
      try {localStorage.removeItem(storageKey);}catch { /* A confirmed failure may be reviewed again. */ }
      throw new Error('The confirmed transaction did not create the project. You can review a new deployment estimate.');
    }
    const actualHash=receipt.transactionHash;
    setHash(actualHash);try {localStorage.setItem(storageKey,actualHash);}catch { /* Keep the confirmed hash visible. */ }
    const factory=receipt.contractAddress;
    const tx=await publicClient.getTransaction({hash:actualHash});
    const expected=encodeDeployData({abi:build.factory.abi,bytecode:build.factory.bytecode,args:[IMD_ADDRESS]});
    if(tx.to!==null||tx.input.toLowerCase()!==expected.toLowerCase()) throw new Error('This transaction does not match the reviewed SPECTRA deployment.');
    const [token,spectraPool,imdPool,treasury,imd]=await Promise.all(['token','spectraPool','imdPool','treasury','imdToken'].map(functionName=>publicClient.readContract({address:factory,abi:build.factory.abi,functionName}))) as Address[];
    if(getAddress(treasury)!==getAddress(receipt.from)||getAddress(imd)!==getAddress(IMD_ADDRESS)) throw new Error('The deployed project does not match the approved treasury or IMD token.');
    const [supply,budgetA,budgetB,stakeA,stakeB,rewardA,rewardB]=await Promise.all([
      publicClient.readContract({address:token,abi:build.token.abi,functionName:'totalSupply'}),
      publicClient.readContract({address:spectraPool,abi:build.pool.abi,functionName:'rewardBudget'}),
      publicClient.readContract({address:imdPool,abi:build.pool.abi,functionName:'rewardBudget'}),
      publicClient.readContract({address:spectraPool,abi:build.pool.abi,functionName:'stakingToken'}),
      publicClient.readContract({address:imdPool,abi:build.pool.abi,functionName:'stakingToken'}),
      publicClient.readContract({address:spectraPool,abi:build.pool.abi,functionName:'rewardsToken'}),
      publicClient.readContract({address:imdPool,abi:build.pool.abi,functionName:'rewardsToken'})
    ]);
    if(supply!==parseEther('10000000')||budgetA!==parseEther('1000000')||budgetB!==parseEther('1000000')||getAddress(stakeA as string)!==getAddress(token)||getAddress(stakeB as string)!==getAddress(IMD_ADDRESS)||getAddress(rewardA as string)!==getAddress(token)||getAddress(rewardB as string)!==getAddress(token)) throw new Error('The deployed allocations or pool tokens could not be verified.');
    const deployment:Result={chainId:1,factory,token,spectraPool,imdPool,treasury,deploymentTx:actualHash};
    await verifyDeployment(deployment);
    setResult(deployment);
    setMessage('Deployment confirmed on Ethereum. Share the transaction hash with David’s project assistant to connect these contracts to the website.');
  }
  async function deploy() {
    setBusy(true);
    try {
      if(!quote||!build||!reviewed||existing||hash) throw new Error('Review a fresh deployment estimate first.');
      const account=await currentAccount();
      if(account!==quote.account||Date.now()-quote.at>120_000) throw new Error('The quote expired or your account changed. Review the cost again.');
      if(!wallet.provider) throw new Error('Your wallet is disconnected.');
      const client=createWalletClient({chain:mainnet,transport:custom(wallet.provider)});
      setMessage('Review and confirm the deployment in your wallet.');
      await assertWalletContext(wallet.provider,account);
      const txHash=await client.deployContract({account,abi:build.factory.abi,bytecode:build.factory.bytecode,args:[IMD_ADDRESS],gas:quote.gas,maxFeePerGas:quote.fee,maxPriorityFeePerGas:quote.tip});
      setHash(txHash);try {localStorage.setItem(storageKey,txHash);}catch { /* The transaction hash remains visible. */ }
      setMessage('Transaction submitted. Waiting for two Ethereum confirmations…');
      await recover(txHash);
    } catch(error) {setMessage(safeError(error));} finally {setBusy(false);}
  }
  function download() {if(!result)return;const url=URL.createObjectURL(new Blob([JSON.stringify(result,null,2)+'\n'],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='deployment.json';a.click();URL.revokeObjectURL(url);}
  return <main className="activation"><a className="activation-brand" href="/"><img src="/logo.svg" alt="" width="35" height="35"/> SPECTRA <span>IMD</span></a><p className="activation-eyebrow">PROJECT WALLET · ETHEREUM MAINNET</p><h1>Bring Spectra<br/><em>on-chain.</em></h1><p className="activation-intro">Create the fixed-supply SPECTRA token and both funded staking programs in one wallet transaction.</p><section className="activation-plan"><div><span>Total fixed supply</span><strong>10,000,000 SPECTRA</strong></div><div><span>Your project wallet</span><strong>8,000,000 SPECTRA</strong></div><div><span>SPECTRA staking reserve</span><strong>1,000,000 SPECTRA</strong></div><div><span>IMD staking reserve</span><strong>1,000,000 SPECTRA</strong></div><div><span>Each reward program</span><strong>180 days from its first deposit</strong></div><div><span>Withdrawals</span><strong>Any time · no project fee</strong></div></section><p className="activation-note">Both programs pay rewards in SPECTRA. This transaction does not buy IMD, create market liquidity or set a token price. Ethereum charges a network fee. The contracts have passed project checks; they have not received an independent audit.</p><section className="activation-controls"><h2>Your deployment wallet</h2>{wallet.wallets.length>0?<label>Choose wallet<select disabled={busy} value={wallet.selectedWalletId??''} onChange={e=>wallet.selectWallet(e.target.value)}><option value="" disabled>Select wallet</option>{wallet.wallets.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select></label>:<p>Open this page in a browser with an Ethereum wallet installed.</p>}{wallet.address?<p className="activation-address"><strong>{short(wallet.address)}</strong><a href={`https://etherscan.io/address/${wallet.address}`} target="_blank" rel="noreferrer">View wallet ↗</a></p>:<button disabled={busy||!wallet.selectedWalletId} onClick={()=>void wallet.connect()}>Connect project wallet</button>}{wallet.address&&wallet.chainId!==1&&<button disabled={busy} onClick={()=>void wallet.switchToEthereum()}>Switch to Ethereum</button>}<button disabled={!ready||existing||!wallet.address||wallet.chainId!==1||busy||!!hash} onClick={()=>void estimate()}>Review deployment cost</button>{quote&&<div className="activation-quote"><span>Project treasury</span><code>{quote.account}</code><span>Estimated maximum network fee</span><strong>{formatEther(quote.maximum)} ETH</strong><small>The wallet shows the final fee before you confirm. Review again if this estimate is over two minutes old.</small><label className="activation-check"><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/>I have reviewed the treasury wallet, allocations and Ethereum fee.</label><button disabled={!reviewed||busy||!!hash||wallet.address?.toLowerCase()!==quote.account.toLowerCase()||wallet.chainId!==1} onClick={()=>void deploy()}>Deploy with my wallet</button></div>}<p role="status" className="activation-status">{wallet.error||message}</p>{hash&&<div className="activation-transaction"><a href={`https://etherscan.io/tx/${hash}`} target="_blank" rel="noreferrer">View deployment transaction ↗</a><code>{hash}</code>{!result&&<button disabled={busy||!build} onClick={()=>{setBusy(true);void recover(hash).catch(e=>setMessage(safeError(e))).finally(()=>setBusy(false));}}>Recover deployment result</button>}</div>}{result&&<div className="activation-result"><h2>Contracts confirmed</h2>{(['factory','token','spectraPool','imdPool'] as const).map(key=><p key={key}><span>{key}</span><a href={`https://etherscan.io/address/${result[key]}`} target="_blank" rel="noreferrer">{result[key]}</a></p>)}<button onClick={download}>Download activation record</button></div>}</section><p className="activation-build">Build fingerprint: <code>{build?.buildInputSha256??'Loading'}</code></p></main>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Activation/></React.StrictMode>);
