// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Local automated tests only. This contract is excluded from the website artifacts.
contract MockIMD is ERC20 {
    constructor() ERC20("Local IMD test token", "IMD") {
        _mint(msg.sender, 100_000_000 ether);
    }
}

/// @dev Proves that transfer-tax deposits cannot silently dilute principal accounting.
contract TaxedToken is ERC20 {
    constructor() ERC20("Local transfer-tax test token", "TAX") {
        _mint(msg.sender, 100_000_000 ether);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            uint256 fee = value / 100;
            super._update(from, address(0), fee);
            super._update(from, to, value - fee);
        } else {
            super._update(from, to, value);
        }
    }
}

/// @dev Attempts a callback during a deposit and records the exact rejection.
contract ReentrantToken is ERC20 {
    address public target;
    bool public lastReentrySucceeded;
    bytes4 public lastReentryErrorSelector;

    constructor() ERC20("Local callback test token", "CALL") {
        _mint(msg.sender, 100_000_000 ether);
    }

    function setTarget(address newTarget) external {
        target = newTarget;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (from != address(0) && to == target && target != address(0)) {
            (bool succeeded, bytes memory result) = target.call(abi.encodeWithSignature("exit()"));
            lastReentrySucceeded = succeeded;
            if (result.length >= 4) {
                bytes4 selector;
                assembly { selector := mload(add(result, 32)) }
                lastReentryErrorSelector = selector;
            }
        }
    }
}
