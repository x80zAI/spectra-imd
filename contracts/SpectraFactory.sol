// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {SpectraToken} from "./SpectraToken.sol";
import {SpectraStaking} from "./SpectraStaking.sol";

/// @notice Deploys the fixed-supply token and both fully funded programs in one transaction.
contract SpectraFactory {
    using SafeERC20 for IERC20;

    uint256 public constant POOL_REWARDS = 1_000_000 ether;
    uint256 public constant TREASURY_ALLOCATION = 8_000_000 ether;

    address public immutable treasury;
    address public immutable imdToken;
    SpectraToken public immutable token;
    SpectraStaking public immutable spectraPool;
    SpectraStaking public immutable imdPool;

    error InvalidImdToken();

    event ProjectCreated(
        address indexed treasury,
        address indexed token,
        address spectraPool,
        address imdPool,
        address imdToken
    );

    constructor(address imdTokenAddress) {
        if (imdTokenAddress.code.length == 0) revert InvalidImdToken();
        treasury = msg.sender;
        imdToken = imdTokenAddress;
        token = new SpectraToken(address(this));
        spectraPool = new SpectraStaking(address(token), address(token), msg.sender, POOL_REWARDS);
        imdPool = new SpectraStaking(imdTokenAddress, address(token), msg.sender, POOL_REWARDS);

        IERC20(address(token)).safeTransfer(address(spectraPool), POOL_REWARDS);
        IERC20(address(token)).safeTransfer(address(imdPool), POOL_REWARDS);
        IERC20(address(token)).safeTransfer(msg.sender, TREASURY_ALLOCATION);

        emit ProjectCreated(msg.sender, address(token), address(spectraPool), address(imdPool), imdTokenAddress);
    }
}
