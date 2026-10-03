import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ganache from 'ganache';
import { createPublicClient, createWalletClient, custom, decodeErrorResult, defineChain, getAddress, parseEther, toFunctionSelector } from 'viem';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = JSON.parse(readFileSync(path.join(root, 'artifacts/contracts.json'), 'utf8'));
const fixtures = JSON.parse(readFileSync(path.join(root, 'artifacts/test-contracts.json'), 'utf8'));
assert.equal(artifacts.evmVersion, 'shanghai', 'Tests must execute the production EVM target');
assert.deepEqual(artifacts, JSON.parse(readFileSync(path.join(root, 'public/contracts.json'), 'utf8')));

const provider = ganache.provider({
  logging: { quiet: true },
  chain: { chainId: 1337, hardfork: 'shanghai', time: new Date('2026-01-01T00:00:00Z') },
  wallet: { totalAccounts: 6, defaultBalance: 1000 },
  miner: { timestampIncrement: 0, blockGasLimit: 30_000_000 },
});
const transport = custom(provider);
const localChain = defineChain({
  id: 1337,
  name: 'Local contract verification',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['http://127.0.0.1'] } },
});
const client = createPublicClient({ chain: localChain, transport });
const accounts = (await provider.request({ method: 'eth_accounts', params: [] })).map((address) => getAddress(address));
const wallets = accounts.map((account) => createWalletClient({ account, chain: localChain, transport }));
const [treasury, alice, bob, carol] = accounts;
const ZERO = '0x0000000000000000000000000000000000000000';
const DURATION = 180n * 24n * 60n * 60n;
const BUDGET = parseEther('1000000');
let checks = 0;

async function deploy(artifact, args = [], sender = 0) {
  const hash = await wallets[sender].deployContract({ abi: artifact.abi, bytecode: artifact.bytecode, args, gas: 15_000_000n });
  const receipt = await client.waitForTransactionReceipt({ hash });
  assert.equal(receipt.status, 'success');
  assert.ok(receipt.contractAddress);
  return getAddress(receipt.contractAddress);
}
async function read(address, artifact, functionName, args = []) {
  return client.readContract({ address, abi: artifact.abi, functionName, args });
}
async function write(address, artifact, functionName, args = [], sender = 0) {
  const hash = await wallets[sender].writeContract({ address, abi: artifact.abi, functionName, args, gas: 5_000_000n });
  const receipt = await client.waitForTransactionReceipt({ hash });
  assert.equal(receipt.status, 'success', `${functionName} reverted`);
  return receipt;
}
async function expectRevert(address, artifact, functionName, args, sender, errorName) {
  const abi = [...artifact.abi, ...artifacts.token.abi.filter((entry) => entry.type === 'error')];
  await assert.rejects(
    client.simulateContract({ address, abi, functionName, args, account: accounts[sender] }),
    (error) => {
      const revert = error.walk?.((cause) => cause.name === 'ContractFunctionRevertedError');
      const rawRevert = error.walk?.((cause) => typeof cause.data === 'string' && cause.data.startsWith('0x'));
      const decoded = revert?.data ?? (rawRevert ? decodeErrorResult({ abi, data: rawRevert.data }) : undefined);
      assert.equal(decoded?.errorName, errorName, error.shortMessage);
      return true;
    },
  );
}
async function expectDeployRevert(artifact, args) {
  const hash = await wallets[0].deployContract({ abi: artifact.abi, bytecode: artifact.bytecode, args, gas: 15_000_000n });
  const receipt = await client.waitForTransactionReceipt({ hash });
  assert.equal(receipt.status, 'reverted');
}
async function advance(seconds) {
  await provider.request({ method: 'evm_increaseTime', params: [Number(seconds)] });
  await provider.request({ method: 'evm_mine', params: [] });
}
function close(actual, expected, tolerance = 10n) {
  assert.ok(actual >= expected - tolerance && actual <= expected + tolerance, `${actual} differs from ${expected}`);
}
async function check(name, task) {
  const snapshot = await provider.request({ method: 'evm_snapshot', params: [] });
  try {
    await task();
    checks += 1;
    console.log(`PASS ${checks}: ${name}`);
  } finally {
    await provider.request({ method: 'evm_revert', params: [snapshot] });
  }
}

try {
  const imd = await deploy(fixtures.mockIMD);
  const factory = await deploy(artifacts.factory, [imd]);
  const token = getAddress(await read(factory, artifacts.factory, 'token'));
  const spectraPool = getAddress(await read(factory, artifacts.factory, 'spectraPool'));
  const imdPool = getAddress(await read(factory, artifacts.factory, 'imdPool'));
  const rate = await read(spectraPool, artifacts.pool, 'rewardRate');

  for (const address of [alice, bob, carol]) {
    await write(token, artifacts.token, 'transfer', [address, parseEther('10000')]);
    await write(imd, fixtures.mockIMD, 'transfer', [address, parseEther('10000')]);
  }
  for (const sender of [1, 2, 3]) {
    await write(token, artifacts.token, 'approve', [spectraPool, parseEther('10000')], sender);
    await write(imd, fixtures.mockIMD, 'approve', [imdPool, parseEther('10000')], sender);
  }

  await check('Fixed 10M supply, treasury allocation and two fully funded immutable pools', async () => {
    assert.equal(await read(token, artifacts.token, 'name'), 'Spectra IMD');
    assert.equal(await read(token, artifacts.token, 'symbol'), 'SPECTRA');
    assert.equal(await read(token, artifacts.token, 'decimals'), 18);
    assert.equal(await read(token, artifacts.token, 'totalSupply'), parseEther('10000000'));
    assert.equal(await read(token, artifacts.token, 'balanceOf', [treasury]), parseEther('7970000'));
    assert.equal(await read(token, artifacts.token, 'balanceOf', [factory]), 0n);
    for (const pool of [spectraPool, imdPool]) {
      assert.equal(await read(token, artifacts.token, 'balanceOf', [pool]), BUDGET);
      assert.equal(getAddress(await read(pool, artifacts.pool, 'treasury')), treasury);
      assert.equal(await read(pool, artifacts.pool, 'rewardBudget'), BUDGET);
      assert.equal(await read(pool, artifacts.pool, 'DURATION'), DURATION);
      assert.equal(await read(pool, artifacts.pool, 'startTime'), 0n);
      assert.equal(getAddress(await read(pool, artifacts.pool, 'rewardsToken')), token);
    }
    assert.equal(getAddress(await read(spectraPool, artifacts.pool, 'stakingToken')), token);
    assert.equal(getAddress(await read(imdPool, artifacts.pool, 'stakingToken')), imd);
    const forbidden = ['mint', 'burn', 'pause', 'setRewardRate', 'setTreasury', 'setFees', 'transferOwnership', 'upgradeTo'];
    for (const artifact of [artifacts.token, artifacts.pool, artifacts.factory]) {
      assert.ok(!artifact.abi.some((entry) => entry.type === 'function' && forbidden.includes(entry.name)));
    }
  });

  await check('Programs begin independently on their first deposit; no rewards before activation', async () => {
    await advance(86400n);
    assert.equal(await read(spectraPool, artifacts.pool, 'earned', [alice]), 0n);
    await expectRevert(spectraPool, artifacts.pool, 'recoverUnusedRewards', [], 0, 'ProgramNotFinished');
    await write(spectraPool, artifacts.pool, 'stake', [parseEther('100')], 1);
    const spectraStart = await read(spectraPool, artifacts.pool, 'startTime');
    await advance(7200n);
    await write(imdPool, artifacts.pool, 'stake', [parseEther('100')], 2);
    const imdStart = await read(imdPool, artifacts.pool, 'startTime');
    assert.equal(imdStart - spectraStart, 7200n);
    assert.equal(await read(spectraPool, artifacts.pool, 'finishTime'), spectraStart + DURATION);
    assert.equal(await read(imdPool, artifacts.pool, 'finishTime'), imdStart + DURATION);
    close(await read(spectraPool, artifacts.pool, 'earned', [alice]), rate * 7200n);
    assert.equal(await read(imdPool, artifacts.pool, 'earned', [bob]), 0n);
  });

  await check('Rewards follow stake proportions and late deposits cannot claim earlier emissions', async () => {
    await write(spectraPool, artifacts.pool, 'stake', [parseEther('100')], 1);
    await write(spectraPool, artifacts.pool, 'stake', [parseEther('300')], 2);
    await advance(86400n);
    close(await read(spectraPool, artifacts.pool, 'earned', [alice]), rate * 86400n / 4n);
    close(await read(spectraPool, artifacts.pool, 'earned', [bob]), rate * 86400n * 3n / 4n);
    await write(spectraPool, artifacts.pool, 'stake', [parseEther('400')], 3);
    assert.equal(await read(spectraPool, artifacts.pool, 'earned', [carol]), 0n);
    const before = await read(token, artifacts.token, 'balanceOf', [bob]);
    const earned = await read(spectraPool, artifacts.pool, 'earned', [bob]);
    await write(spectraPool, artifacts.pool, 'claim', [], 2);
    assert.equal(await read(token, artifacts.token, 'balanceOf', [bob]) - before, earned);
    assert.equal(await read(spectraPool, artifacts.pool, 'claimedRewards'), earned);
    assert.equal(await read(spectraPool, artifacts.pool, 'balanceOf', [bob]), parseEther('300'));
  });

  await check('Partial and complete withdrawals return principal without a project fee', async () => {
    await write(spectraPool, artifacts.pool, 'stake', [parseEther('100')], 1);
    await advance(3600n);
    const before = await read(token, artifacts.token, 'balanceOf', [alice]);
    await write(spectraPool, artifacts.pool, 'withdraw', [parseEther('40')], 1);
    assert.equal(await read(token, artifacts.token, 'balanceOf', [alice]) - before, parseEther('40'));
    assert.equal(await read(spectraPool, artifacts.pool, 'balanceOf', [alice]), parseEther('60'));
    close(await read(spectraPool, artifacts.pool, 'earned', [alice]), rate * 3600n);
    await write(spectraPool, artifacts.pool, 'withdraw', [parseEther('60')], 1);
    assert.equal(await read(spectraPool, artifacts.pool, 'totalStaked'), 0n);
    close(await read(spectraPool, artifacts.pool, 'earned', [alice]), rate * 3600n);
    await write(spectraPool, artifacts.pool, 'claim', [], 1);
    assert.equal(await read(spectraPool, artifacts.pool, 'earned', [alice]), 0n);
  });

  await check('Empty-stake intervals emit nothing and do not extend the 180-day end time', async () => {
    await write(spectraPool, artifacts.pool, 'stake', [parseEther('100')], 1);
    const finish = await read(spectraPool, artifacts.pool, 'finishTime');
    await advance(3600n);
    await write(spectraPool, artifacts.pool, 'withdraw', [parseEther('100')], 1);
    const aliceReward = await read(spectraPool, artifacts.pool, 'earned', [alice]);
    await advance(7200n);
    await write(spectraPool, artifacts.pool, 'stake', [parseEther('100')], 2);
    assert.equal(await read(spectraPool, artifacts.pool, 'earned', [bob]), 0n);
    await advance(3600n);
    close(await read(spectraPool, artifacts.pool, 'earned', [bob]), rate * 3600n);
    assert.equal(await read(spectraPool, artifacts.pool, 'earned', [alice]), aliceReward);
    assert.equal(await read(spectraPool, artifacts.pool, 'finishTime'), finish);
    assert.equal(await read(spectraPool, artifacts.pool, 'outstandingRewards'), rate * 7200n);
  });

  await check('Same-token recovery protects every deposit and all earned claims after the deadline', async () => {
    const stake = parseEther('101');
    await write(spectraPool, artifacts.pool, 'stake', [stake], 1);
    await expectRevert(spectraPool, artifacts.pool, 'recoverUnusedRewards', [], 0, 'ProgramNotFinished');
    await advance(DURATION + 86400n);
    close(await read(spectraPool, artifacts.pool, 'earned', [alice]), rate * DURATION);
    await expectRevert(spectraPool, artifacts.pool, 'stake', [1n], 1, 'ProgramFinished');
    await expectRevert(spectraPool, artifacts.pool, 'recoverUnusedRewards', [], 1, 'TreasuryOnly');
    await write(spectraPool, artifacts.pool, 'recoverUnusedRewards');
    const debt = await read(spectraPool, artifacts.pool, 'outstandingRewards');
    assert.equal(await read(token, artifacts.token, 'balanceOf', [spectraPool]), stake + debt);
    assert.equal(await read(spectraPool, artifacts.pool, 'recoveredRewards'), BUDGET - rate * DURATION);
    assert.equal(await read(spectraPool, artifacts.pool, 'recoverableRewards'), 0n);
    await expectRevert(spectraPool, artifacts.pool, 'recoverUnusedRewards', [], 0, 'NothingToRecover');
    await advance(365n * 86400n);
    const before = await read(token, artifacts.token, 'balanceOf', [alice]);
    const earned = await read(spectraPool, artifacts.pool, 'earned', [alice]);
    await write(spectraPool, artifacts.pool, 'exit', [], 1);
    assert.equal(await read(token, artifacts.token, 'balanceOf', [alice]) - before, stake + earned);
    assert.equal(await read(spectraPool, artifacts.pool, 'totalStaked'), 0n);
    assert.equal(await read(spectraPool, artifacts.pool, 'earned', [alice]), 0n);
  });

  await check('IMD recovery returns unused SPECTRA while leaving IMD principal and earned rewards intact', async () => {
    const stake = parseEther('500');
    await write(imdPool, artifacts.pool, 'stake', [stake], 1);
    await advance(DURATION / 2n);
    await write(imdPool, artifacts.pool, 'withdraw', [stake], 1);
    const claimable = await read(imdPool, artifacts.pool, 'earned', [alice]);
    await advance(DURATION / 2n - 100n);
    await write(imdPool, artifacts.pool, 'stake', [stake], 2);
    await advance(100n);
    const debt = await read(imdPool, artifacts.pool, 'outstandingRewards');
    const treasuryBefore = await read(token, artifacts.token, 'balanceOf', [treasury]);
    await write(imdPool, artifacts.pool, 'recoverUnusedRewards');
    assert.equal(await read(token, artifacts.token, 'balanceOf', [imdPool]), debt);
    assert.equal(await read(imd, fixtures.mockIMD, 'balanceOf', [imdPool]), stake);
    assert.equal(await read(token, artifacts.token, 'balanceOf', [treasury]) - treasuryBefore, BUDGET - debt);
    assert.equal(await read(imdPool, artifacts.pool, 'earned', [alice]), claimable);
    await write(imdPool, artifacts.pool, 'claim', [], 1);
    await write(imdPool, artifacts.pool, 'exit', [], 2);
    assert.equal(await read(imd, fixtures.mockIMD, 'balanceOf', [imdPool]), 0n);
    assert.equal(await read(imdPool, artifacts.pool, 'totalStaked'), 0n);
  });

  await check('Unfunded pools and invalid constructor inputs cannot accept deposits', async () => {
    await expectDeployRevert(artifacts.factory, [ZERO]);
    await expectDeployRevert(artifacts.factory, [treasury]);
    await expectDeployRevert(artifacts.token, [ZERO]);
    await expectDeployRevert(artifacts.pool, [ZERO, token, treasury, BUDGET]);
    await expectDeployRevert(artifacts.pool, [imd, ZERO, treasury, BUDGET]);
    await expectDeployRevert(artifacts.pool, [imd, token, ZERO, BUDGET]);
    await expectDeployRevert(artifacts.pool, [imd, token, treasury, DURATION - 1n]);
    const pool = await deploy(artifacts.pool, [imd, token, treasury, BUDGET]);
    await write(imd, fixtures.mockIMD, 'approve', [pool, parseEther('100')], 1);
    await expectRevert(pool, artifacts.pool, 'stake', [parseEther('100')], 1, 'InsufficientFunding');
    await write(token, artifacts.token, 'transfer', [pool, BUDGET / 2n]);
    await expectRevert(pool, artifacts.pool, 'stake', [parseEther('100')], 1, 'InsufficientFunding');
    assert.equal(await read(pool, artifacts.pool, 'startTime'), 0n);
    await write(token, artifacts.token, 'transfer', [pool, BUDGET / 2n]);
    await write(pool, artifacts.pool, 'stake', [parseEther('100')], 1);
    assert.equal(await read(pool, artifacts.pool, 'totalStaked'), parseEther('100'));
  });

  await check('Zero operations, unauthorized balances, missing approvals and empty exits are rejected', async () => {
    await expectRevert(spectraPool, artifacts.pool, 'stake', [0n], 1, 'ZeroAmount');
    await expectRevert(spectraPool, artifacts.pool, 'withdraw', [0n], 1, 'ZeroAmount');
    await expectRevert(spectraPool, artifacts.pool, 'withdraw', [1n], 1, 'InsufficientStake');
    await expectRevert(spectraPool, artifacts.pool, 'claim', [], 1, 'NothingToClaim');
    await expectRevert(spectraPool, artifacts.pool, 'exit', [], 1, 'NothingToExit');
    await expectRevert(spectraPool, artifacts.pool, 'stake', [1n], 0, 'ERC20InsufficientAllowance');
    await write(spectraPool, artifacts.pool, 'stake', [parseEther('100')], 1);
    await expectRevert(spectraPool, artifacts.pool, 'withdraw', [parseEther('101')], 1, 'InsufficientStake');
    await expectRevert(spectraPool, artifacts.pool, 'withdraw', [1n], 0, 'InsufficientStake');
    await expectRevert(spectraPool, artifacts.pool, 'withdraw', [1n], 2, 'InsufficientStake');
    assert.equal(await read(spectraPool, artifacts.pool, 'balanceOf', [alice]), parseEther('100'));
  });

  await check('Transfer-tax deposits revert atomically without starting a program or crediting phantom principal', async () => {
    const taxed = await deploy(fixtures.taxedToken);
    const pool = await deploy(artifacts.pool, [taxed, token, treasury, BUDGET]);
    await write(token, artifacts.token, 'transfer', [pool, BUDGET]);
    await write(taxed, fixtures.taxedToken, 'approve', [pool, parseEther('100')]);
    await expectRevert(pool, artifacts.pool, 'stake', [parseEther('100')], 0, 'UnsupportedTransferBehavior');
    const before = await read(taxed, fixtures.taxedToken, 'balanceOf', [treasury]);
    const hash = await wallets[0].writeContract({ address: pool, abi: artifacts.pool.abi, functionName: 'stake', args: [parseEther('100')], gas: 5_000_000n });
    assert.equal((await client.waitForTransactionReceipt({ hash })).status, 'reverted');
    assert.equal(await read(taxed, fixtures.taxedToken, 'balanceOf', [treasury]), before);
    assert.equal(await read(taxed, fixtures.taxedToken, 'balanceOf', [pool]), 0n);
    assert.equal(await read(pool, artifacts.pool, 'totalStaked'), 0n);
    assert.equal(await read(pool, artifacts.pool, 'startTime'), 0n);
    assert.equal(await read(token, artifacts.token, 'balanceOf', [pool]), BUDGET);
  });

  await check('Token callbacks cannot reenter staking accounting', async () => {
    const callback = await deploy(fixtures.reentrantToken);
    const pool = await deploy(artifacts.pool, [callback, token, treasury, BUDGET]);
    await write(token, artifacts.token, 'transfer', [pool, BUDGET]);
    await write(callback, fixtures.reentrantToken, 'setTarget', [pool]);
    await write(callback, fixtures.reentrantToken, 'approve', [pool, parseEther('100')]);
    await write(pool, artifacts.pool, 'stake', [parseEther('100')]);
    assert.equal(await read(callback, fixtures.reentrantToken, 'lastReentrySucceeded'), false);
    assert.equal(await read(callback, fixtures.reentrantToken, 'lastReentryErrorSelector'), toFunctionSelector('ReentrancyGuardReentrantCall()'));
    assert.equal(await read(pool, artifacts.pool, 'totalStaked'), parseEther('100'));
    await write(pool, artifacts.pool, 'withdraw', [parseEther('100')]);
    assert.equal(await read(pool, artifacts.pool, 'totalStaked'), 0n);
  });

  await check('Repeated deposits, withdrawals and claims preserve reward solvency in both pools', async () => {
    let randomState = 20261004;
    const random = (maximum) => {
      randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
      return randomState % maximum;
    };
    for (const pool of [spectraPool, imdPool]) {
      const sameToken = pool === spectraPool;
      for (let step = 0; step < 40; step += 1) {
        await advance(BigInt(random(86400) + 1));
        const sender = 1 + random(3);
        const balance = await read(pool, artifacts.pool, 'balanceOf', [accounts[sender]]);
        const action = random(3);
        if (action === 0 || balance === 0n) {
          await write(pool, artifacts.pool, 'stake', [parseEther(String(random(30) + 1))], sender);
        } else if (action === 1) {
          await write(pool, artifacts.pool, 'withdraw', [balance / 2n || balance], sender);
        } else if (await read(pool, artifacts.pool, 'earned', [accounts[sender]]) > 0n) {
          await write(pool, artifacts.pool, 'claim', [], sender);
        }
        const principal = await read(pool, artifacts.pool, 'totalStaked');
        const outstanding = await read(pool, artifacts.pool, 'outstandingRewards');
        const actual = await read(token, artifacts.token, 'balanceOf', [pool]);
        assert.ok(actual >= outstanding + (sameToken ? principal : 0n));
        let earnedTotal = 0n;
        let principalTotal = 0n;
        for (const account of [alice, bob, carol]) {
          earnedTotal += await read(pool, artifacts.pool, 'earned', [account]);
          principalTotal += await read(pool, artifacts.pool, 'balanceOf', [account]);
        }
        assert.ok(earnedTotal <= outstanding);
        assert.equal(principalTotal, principal);
        assert.ok(outstanding + await read(pool, artifacts.pool, 'claimedRewards') <= BUDGET);
      }
      await advance(DURATION);
      await write(pool, artifacts.pool, 'recoverUnusedRewards');
      for (const sender of [1, 2, 3]) {
        const balance = await read(pool, artifacts.pool, 'balanceOf', [accounts[sender]]);
        const reward = await read(pool, artifacts.pool, 'earned', [accounts[sender]]);
        if (balance !== 0n || reward !== 0n) await write(pool, artifacts.pool, 'exit', [], sender);
      }
      assert.equal(await read(pool, artifacts.pool, 'totalStaked'), 0n);
    }
    assert.equal(await read(token, artifacts.token, 'totalSupply'), parseEther('10000000'));
  });

  console.log(`All ${checks} contract test groups passed against the exact production ABI and bytecode. No public chain transactions were sent.`);
} finally {
  await provider.disconnect();
}
