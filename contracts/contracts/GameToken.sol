// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";

/// @notice One token per game. Only the game's own contracts can mint
/// (session manager for play-mining and creator vesting, curve for buys).
/// The vault can burn on redeem so redeeming takes one transaction.
contract GameToken is ERC20, ERC20Burnable {
    address public immutable admin; // the GameFactory that deployed this token
    mapping(address => bool) public isMinter;
    mapping(address => bool) public isBurner;

    error NotAdmin();
    error NotMinter();
    error NotBurner();

    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {
        admin = msg.sender;
    }

    function setRoles(address account, bool minter, bool burner) external {
        if (msg.sender != admin) revert NotAdmin();
        isMinter[account] = minter;
        isBurner[account] = burner;
    }

    function mint(address to, uint256 amount) external {
        if (!isMinter[msg.sender]) revert NotMinter();
        _mint(to, amount);
    }

    function burnFor(address from, uint256 amount) external {
        if (!isBurner[msg.sender]) revert NotBurner();
        _burn(from, amount);
    }
}
