// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice A single, prefunded, non-renewable staking program with unrestricted withdrawals.
/// @dev No administrator can withdraw deposits, alter emissions or take earned rewards.
contract SpectraStaking is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant DURATION = 180 days;
    uint256 public constant PRECISION = 1e27;

    IERC20 public immutable stakingToken;
    IERC20 public immutable rewardsToken;
    address public immutable treasury;
    uint256 public immutable rewardBudget;
    uint256 public immutable rewardRate;

    uint256 public totalStaked;
    uint256 public startTime;
    uint256 public finishTime;
    uint256 public lastUpdateTime;
    uint256 public rewardPerTokenStored;
    uint256 public emittedRewards;
    uint256 public claimedRewards;
    uint256 public recoveredRewards;

    mapping(address account => uint256) public balanceOf;
    mapping(address account => uint256) public userRewardPerTokenPaid;
    mapping(address account => uint256) public rewards;

    error InvalidConfiguration();
    error ZeroAmount();
    error ProgramFinished();
    error InsufficientFunding();
    error UnsupportedTransferBehavior();
    error InsufficientStake();
    error NothingToClaim();
    error NothingToExit();
    error TreasuryOnly();
    error ProgramNotFinished();
    error NothingToRecover();

    event ProgramStarted(uint256 startTime, uint256 finishTime);
    event Staked(address indexed account, uint256 amount);
    event Withdrawn(address indexed account, uint256 amount);
    event RewardPaid(address indexed account, uint256 amount);
    event UnusedRewardsRecovered(address indexed treasury, uint256 amount);

    constructor(address stakeToken, address rewardToken, address treasuryAddress, uint256 budget) {
        if (
            stakeToken.code.length == 0 || rewardToken.code.length == 0
                || treasuryAddress == address(0) || budget < DURATION
        ) revert InvalidConfiguration();
        stakingToken = IERC20(stakeToken);
        rewardsToken = IERC20(rewardToken);
        treasury = treasuryAddress;
        rewardBudget = budget;
        rewardRate = budget / DURATION;
    }

    function lastTimeRewardApplicable() public view returns (uint256) {
        if (startTime == 0) return 0;
        return block.timestamp < finishTime ? block.timestamp : finishTime;
    }

    function rewardPerToken() public view returns (uint256) {
        if (startTime == 0 || totalStaked == 0) return rewardPerTokenStored;
        uint256 newlyEmitted = (lastTimeRewardApplicable() - lastUpdateTime) * rewardRate;
        return rewardPerTokenStored + Math.mulDiv(newlyEmitted, PRECISION, totalStaked);
    }

    function earned(address account) public view returns (uint256) {
        return rewards[account]
            + Math.mulDiv(balanceOf[account], rewardPerToken() - userRewardPerTokenPaid[account], PRECISION);
    }

    /// @notice Includes emitted rounding dust, so recovery cannot take anyone's earned rewards.
    function outstandingRewards() public view returns (uint256) {
        uint256 emission = emittedRewards;
        if (startTime != 0 && totalStaked != 0) {
            emission += (lastTimeRewardApplicable() - lastUpdateTime) * rewardRate;
        }
        return emission - claimedRewards;
    }

    /// @notice Reserve that is not needed for principal or emitted rewards.
    /// @dev Recovery is nevertheless restricted until the 180-day program finishes.
    function recoverableRewards() public view returns (uint256) {
        uint256 protectedBalance = outstandingRewards();
        if (address(stakingToken) == address(rewardsToken)) protectedBalance += totalStaked;
        uint256 actualBalance = rewardsToken.balanceOf(address(this));
        return actualBalance > protectedBalance ? actualBalance - protectedBalance : 0;
    }

    function stake(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (startTime != 0 && block.timestamp >= finishTime) revert ProgramFinished();
        _update(msg.sender);

        if (startTime == 0) {
            if (rewardsToken.balanceOf(address(this)) < rewardBudget) revert InsufficientFunding();
            startTime = block.timestamp;
            finishTime = block.timestamp + DURATION;
            lastUpdateTime = block.timestamp;
            emit ProgramStarted(startTime, finishTime);
        }

        uint256 previousBalance = stakingToken.balanceOf(address(this));
        stakingToken.safeTransferFrom(msg.sender, address(this), amount);
        if (stakingToken.balanceOf(address(this)) - previousBalance != amount) {
            revert UnsupportedTransferBehavior();
        }
        totalStaked += amount;
        balanceOf[msg.sender] += amount;
        emit Staked(msg.sender, amount);
    }

    function withdraw(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (amount > balanceOf[msg.sender]) revert InsufficientStake();
        _update(msg.sender);
        totalStaked -= amount;
        balanceOf[msg.sender] -= amount;
        stakingToken.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    function claim() external nonReentrant {
        _update(msg.sender);
        uint256 reward = rewards[msg.sender];
        if (reward == 0) revert NothingToClaim();
        rewards[msg.sender] = 0;
        claimedRewards += reward;
        rewardsToken.safeTransfer(msg.sender, reward);
        emit RewardPaid(msg.sender, reward);
    }

    function exit() external nonReentrant {
        _update(msg.sender);
        uint256 principal = balanceOf[msg.sender];
        uint256 reward = rewards[msg.sender];
        if (principal == 0 && reward == 0) revert NothingToExit();

        totalStaked -= principal;
        balanceOf[msg.sender] = 0;
        rewards[msg.sender] = 0;
        claimedRewards += reward;

        if (principal != 0) {
            stakingToken.safeTransfer(msg.sender, principal);
            emit Withdrawn(msg.sender, principal);
        }
        if (reward != 0) {
            rewardsToken.safeTransfer(msg.sender, reward);
            emit RewardPaid(msg.sender, reward);
        }
    }

    /// @notice Only unused reserve may return to the fixed treasury, after the program ends.
    /// @dev Users retain their principal and their earned claims without an expiry date.
    function recoverUnusedRewards() external nonReentrant returns (uint256 amount) {
        if (msg.sender != treasury) revert TreasuryOnly();
        if (startTime == 0 || block.timestamp < finishTime) revert ProgramNotFinished();
        _update(address(0));
        amount = recoverableRewards();
        if (amount == 0) revert NothingToRecover();
        recoveredRewards += amount;
        rewardsToken.safeTransfer(treasury, amount);
        emit UnusedRewardsRecovered(treasury, amount);
    }

    function _update(address account) private {
        if (startTime != 0) {
            uint256 applicableTime = lastTimeRewardApplicable();
            uint256 newlyEmitted = (applicableTime - lastUpdateTime) * rewardRate;
            if (totalStaked != 0) {
                rewardPerTokenStored += Math.mulDiv(newlyEmitted, PRECISION, totalStaked);
                emittedRewards += newlyEmitted;
            }
            lastUpdateTime = applicableTime;
        }
        if (account != address(0)) {
            rewards[account] += Math.mulDiv(
                balanceOf[account], rewardPerTokenStored - userRewardPerTokenPaid[account], PRECISION
            );
            userRewardPerTokenPaid[account] = rewardPerTokenStored;
        }
    }
}
