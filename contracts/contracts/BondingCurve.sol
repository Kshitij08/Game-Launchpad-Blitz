// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {GameToken} from "./GameToken.sol";
import {TreasuryVault} from "./TreasuryVault.sol";
import {SessionManager} from "./SessionManager.sol";

/// @notice Buy-only linear bonding curve that opens once play-mining ends.
/// Every wei paid goes straight into the vault, and the price is never below
/// the current floor, so buying can only raise the floor. Selling = redeeming
/// from the vault at the floor price.
contract BondingCurve is ReentrancyGuard {
    GameToken public immutable token;
    TreasuryVault public immutable vault;
    SessionManager public immutable sessions;
    uint256 public immutable basePrice; // wei per whole token at sold = 0
    uint256 public immutable slope; // wei added to the price per whole token sold
    uint256 public constant FLOOR_PREMIUM_BPS = 1_000; // buyers pay at least floor + 10%, so every buy lifts the floor

    uint256 public sold; // token units minted through the curve

    event Bought(address indexed buyer, uint256 amount, uint256 cost, uint256 newPrice, uint256 newFloor);

    error MiningStillOpen();
    error ZeroAmount();
    error NotEnoughValue(uint256 cost);
    error TransferFailed();

    constructor(GameToken token_, TreasuryVault vault_, SessionManager sessions_, uint256 basePrice_, uint256 slope_) {
        token = token_;
        vault = vault_;
        sessions = sessions_;
        basePrice = basePrice_;
        slope = slope_;
    }

    function isOpen() public view returns (bool) {
        return sessions.miningClosed();
    }

    /// Spot price on the curve itself (wei per whole token).
    function curvePrice() public view returns (uint256) {
        return basePrice + (slope * sold) / 1e18;
    }

    /// Price a buyer pays for the next token: curve price, but never below floor + 10%.
    function spotPrice() external view returns (uint256) {
        uint256 c = curvePrice();
        uint256 f = (vault.floorPrice() * (10_000 + FLOOR_PREMIUM_BPS)) / 10_000;
        return c > f ? c : f;
    }

    /// Cost in wei to buy `amount` token units right now.
    function quoteBuy(uint256 amount) public view returns (uint256) {
        uint256 s = sold;
        uint256 curveCost = (basePrice * amount) / 1e18 + (slope * ((s + amount) * (s + amount) - s * s)) / 2e36;
        uint256 floorCost = (vault.floorPrice() * amount * (10_000 + FLOOR_PREMIUM_BPS)) / 1e18 / 10_000;
        uint256 cost = curveCost > floorCost ? curveCost : floorCost;
        return cost + 1; // round up so the floor never drops from rounding
    }

    function buy(uint256 amount) external payable nonReentrant {
        if (!isOpen()) revert MiningStillOpen();
        if (amount == 0) revert ZeroAmount();
        uint256 cost = quoteBuy(amount);
        if (msg.value < cost) revert NotEnoughValue(cost);

        sold += amount;
        (bool ok, ) = payable(address(vault)).call{value: cost}("");
        if (!ok) revert TransferFailed();
        token.mint(msg.sender, amount);

        uint256 refund = msg.value - cost;
        if (refund > 0) {
            (ok, ) = payable(msg.sender).call{value: refund}("");
            if (!ok) revert TransferFailed();
        }
        emit Bought(msg.sender, amount, cost, curvePrice(), vault.floorPrice());
    }
}
