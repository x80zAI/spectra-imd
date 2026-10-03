# SPECTRA IMD contracts

The production contracts are implemented and locally verified. They are not deployed by these scripts, and local verification is not an independent security audit. The website must show staking as awaiting activation until an Ethereum mainnet deployment has been verified.

## Approved token allocation

| Destination | SPECTRA | Share |
| --- | ---: | ---: |
| Project treasury: the wallet deploying the factory | 8,000,000 | 80% |
| SPECTRA deposit pool reward reserve | 1,000,000 | 10% |
| IMD deposit pool reward reserve | 1,000,000 | 10% |
| Fixed total supply | 10,000,000 | 100% |

`SpectraToken` uses the name **Spectra IMD**, symbol **SPECTRA** and 18 decimals. Its constructor creates the entire supply once. There is no later minting, burn method, owner, blacklist, transfer tax, pause switch, proxy or upgrade mechanism.

`SpectraFactory` creates the token and both pools in one transaction. It transfers the entire allocation before the transaction succeeds. No separate funding transaction is needed and the factory retains no SPECTRA. If any deployment or transfer fails, the entire transaction reverts.

The factory's constructor receives the staking IMD contract address. Production activation must use Ethereum mainnet, chain ID **1**, and IMD **`0xD34a99Bc0f67aE1bbd63C660e6d0b0dd03E263B7`**, as identified by the [official IMD token page](https://imd.fun/token/). The parameter exists to permit isolated local verification; it does not certify an arbitrary address as official IMD. The website must verify the configured address and deployed factory's getters before enabling deposits.

## Staking behavior

Both pools pay rewards in SPECTRA. Their deposited tokens differ: one accepts SPECTRA and the other accepts the configured IMD token. They operate independently.

- Each pool starts a single **180-day** program when its first successful deposit is received. The first depositor determines its start time; there is no administrator start button.
- Each pool distributes at most its 1,000,000 SPECTRA reserve. `rewardRate = rewardBudget / 15,552,000` in the token's smallest unit per second. Integer rounding leaves a small unused remainder.
- Rewards are allocated in proportion to each user's deposited amount during each elapsed interval. A later deposit receives no rewards for time before that deposit.
- Intervals with no deposits distribute no rewards. These intervals do not postpone the program's end date.
- Depositors can withdraw any part of their principal at any time. They can claim rewards separately or use `exit()` to withdraw all principal and claim rewards together.
- There is no project deposit, withdrawal or claim fee. Ethereum transaction fees are still paid to the network.
- New deposits are rejected from the end timestamp onward. Withdrawals and earned claims remain available afterward, with no claim expiry.
- The reserves fund token distributions; the contracts do not generate trading revenue, establish a market price, create liquidity or promise a fixed percentage return.

The accounting uses `Math.mulDiv` and a `1e27` accumulator. Every operation which touches a user's stake updates their earned rewards before changing their deposited balance. Transfer-tax deposits are rejected by verifying that the exact requested amount arrived. The supported assets are the standard SPECTRA and specified IMD ERC-20 tokens; rebasing, transfer-tax or malicious token behavior is not supported.

## Treasury permissions and protected funds

The treasury is fixed to the factory deployment wallet. There is no transfer-of-ownership method, configurable emission rate, pause function or administrative principal withdrawal.

After a pool's 180-day program has ended, only the treasury may call `recoverUnusedRewards()`. This returns only reward tokens which are not needed for emitted rewards. The protected reward liability is `emittedRewards - claimedRewards`; this deliberately includes rounding dust as well as users' earned claims.

For the SPECTRA deposit pool, deposited principal and reward reserves use the same token. Recovery additionally protects **all `totalStaked` principal**. For the IMD pool, recovery transfers only SPECTRA; deposited IMD cannot be recovered by the treasury. The method has no arbitrary recipient or arbitrary-token parameter.

All deposit, withdrawal, claim, exit and recovery operations use OpenZeppelin's reentrancy guard. ERC-20 transfers use `SafeERC20`.

A pool that never receives its first deposit has no program end time. Its prefunded reserve remains in that pool until a program starts and finishes. Tokens accidentally sent which are neither that pool's staking token nor its reward token have no recovery method.

## Build and artifacts

Run from the project directory after installing the locked dependencies:

```sh
node scripts/compile-contracts.mjs
node scripts/test-contracts.mjs
```

Production compilation uses exact Solidity **0.8.30**, optimizer enabled with **200 runs**, and **Shanghai** as the EVM target. Shanghai bytecode is supported on Ethereum mainnet and can be executed by the local Ganache verifier without compiling a different production variant. The compiler refuses a different Solidity version.

Generated files:

| File | Purpose |
| --- | --- |
| `artifacts/build-input.json` | Complete standard JSON compiler input, including imported library sources and exact settings; useful for explorer source verification |
| `artifacts/contracts.json` | Production ABI, creation bytecode, runtime templates, immutable reference offsets and metadata |
| `public/contracts.json` | The same production artifacts, available to the wallet activation flow |
| `artifacts/test-contracts.json` | Local-only artificial assets for automated verification; excluded from website artifacts |

The production export has `factory`, `token` and `pool` objects. Each object contains `abi`, `bytecode`, `deployedBytecode`, `immutableReferences`, `contractName`, `sourceName` and compiler metadata. Factory and pool runtime templates contain placeholders for immutable values. Deployed-code verification must compare all other bytes and separately verify their immutable getters; a naive byte-for-byte comparison to those placeholders would be incorrect.

The factory exposes `treasury()`, `imdToken()`, `token()`, `spectraPool()` and `imdPool()`. Its `ProjectCreated` event contains all deployment addresses. Pool timing getters are `startTime()` and `finishTime()`; its reward token getter is `rewardsToken()`.

## Verification performed

The local test suite executes the **same production creation bytecode and ABI** supplied to the website. It sends no transaction to a public network and writes no wallet secrets.

The twelve verification groups cover fixed supply and allocation; independent first-deposit start times; proportional rewards and late entrants; fee-free partial and full withdrawals; empty-stake intervals; post-program recovery with same-token principal protection; IMD principal protection; insufficient reserve and invalid deployment inputs; unauthorized, zero and unapproved actions; atomic rejection of transfer-tax deposits; callback reentrancy rejection; and repeated multi-user deposits, withdrawals and claims.

The repeated-operation check performs 40 state-changing operations in each pool, verifies reserve solvency and aggregate principal after every step, then recovers unused reserve and exits all participants after the program ends. Earned claims are also exercised one year after the deadline.

Current production contract sizes are below Ethereum's creation and runtime limits: factory creation **9,843 bytes**, token creation **2,814 bytes**, and pool creation **5,695 bytes**. The resulting runtime sizes are **453**, **1,815** and **5,139 bytes**, respectively.

On the bundled Node.js 24 Windows runtime, Ganache reports that its optional native micro-websocket binary is unavailable and uses its JavaScript fallback. The tests run successfully through its in-process provider; no websocket server is required.

Source references: [OpenZeppelin ERC-20 and SafeERC20 documentation](https://docs.openzeppelin.com/contracts/5.x/api/token/erc20), [OpenZeppelin utility documentation](https://docs.openzeppelin.com/contracts/5.x/api/utils).
