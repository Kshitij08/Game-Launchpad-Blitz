// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {GameToken} from "./GameToken.sol";
import {TreasuryVault} from "./TreasuryVault.sol";
import {SessionManager} from "./SessionManager.sol";
import {BondingCurve} from "./BondingCurve.sol";

/// @notice Launches a game: deploys its token, vault, session manager and
/// curve in one transaction and records it in the registry.
contract GameFactory {
    struct Game {
        uint256 id;
        address creator;
        GameToken token;
        TreasuryVault vault;
        SessionManager sessions;
        BondingCurve curve;
        uint256 parentId; // 0 = original game, otherwise the game it remixes
        bytes32 configHash; // keccak256 of the game config JSON (stored off-chain)
        uint64 createdAt;
    }

    address public owner;
    address public signer; // backend wallet that signs session scores

    SessionManager.Params public defaultParams;
    uint256 public defaultBasePrice;
    uint256 public defaultSlope;

    Game[] internal games; // index = id - 1
    mapping(address => uint256) public gameIdBySessions;

    event GameCreated(
        uint256 indexed id,
        address indexed creator,
        uint256 indexed parentId,
        address token,
        address vault,
        address sessions,
        address curve,
        bytes32 configHash,
        string name,
        string symbol
    );

    error NotOwner();
    error BadParent();

    constructor(address signer_) {
        owner = msg.sender;
        signer = signer_;
        defaultParams = SessionManager.Params({
            entryFee: 0.02 ether,
            vaultBps: 7_000, // 70% to the vault
            parentBps: 1_000, // 10% to the parent's vault on remixes (else to the creator's escrow)
            launchPrice: 0.0001 ether, // mining price before supply exists: a full-skill first run mines 140 coins
            targetScore: 40, // score 40+ earns the run's full mining budget
            minShareBps: 2_500, // score 0 still earns 25% of it
            walletMiningCap: 500 ether,
            miningSupplyCap: 10_000 ether,
            miningRunCap: 300 // mining closes after 300 runs if the supply cap isn't hit first
        });
        defaultBasePrice = 0.0005 ether; // curve start, wei per whole token
        defaultSlope = 0.0000001 ether; // price +0.0001 MON per 1,000 tokens sold
    }

    function createGame(string calldata name, string calldata symbol, bytes32 configHash, uint256 parentId)
        external
        returns (uint256 id)
    {
        if (parentId > games.length) revert BadParent();
        address payable parentVault = parentId == 0 ? payable(address(0)) : payable(address(games[parentId - 1].vault));

        GameToken token = new GameToken(name, symbol);
        TreasuryVault vault = new TreasuryVault(token);
        SessionManager sessions =
            new SessionManager(token, payable(address(vault)), parentVault, payable(msg.sender), signer, defaultParams);
        BondingCurve curve = new BondingCurve(token, vault, sessions, defaultBasePrice, defaultSlope);

        token.setRoles(address(sessions), true, false);
        token.setRoles(address(curve), true, false);
        token.setRoles(address(vault), false, true);

        id = games.length + 1;
        games.push(
            Game({
                id: id,
                creator: msg.sender,
                token: token,
                vault: vault,
                sessions: sessions,
                curve: curve,
                parentId: parentId,
                configHash: configHash,
                createdAt: uint64(block.timestamp)
            })
        );
        gameIdBySessions[address(sessions)] = id;

        emit GameCreated(
            id, msg.sender, parentId, address(token), address(vault), address(sessions), address(curve), configHash, name, symbol
        );
    }

    // ---------------------------------------------------------------- views

    function gameCount() external view returns (uint256) {
        return games.length;
    }

    function getGame(uint256 id) external view returns (Game memory) {
        return games[id - 1];
    }

    /// Newest first, `limit` games starting `offset` from the newest.
    function listGames(uint256 offset, uint256 limit) external view returns (Game[] memory out) {
        uint256 n = games.length;
        if (offset >= n) return new Game[](0);
        uint256 count = n - offset < limit ? n - offset : limit;
        out = new Game[](count);
        for (uint256 i = 0; i < count; i++) {
            out[i] = games[n - 1 - offset - i];
        }
    }

    // ---------------------------------------------------------------- admin

    function setSigner(address signer_) external {
        if (msg.sender != owner) revert NotOwner();
        signer = signer_;
    }

    function setDefaults(SessionManager.Params calldata p, uint256 basePrice, uint256 slope) external {
        if (msg.sender != owner) revert NotOwner();
        defaultParams = p;
        defaultBasePrice = basePrice;
        defaultSlope = slope;
    }
}
