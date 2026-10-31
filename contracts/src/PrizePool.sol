// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IERC20Like {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title PrizePool
/// @notice Holds only the sponsor's weekly prizes for Beat the Bot and pays them to the week's winners.
///         Players never deposit anything here. There is no pot, no entry fee and no stake.
/// @dev Three keys: `owner` manages roles and pause, `resolver` settles results, `sponsor` funds prizes.
///      A week's dates come from `genesis` (Monday 00:00 UTC of week 1), so the refund rule needs no input.
///      Invariant, per token: balanceOf(pool) == totalUnsettled[token] + totalOwed[token] (plus any
///      unsolicited transfers, which only the owner can skim back to the sponsor).
contract PrizePool {
    uint256 public constant REFUND_DELAY = 7 days;
    /// @notice Settlement opens on Thursday 00:00 UTC of the week, which allows for early holiday closes.
    uint256 public constant SETTLE_OPENS_AFTER = 3 days;
    /// @notice Friday 21:00 UTC, the US close while US standard time applies (Nov-Mar). Only used to time refunds.
    uint256 public constant SCORED_OFFSET = 4 days + 21 hours;
    uint256 public constant MAX_WINNERS = 100;

    uint64 public immutable genesis;

    address public owner;
    address public pendingOwner;
    address public resolver;
    address public sponsor;
    bool public paused;

    uint256 private _lock = 1;

    /// @notice Unsettled prize money per week and token.
    mapping(uint32 weekId => mapping(address token => uint256)) public funded;
    /// @notice True once a week's prizes in `token` were settled or refunded.
    mapping(uint32 weekId => mapping(address token => bool)) public closed;
    mapping(uint32 weekId => mapping(address token => bytes32)) public resultsHash;
    mapping(address token => uint256) public totalUnsettled;
    mapping(address token => uint256) public totalOwed;
    /// @notice Payouts that could not be pushed (for example a transfer policy said no); claim with `withdraw`.
    mapping(address token => mapping(address account => uint256)) public owed;

    event Funded(uint32 indexed weekId, address indexed token, address indexed from, uint256 amount);
    event Settled(
        uint32 indexed weekId,
        address indexed token,
        bytes32 resultsHash,
        uint256 paidOrOwed,
        uint256 returnedToSponsor,
        uint256 winners
    );
    event Paid(uint32 indexed weekId, address indexed token, address indexed to, uint256 amount);
    event PayoutDeferred(uint32 indexed weekId, address indexed token, address indexed to, uint256 amount);
    event Withdrawn(address indexed token, address indexed account, address to, uint256 amount);
    event Refunded(uint32 indexed weekId, address indexed token, address indexed to, uint256 amount);
    event Skimmed(address indexed token, address indexed to, uint256 amount);
    event ResolverSet(address indexed resolver);
    event SponsorSet(address indexed sponsor);
    event PausedSet(bool paused);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error NotOwner();
    error NotPendingOwner();
    error NotResolver();
    error NotSponsor();
    error ZeroAddress();
    error ZeroAmount();
    error BadGenesis();
    error BadWeek();
    error IsPaused();
    error NotAToken();
    error WeekClosed();
    error WeekExpired();
    error TooEarly();
    error LengthMismatch();
    error TooManyWinners();
    error OverFunded();
    error NothingToRefund();
    error NothingOwed();
    error TransferFailed();
    error Reentrancy();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier nonReentrant() {
        if (_lock != 1) revert Reentrancy();
        _lock = 2;
        _;
        _lock = 1;
    }

    constructor(address owner_, address resolver_, address sponsor_, uint64 genesis_) {
        if (owner_ == address(0) || resolver_ == address(0) || sponsor_ == address(0)) revert ZeroAddress();
        // Unix time 0 was a Thursday, so Monday 00:00 UTC is 4 days into each 7-day cycle.
        if (genesis_ % 1 weeks != 4 days) revert BadGenesis();
        owner = owner_;
        resolver = resolver_;
        sponsor = sponsor_;
        genesis = genesis_;
        emit OwnershipTransferred(address(0), owner_);
        emit ResolverSet(resolver_);
        emit SponsorSet(sponsor_);
    }

    // ------------------------------------------------------------------ times

    function weekStart(uint32 weekId) public view returns (uint256) {
        if (weekId == 0) revert BadWeek();
        return uint256(genesis) + uint256(weekId - 1) * 1 weeks;
    }

    function scoredAt(uint32 weekId) public view returns (uint256) {
        return weekStart(weekId) + SCORED_OFFSET;
    }

    function refundableAt(uint32 weekId) public view returns (uint256) {
        return scoredAt(weekId) + REFUND_DELAY;
    }

    // ---------------------------------------------------------------- sponsor

    /// @notice The sponsor deposits `amount` of `token` as prizes for `weekId`.
    function fund(uint32 weekId, address token, uint256 amount) external nonReentrant {
        if (msg.sender != sponsor) revert NotSponsor();
        if (paused) revert IsPaused();
        if (amount == 0) revert ZeroAmount();
        if (token.code.length == 0) revert NotAToken();
        if (closed[weekId][token]) revert WeekClosed();
        if (block.timestamp >= refundableAt(weekId)) revert WeekExpired();

        uint256 before = IERC20Like(token).balanceOf(address(this));
        _safeTransferFrom(token, msg.sender, address(this), amount);
        uint256 received = IERC20Like(token).balanceOf(address(this)) - before;
        if (received == 0) revert ZeroAmount();

        funded[weekId][token] += received;
        totalUnsettled[token] += received;
        emit Funded(weekId, token, msg.sender, received);
    }

    // --------------------------------------------------------------- resolver

    /// @notice Pays a week's prizes in `token`. Can run once per week and token. Anything not awarded
    ///         goes back to the sponsor. A payout that cannot be pushed is kept as `owed` for the winner.
    function settle(
        uint32 weekId,
        address token,
        address[] calldata winners,
        uint256[] calldata amounts,
        bytes32 resultsHash_
    ) external nonReentrant {
        if (msg.sender != resolver) revert NotResolver();
        if (closed[weekId][token]) revert WeekClosed();
        if (block.timestamp < weekStart(weekId) + SETTLE_OPENS_AFTER) revert TooEarly();
        uint256 n = winners.length;
        if (n != amounts.length) revert LengthMismatch();
        if (n > MAX_WINNERS) revert TooManyWinners();

        uint256 pot = funded[weekId][token];
        uint256 sum;
        for (uint256 i; i < n; ++i) {
            if (winners[i] == address(0)) revert ZeroAddress();
            sum += amounts[i];
        }
        if (sum > pot) revert OverFunded();

        closed[weekId][token] = true;
        resultsHash[weekId][token] = resultsHash_;
        funded[weekId][token] = 0;
        totalUnsettled[token] -= pot;

        for (uint256 i; i < n; ++i) {
            if (amounts[i] != 0) _pushOrOwe(weekId, token, winners[i], amounts[i]);
        }
        uint256 remainder = pot - sum;
        if (remainder != 0) _pushOrOwe(weekId, token, sponsor, remainder);

        emit Settled(weekId, token, resultsHash_, sum, remainder, n);
    }

    // ----------------------------------------------------------------- anyone

    /// @notice If a week was never settled, anyone can send its prizes back to the sponsor 7 days after scoring.
    function refundExpired(uint32 weekId, address token) external nonReentrant {
        if (closed[weekId][token]) revert WeekClosed();
        if (block.timestamp < refundableAt(weekId)) revert TooEarly();
        uint256 amount = funded[weekId][token];
        if (amount == 0) revert NothingToRefund();
        closed[weekId][token] = true;
        funded[weekId][token] = 0;
        totalUnsettled[token] -= amount;
        address to = sponsor;
        _pushOrOwe(weekId, token, to, amount);
        emit Refunded(weekId, token, to, amount);
    }

    /// @notice Claims a payout that could not be pushed, to the caller or to another address of theirs.
    function withdraw(address token, address to) external nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        uint256 amount = owed[token][msg.sender];
        if (amount == 0) revert NothingOwed();
        owed[token][msg.sender] = 0;
        totalOwed[token] -= amount;
        _safeTransfer(token, to, amount);
        emit Withdrawn(token, msg.sender, to, amount);
    }

    // ------------------------------------------------------------------ owner

    function setResolver(address resolver_) external onlyOwner {
        if (resolver_ == address(0)) revert ZeroAddress();
        resolver = resolver_;
        emit ResolverSet(resolver_);
    }

    function setSponsor(address sponsor_) external onlyOwner {
        if (sponsor_ == address(0)) revert ZeroAddress();
        sponsor = sponsor_;
        emit SponsorSet(sponsor_);
    }

    /// @notice Pause stops new funding only. Settlement, refunds and withdrawals always work.
    function setPaused(bool paused_) external onlyOwner {
        paused = paused_;
        emit PausedSet(paused_);
    }

    /// @notice Returns tokens sent to the pool outside `fund` to the sponsor. Accounted prizes cannot be touched.
    function skim(address token) external onlyOwner nonReentrant {
        uint256 bal = IERC20Like(token).balanceOf(address(this));
        uint256 accounted = totalUnsettled[token] + totalOwed[token];
        if (bal <= accounted) revert ZeroAmount();
        uint256 excess = bal - accounted;
        _safeTransfer(token, sponsor, excess);
        emit Skimmed(token, sponsor, excess);
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

    // --------------------------------------------------------------- internal

    function _pushOrOwe(uint32 weekId, address token, address to, uint256 amount) internal {
        if (_tryTransfer(token, to, amount)) {
            emit Paid(weekId, token, to, amount);
        } else {
            owed[token][to] += amount;
            totalOwed[token] += amount;
            emit PayoutDeferred(weekId, token, to, amount);
        }
    }

    function _tryTransfer(address token, address to, uint256 amount) internal returns (bool) {
        (bool ok, bytes memory ret) = token.call(abi.encodeCall(IERC20Like.transfer, (to, amount)));
        if (!ok) return false;
        if (ret.length == 0) return token.code.length > 0;
        return ret.length >= 32 && abi.decode(ret, (bool));
    }

    function _safeTransfer(address token, address to, uint256 amount) internal {
        if (!_tryTransfer(token, to, amount)) revert TransferFailed();
    }

    function _safeTransferFrom(address token, address from, address to, uint256 amount) internal {
        (bool ok, bytes memory ret) = token.call(abi.encodeCall(IERC20Like.transferFrom, (from, to, amount)));
        if (!ok || (ret.length != 0 && (ret.length < 32 || !abi.decode(ret, (bool))))) revert TransferFailed();
    }
}
