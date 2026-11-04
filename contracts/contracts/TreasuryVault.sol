// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {GameToken} from "./GameToken.sol";

/// @notice Holds the MON that backs a game's token. Play fees and every curve
/// buy land here. Any holder can burn tokens for their pro-rata share, so the
/// token's floor price is always vault balance / total supply.
contract TreasuryVault is ReentrancyGuard {
    GameToken public immutable token;

    event Deposited(address indexed from, uint256 amount, uint256 newBalance);
    event Redeemed(address indexed holder, uint256 tokens, uint256 payout, uint256 newFloor);

    error ZeroAmount();
    error NoSupply();
    error TransferFailed();

    constructor(GameToken token_) {
        token = token_;
    }

    receive() external payable {
        emit Deposited(msg.sender, msg.value, address(this).balance);
    }

    /// @notice MON per whole token (18 decimals), i.e. wei paid per 1e18 token units.
    function floorPrice() public view returns (uint256) {
        uint256 supply = token.totalSupply();
        if (supply == 0) return 0;
        return (address(this).balance * 1e18) / supply;
    }

    function previewRedeem(uint256 amount) public view returns (uint256) {
        uint256 supply = token.totalSupply();
        if (supply == 0) return 0;
        return (address(this).balance * amount) / supply;
    }

    function redeem(uint256 amount) external nonReentrant returns (uint256 payout) {
        if (amount == 0) revert ZeroAmount();
        if (token.totalSupply() == 0) revert NoSupply();
        payout = previewRedeem(amount);
        token.burnFor(msg.sender, amount);
        (bool ok, ) = msg.sender.call{value: payout}("");
        if (!ok) revert TransferFailed();
        emit Redeemed(msg.sender, amount, payout, floorPrice());
    }
}
