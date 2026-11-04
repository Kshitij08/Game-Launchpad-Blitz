// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {GameToken} from "./GameToken.sol";

/// @notice Paid play sessions for one game.
/// - startSession: player pays the entry fee, split between the vault, the
///   creator and (for remixes) the parent game's vault.
/// - endSession: backend-signed score. During the mining phase this mints
///   tokens to the player (idea #1: play-mined fair launch).
/// - Creator allocation unlocks in tranches as unique players arrive (idea #3).
contract SessionManager is EIP712, ReentrancyGuard {
    struct Params {
        uint256 entryFee; // wei per session
        uint16 vaultBps; // share of fee to this game's vault
        uint16 parentBps; // share of fee to parent vault (remixes), 0 if none
        // creator gets the rest
        uint256 baseReward; // tokens minted per finished session while mining
        uint256 rewardPerPoint; // extra tokens per score point while mining
        uint256 walletMiningCap; // max tokens one wallet can mine
        uint256 miningSupplyCap; // mining closes when this much has been mined
        uint256 creatorAllocation; // total creator tokens, unlocked by milestones
    }

    struct Session {
        address player;
        uint64 startedAt;
        bool ended;
        uint256 score;
    }

    bytes32 public constant SESSION_TYPEHASH =
        keccak256("SessionResult(address player,uint256 sessionId,uint256 score)");

    GameToken public immutable token;
    address payable public immutable vault;
    address payable public immutable parentVault;
    address payable public immutable creator;
    address public immutable signer;
    address public immutable factory;

    Params public params;

    uint256 public sessionCount;
    uint256 public finishedSessions;
    uint256 public uniquePlayers;
    uint256 public totalMined;
    uint256 public bestScore;
    address public bestPlayer;
    bool public miningClosed;
    uint256 public creatorClaimed;

    mapping(uint256 => Session) public sessions;
    mapping(address => bool) public hasPlayed;
    mapping(address => uint256) public minedBy;

    /// Unique-player milestones; each unlocks 25% of the creator allocation.
    uint256[4] public milestones = [uint256(3), 10, 25, 50];

    event SessionStarted(uint256 indexed sessionId, address indexed player, uint256 fee);
    event SessionEnded(uint256 indexed sessionId, address indexed player, uint256 score, uint256 mined);
    event MiningClosed(uint256 totalMined, uint256 finishedSessions);
    event CreatorClaimed(uint256 amount, uint256 totalClaimed);

    error WrongFee();
    error NotYourSession();
    error AlreadyEnded();
    error BadSignature();
    error NotCreator();
    error NothingToClaim();
    error TransferFailed();

    constructor(
        GameToken token_,
        address payable vault_,
        address payable parentVault_,
        address payable creator_,
        address signer_,
        Params memory params_
    ) EIP712("ProofOfPlay", "1") {
        token = token_;
        vault = vault_;
        parentVault = parentVault_;
        creator = creator_;
        signer = signer_;
        factory = msg.sender;
        params = params_;
        if (parentVault_ == address(0)) params.parentBps = 0;
    }

    // ---------------------------------------------------------------- play

    function startSession() external payable nonReentrant returns (uint256 sessionId) {
        Params memory p = params;
        if (msg.value != p.entryFee) revert WrongFee();
        sessionId = ++sessionCount;
        sessions[sessionId] = Session({player: msg.sender, startedAt: uint64(block.timestamp), ended: false, score: 0});

        uint256 toVault = (msg.value * p.vaultBps) / 10_000;
        uint256 toParent = (msg.value * p.parentBps) / 10_000;
        uint256 toCreator = msg.value - toVault - toParent;
        _send(vault, toVault);
        if (toParent > 0) _send(parentVault, toParent);
        _send(creator, toCreator);

        emit SessionStarted(sessionId, msg.sender, msg.value);
    }

    function sessionDigest(address player, uint256 sessionId, uint256 score) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(SESSION_TYPEHASH, player, sessionId, score)));
    }

    function endSession(uint256 sessionId, uint256 score, bytes calldata signature) external nonReentrant {
        Session storage s = sessions[sessionId];
        if (s.player != msg.sender) revert NotYourSession();
        if (s.ended) revert AlreadyEnded();
        if (ECDSA.recover(sessionDigest(msg.sender, sessionId, score), signature) != signer) revert BadSignature();

        s.ended = true;
        s.score = score;
        finishedSessions++;
        if (!hasPlayed[msg.sender]) {
            hasPlayed[msg.sender] = true;
            uniquePlayers++;
        }
        if (score > bestScore) {
            bestScore = score;
            bestPlayer = msg.sender;
        }

        uint256 mined = 0;
        if (!miningClosed) {
            Params memory p = params;
            mined = p.baseReward + score * p.rewardPerPoint;
            uint256 walletRoom = p.walletMiningCap - minedBy[msg.sender];
            if (mined > walletRoom) mined = walletRoom;
            uint256 supplyRoom = p.miningSupplyCap - totalMined;
            if (mined > supplyRoom) mined = supplyRoom;
            if (mined > 0) {
                minedBy[msg.sender] += mined;
                totalMined += mined;
                token.mint(msg.sender, mined);
            }
            if (totalMined >= p.miningSupplyCap) _closeMining();
        }

        emit SessionEnded(sessionId, msg.sender, score, mined);
    }

    // ------------------------------------------------------------- creator

    /// Lets the creator end the mining phase early (useful for live demos).
    function closeMining() external {
        if (msg.sender != creator) revert NotCreator();
        if (!miningClosed) _closeMining();
    }

    function creatorUnlocked() public view returns (uint256) {
        uint256 tranches = 0;
        for (uint256 i = 0; i < milestones.length; i++) {
            if (uniquePlayers >= milestones[i]) tranches++;
        }
        return (params.creatorAllocation * tranches) / milestones.length;
    }

    function claimCreator() external {
        if (msg.sender != creator) revert NotCreator();
        uint256 amount = creatorUnlocked() - creatorClaimed;
        if (amount == 0) revert NothingToClaim();
        creatorClaimed += amount;
        token.mint(creator, amount);
        emit CreatorClaimed(amount, creatorClaimed);
    }

    // ---------------------------------------------------------------- view

    function getMilestones() external view returns (uint256[4] memory) {
        return milestones;
    }

    // ------------------------------------------------------------ internal

    function _closeMining() internal {
        miningClosed = true;
        emit MiningClosed(totalMined, finishedSessions);
    }

    function _send(address payable to, uint256 amount) internal {
        if (amount == 0) return;
        (bool ok, ) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
