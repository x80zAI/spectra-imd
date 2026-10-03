# SPECTRA IMD

An independent Ethereum project combining original holographic artwork, two funded staking programs and a live IMD ecosystem market reader. The entire visitor interface is in English. This project is not affiliated with identity.md.

## Current state

IMD Radar reads real Community Coins registrations and transactions from the public ecosystem indexer. Wallet balances are read from Ethereum. No example wallets, synthetic trades, simulated rewards or invented prices are supplied.

The new SPECTRA token and staking contracts require a real Ethereum deployment signed by David's project wallet. Until that transaction is confirmed and its verified addresses are published in `public/deployment.json`, the website clearly identifies staking as awaiting on-chain activation and does not request deposits. Publishing a website does not deploy the contracts.

## Approved allocation and rules

| Allocation | SPECTRA |
| --- | ---: |
| Fixed total supply | 10,000,000 |
| Project treasury wallet | 8,000,000 |
| Reserve for SPECTRA deposits | 1,000,000 |
| Reserve for original IMD deposits | 1,000,000 |

Both separate staking pools pay SPECTRA. Each pool runs for 180 days beginning with its first deposit, distributes rewards in proportion to stake, and permits withdrawals without a project fee. Ethereum network fees still apply. Unoccupied time earns no rewards for any user; unused reserve can return to the fixed treasury only after the program finishes. Earned rewards and deposits remain protected and can be withdrawn after the program ends.

The token has no later minting, transfer tax, blacklist, proxy or owner pause. Neither staking pool gives an administrator a power to take deposits, change the rate or retrieve earned rewards. The contracts are not independently audited. See `docs/CONTRACTS.md` for exact accounting and limitations.

## Develop and verify

Node.js 24 is required. Install the lockfile versions with `npm ci`, then run `npm run dev`. The local website uses port 5191.

Checks before delivery or publication:

```sh
npm run lint
npm run typecheck
npm test
npm run contracts:test
npm run build
```

Compilation uses Solidity 0.8.30, the Shanghai EVM target and pinned OpenZeppelin contracts. `public/contracts.json` includes the exact factory creation bytecode, ABIs, runtime reference data and the source build fingerprint. The contract tests run those same production bytecodes on a local EVM; the local test chain is never used by the visitor website.

## Activate real contracts

Open `/activate.html` in a browser with an Ethereum wallet. Select the project wallet, switch to Ethereum mainnet and review the treasury address, approved allocation and current estimated network fee. Only the wallet owner should perform the final deployment confirmation. No seed phrase, private key or wallet password is needed by the website or assistant.

The factory creates and funds all three components atomically: the token and both staking pools. Wait for two Ethereum confirmations, then provide the transaction hash to the assistant. The assistant verifies the receipt, constructor bytecode, token and pool rules before committing and publishing the resulting deployment record. Downloading the record by itself does not activate the public website.

The deployment transaction does not establish a token price, a market or liquidity. The SPECTRA token is distinct from the original IMD asset. The radar displays existing ecosystem coins and does not imply that SPECTRA has been admitted to the Community Coins launchpad.

## Public data

- Original IMD: `0xD34a99Bc0f67aE1bbd63C660e6d0b0dd03E263B7` on Ethereum mainnet.
- Ethereum read services: PublicNode with Cloudflare fallback.
- Community Coins indexer: `https://imd-communitycoins-indexer.up.railway.app/graphql`.
- Official ecosystem: [imd.fun/token](https://imd.fun/token/) and [Community Coins](https://communitycoins.imd.fun/).

Radar prices are indicative in IMD, computed from the launchpad's reported virtual reserve ratio. Virtual reserves are not available funds. Real IMD backing is displayed separately. Cumulative trade volume is not described as 24-hour volume. Each snapshot carries its reading time; failures are reported as unavailable rather than replaced with invented zeroes. The indexer is operated by a third party and has no availability guarantee supplied to this project.

Wallet requests are limited to user-selected providers. Reading needs no signatures. Approvals use the exact entered amount; deposits, claims and withdrawals require separate user actions and wallet confirmations. The website rechecks the account, network, contract identity and receipt. Watchlist entries, if used, stay in the visitor's browser.

## Hosting

Source belongs in David's `x80zAI` GitHub account. Hosting is Vercel in David's projects. No X account or custom domain is configured yet. No paid data service, cloud agent or Cloudflare account is required by the current utility.

`vercel.json` builds with `npm ci` / `npm run build`, serves `dist`, and configures browser security headers. `deployment.json` is served without caching so later activation is picked up. Build output, wallet secrets and local dependency folders are excluded from Git.
