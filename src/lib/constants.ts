import { createPublicClient, fallback, http, parseAbi } from 'viem';
import { mainnet } from 'viem/chains';

export const IMD_ADDRESS = '0xD34a99Bc0f67aE1bbd63C660e6d0b0dd03E263B7' as const;
export const RADAR_ENDPOINT = 'https://imd-communitycoins-indexer.up.railway.app/graphql';
export const UNIT = 10n ** 18n;
export const TOKEN_SUPPLY = 10_000_000n * UNIT;
export const POOL_REWARD_BUDGET = 1_000_000n * UNIT;
export const PROGRAM_DURATION = 180n * 24n * 60n * 60n;
export const publicClient = createPublicClient({
  chain: mainnet,
  transport: fallback([
    http('https://ethereum.publicnode.com', { timeout: 15_000, retryCount: 1 }),
    http('https://cloudflare-eth.com', { timeout: 15_000, retryCount: 1 }),
  ], { rank: false }),
});

export const tokenAbi = parseAbi([
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
  'event Approval(address indexed owner,address indexed spender,uint256 value)',
]);

export const factoryAbi = parseAbi([
  'function treasury() view returns (address)',
  'function imdToken() view returns (address)',
  'function token() view returns (address)',
  'function spectraPool() view returns (address)',
  'function imdPool() view returns (address)',
  'function POOL_REWARDS() view returns (uint256)',
  'function TREASURY_ALLOCATION() view returns (uint256)',
  'event ProjectCreated(address indexed treasury,address indexed token,address spectraPool,address imdPool,address imdToken)',
]);

export const poolAbi = parseAbi([
  'function stakingToken() view returns (address)',
  'function rewardsToken() view returns (address)',
  'function treasury() view returns (address)',
  'function rewardBudget() view returns (uint256)',
  'function rewardRate() view returns (uint256)',
  'function DURATION() view returns (uint256)',
  'function totalStaked() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function earned(address) view returns (uint256)',
  'function startTime() view returns (uint256)',
  'function finishTime() view returns (uint256)',
  'function emittedRewards() view returns (uint256)',
  'function claimedRewards() view returns (uint256)',
  'function recoveredRewards() view returns (uint256)',
  'function outstandingRewards() view returns (uint256)',
  'function stake(uint256)',
  'function withdraw(uint256)',
  'function claim()',
  'function exit()',
  'event Staked(address indexed account,uint256 amount)',
  'event Withdrawn(address indexed account,uint256 amount)',
  'event RewardPaid(address indexed account,uint256 amount)',
  'error ZeroAmount()',
  'error ProgramFinished()',
  'error InsufficientFunding()',
  'error UnsupportedTransferBehavior()',
  'error InsufficientStake()',
  'error NothingToClaim()',
  'error NothingToExit()',
]);
