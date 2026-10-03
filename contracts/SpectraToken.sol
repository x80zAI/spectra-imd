// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice A fixed-supply token. There are no privileged roles or later minting methods.
contract SpectraToken is ERC20 {
    uint256 public constant INITIAL_SUPPLY = 10_000_000 ether;

    error InvalidRecipient();

    constructor(address recipient) ERC20("Spectra IMD", "SPECTRA") {
        if (recipient == address(0)) revert InvalidRecipient();
        _mint(recipient, INITIAL_SUPPLY);
    }
}
