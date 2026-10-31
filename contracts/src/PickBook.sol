// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title PickBook
/// @notice Paper-mode entries for Beat the Bot. A player locks three stocks and their weights for a week.
///         No money ever moves through this contract.
/// @dev The week's token list is fixed once the entry window opens, so a lock can never be reinterpreted.
///      `lockFor` lets a relayer submit an EIP-712 signed lock (the gas-sponsorship fallback); it accepts
///      EOA signatures, ERC-1271 smart-account signatures and ERC-6492 signatures from accounts that are
///      not deployed yet.
contract PickBook {
    struct Pick {
        uint8 tokenIndex;
        uint16 weightBps;
    }

    struct Week {
        uint64 openAt;
        uint64 closeAt;
        address[] tokens;
    }

    uint16 public constant TOTAL_BPS = 10_000;
    uint256 public constant MAX_TOKENS = 64;

    bytes32 public constant LOCK_TYPEHASH =
        keccak256("Lock(address player,uint32 weekId,bytes32 picksHash,uint256 nonce,uint256 deadline)");
    bytes32 private constant _DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant _NAME_HASH = keccak256("Beat the Bot PickBook");
    bytes32 private constant _VERSION_HASH = keccak256("1");
    bytes32 private constant _ERC6492_MAGIC = 0x6492649264926492649264926492649264926492649264926492649264926492;
    bytes4 private constant _ERC1271_MAGIC = 0x1626ba7e;

    address public owner;
    address public pendingOwner;
    bool public paused;

    mapping(uint32 weekId => Week) private _weeks;
    /// @notice keccak256(abi.encode(Pick[3])) of each player's current lock.
    mapping(uint32 weekId => mapping(address player => bytes32)) public pickHash;
    /// @notice Time of each player's latest lock; ties are broken in favour of the earlier lock.
    mapping(uint32 weekId => mapping(address player => uint64)) public lockedAt;
    mapping(uint32 weekId => uint256) public entrants;
    mapping(address player => uint256) public nonces;

    event WeekSet(uint32 indexed weekId, uint64 openAt, uint64 closeAt, address[] tokens);
    event Locked(
        uint32 indexed weekId,
        address indexed player,
        uint8[3] tokenIndexes,
        uint16[3] weightsBps,
        bytes32 picksHash,
        bool overwrite
    );
    event PausedSet(bool paused);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error NotOwner();
    error NotPendingOwner();
    error ZeroAddress();
    error IsPaused();
    error BadWeek();
    error BadWindow();
    error BadTokenCount();
    error DuplicateToken();
    error WeekStarted();
    error WeekNotSet();
    error EntryNotOpen();
    error EntryClosed();
    error BadToken();
    error BadWeights();
    error SignatureExpired();
    error BadSignature();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address initialOwner) {
        if (initialOwner == address(0)) revert ZeroAddress();
        owner = initialOwner;
        emit OwnershipTransferred(address(0), initialOwner);
    }

    // ------------------------------------------------------------------ owner

    /// @notice Sets a week's entry window and its token universe. A week cannot change once it has opened.
    function setWeek(uint32 weekId, uint64 openAt, uint64 closeAt, address[] calldata tokens) external onlyOwner {
        if (weekId == 0) revert BadWeek();
        if (openAt >= closeAt || closeAt <= block.timestamp) revert BadWindow();
        uint256 n = tokens.length;
        if (n < 3 || n > MAX_TOKENS) revert BadTokenCount();
        Week storage w = _weeks[weekId];
        if (w.tokens.length != 0 && block.timestamp >= w.openAt) revert WeekStarted();
        for (uint256 i; i < n; ++i) {
            if (tokens[i] == address(0)) revert ZeroAddress();
            for (uint256 j; j < i; ++j) {
                if (tokens[j] == tokens[i]) revert DuplicateToken();
            }
        }
        w.openAt = openAt;
        w.closeAt = closeAt;
        w.tokens = tokens;
        emit WeekSet(weekId, openAt, closeAt, tokens);
    }

    function setPaused(bool paused_) external onlyOwner {
        paused = paused_;
        emit PausedSet(paused_);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotPendingOwner();
        emit OwnershipTransferred(owner, msg.sender);
        owner = msg.sender;
        pendingOwner = address(0);
    }

    // ---------------------------------------------------------------- players

    /// @notice Locks (or, before the window closes, replaces) the caller's three picks for `weekId`.
    function lock(uint32 weekId, Pick[3] calldata picks) external {
        _lock(msg.sender, weekId, picks);
    }

    /// @notice Submits a lock that `player` signed off-chain (EIP-712). Anyone may relay it.
    function lockFor(
        address player,
        uint32 weekId,
        Pick[3] calldata picks,
        uint256 deadline,
        bytes calldata signature
    ) external {
        if (block.timestamp > deadline) revert SignatureExpired();
        bytes32 digest = lockDigest(player, weekId, keccak256(abi.encode(picks)), nonces[player], deadline);
        if (!_isValidSignature(player, digest, signature)) revert BadSignature();
        _lock(player, weekId, picks);
    }

    // ------------------------------------------------------------------ views

    function getWeek(uint32 weekId) external view returns (uint64 openAt, uint64 closeAt, address[] memory tokens) {
        Week storage w = _weeks[weekId];
        return (w.openAt, w.closeAt, w.tokens);
    }

    function isOpen(uint32 weekId) external view returns (bool) {
        Week storage w = _weeks[weekId];
        return !paused && w.tokens.length != 0 && block.timestamp >= w.openAt && block.timestamp < w.closeAt;
    }

    function hashPicks(Pick[3] calldata picks) external pure returns (bytes32) {
        return keccak256(abi.encode(picks));
    }

    function domainSeparator() public view returns (bytes32) {
        return keccak256(abi.encode(_DOMAIN_TYPEHASH, _NAME_HASH, _VERSION_HASH, block.chainid, address(this)));
    }

    function lockDigest(address player, uint32 weekId, bytes32 picksHash, uint256 nonce, uint256 deadline)
        public
        view
        returns (bytes32)
    {
        bytes32 structHash = keccak256(abi.encode(LOCK_TYPEHASH, player, weekId, picksHash, nonce, deadline));
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(), structHash));
    }

    // --------------------------------------------------------------- internal

    function _lock(address player, uint32 weekId, Pick[3] calldata picks) internal {
        if (paused) revert IsPaused();
        Week storage w = _weeks[weekId];
        uint256 n = w.tokens.length;
        if (n == 0) revert WeekNotSet();
        if (block.timestamp < w.openAt) revert EntryNotOpen();
        if (block.timestamp >= w.closeAt) revert EntryClosed();

        uint8[3] memory idx;
        uint16[3] memory wts;
        uint256 sum;
        for (uint256 i; i < 3; ++i) {
            uint8 t = picks[i].tokenIndex;
            uint16 bps = picks[i].weightBps;
            if (t >= n) revert BadToken();
            if (bps == 0) revert BadWeights();
            for (uint256 j; j < i; ++j) {
                if (idx[j] == t) revert DuplicateToken();
            }
            idx[i] = t;
            wts[i] = bps;
            sum += bps;
        }
        if (sum != TOTAL_BPS) revert BadWeights();

        bytes32 h = keccak256(abi.encode(picks));
        bool overwrite = pickHash[weekId][player] != bytes32(0);
        if (!overwrite) entrants[weekId] += 1;
        pickHash[weekId][player] = h;
        lockedAt[weekId][player] = uint64(block.timestamp);
        unchecked {
            nonces[player] += 1;
        }
        emit Locked(weekId, player, idx, wts, h, overwrite);
    }

    function _isValidSignature(address signer, bytes32 digest, bytes calldata signature) internal returns (bool) {
        // ERC-6492: signature from a smart account that is not deployed yet. Deploy it, then check ERC-1271.
        if (signature.length >= 32 && bytes32(signature[signature.length - 32:]) == _ERC6492_MAGIC) {
            (address factory, bytes memory factoryCalldata, bytes memory inner) =
                abi.decode(signature[:signature.length - 32], (address, bytes, bytes));
            if (signer.code.length == 0) {
                (bool deployed,) = factory.call(factoryCalldata);
                if (!deployed || signer.code.length == 0) return false;
            }
            return _isValid1271(signer, digest, inner);
        }
        if (signer.code.length > 0) return _isValid1271(signer, digest, signature);
        return _recover(digest, signature) == signer && signer != address(0);
    }

    function _isValid1271(address signer, bytes32 digest, bytes memory signature) internal view returns (bool) {
        (bool ok, bytes memory ret) =
            signer.staticcall(abi.encodeWithSelector(_ERC1271_MAGIC, digest, signature));
        return ok && ret.length >= 32 && abi.decode(ret, (bytes4)) == _ERC1271_MAGIC;
    }

    function _recover(bytes32 digest, bytes calldata sig) internal pure returns (address) {
        if (sig.length != 65) return address(0);
        bytes32 r = bytes32(sig[0:32]);
        bytes32 s = bytes32(sig[32:64]);
        uint8 v = uint8(sig[64]);
        // Reject malleable signatures (EIP-2).
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) return address(0);
        if (v != 27 && v != 28) return address(0);
        return ecrecover(digest, v, r, s);
    }
}
