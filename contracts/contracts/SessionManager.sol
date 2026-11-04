// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {GameToken} from "./GameToken.sol";
import {TreasuryVault} from "./TreasuryVault.sol";

/// @notice Paid play sessions for one game (v2).
/// - startSession: the player pays the entry fee. The vault share goes into the
///   vault now; the parent game's share (remixes) goes to its vault; the
///   creator's share is held in escrow here.
/// - endSession: backend-signed score. While mining is open, the run mints
///   coins from a budget worth exactly its vault deposit at the current floor
///   (or the launch price before any coins exist). The score decides the share
///   of that budget: `minShareBps` at score 0, 100% at `targetScore` or more.
///   So a run can never lower the floor; weaker runs raise it.
/// - Creator earnings unlock 25% at each unique-player milestone (idea #3),
///   paid in MON, so creators never dilute holders.
contract SessionManager is EIP712, ReentrancyGuard {
    struct Params {
        uint256 entryFee; // wei per session
        uint16 vaultBps; // share of fee to this game's vault
        uint16 parentBps; // share of fee to parent vault (remixes), 0 if none; creator escrow gets the rest
        uint256 launchPrice; // wei per whole token used to price mining before any supply exists
        uint256 targetScore; // score that earns the full mining budget
        uint16 minShareBps; // share of the budget a score of 0 still earns
        uint256 walletMiningCap; // max tokens one wallet can mine
        uint256 miningSupplyCap; // mining closes when this much has been mined
        uint256 miningRunCap; // ...or after this many finished runs
    }

    struct Session {
        address player;
        uint64 startedAt;
        bool ended;
        uint256 score;
        uint256 deposit; // wei this session put into the vault
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
    uint256 public creatorEarned; // MON held in escrow for the creator
    uint256 public creatorClaimed; // MON already paid out

    mapping(uint256 => Session) public sessions;
    mapping(address => bool) public hasPlayed;
    mapping(address => uint256) public minedBy;

    /// Unique-player milestones; each unlocks 25% of the creator's escrowed earnings.
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

        uint256 toVault = (msg.value * p.vaultBps) / 10_000;
        uint256 toParent = (msg.value * p.parentBps) / 10_000;
        creatorEarned += msg.value - toVault - toParent;

        sessions[sessionId] =
            Session({player: msg.sender, startedAt: uint64(block.timestamp), ended: false, score: 0, deposit: toVault});
        _send(vault, toVault);
        if (toParent > 0) _send(parentVault, toParent);

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
            mined = previewMined(s.deposit, score);
            uint256 walletRoom = p.walletMiningCap - minedBy[msg.sender];
            if (mined > walletRoom) mined = walletRoom;
            uint256 supplyRoom = p.miningSupplyCap - totalMined;
            if (mined > supplyRoom) mined = supplyRoom;
            if (mined > 0) {
                minedBy[msg.sender] += mined;
                totalMined += mined;
                token.mint(msg.sender, mined);
            }
            if (totalMined >= p.miningSupplyCap || finishedSessions >= p.miningRunCap) _closeMining();
        }

        emit SessionEnded(sessionId, msg.sender, score, mined);
    }

    /// Coins a run with this vault deposit and score would mine right now (before wallet/supply caps).
    /// Budget = deposit / max(floor, launchPrice): minting the full budget keeps the floor where it was.
    function previewMined(uint256 deposit, uint256 score) public view returns (uint256) {
        Params memory p = params;
        uint256 price = TreasuryVault(vault).floorPrice();
        if (price < p.launchPrice) price = p.launchPrice;
        uint256 budget = (deposit * 1e18) / price;
        uint256 skill = score >= p.targetScore ? p.targetScore : score;
        uint256 shareBps = p.minShareBps + ((10_000 - uint256(p.minShareBps)) * skill) / p.targetScore;
        return (budget * shareBps) / 10_000;
    }

    // ------------------------------------------------------------- creator

    /// Lets the creator end the mining phase early (useful for live demos).
    function closeMining() external {
        if (msg.sender != creator) revert NotCreator();
        if (!miningClosed) _closeMining();
    }

    /// MON of the creator's escrow unlocked so far (25% per milestone reached).
    function creatorUnlocked() public view returns (uint256) {
        uint256 tranches = 0;
        for (uint256 i = 0; i < milestones.length; i++) {
            if (uniquePlayers >= milestones[i]) tranches++;
        }
        return (creatorEarned * tranches) / milestones.length;
    }

    function claimCreator() external nonReentrant {
        if (msg.sender != creator) revert NotCreator();
        uint256 unlocked = creatorUnlocked();
        if (unlocked <= creatorClaimed) revert NothingToClaim();
        uint256 amount = unlocked - creatorClaimed;
        creatorClaimed = unlocked;
        _send(creator, amount);
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
