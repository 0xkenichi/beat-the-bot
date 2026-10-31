// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {PrizePool} from "../src/PrizePool.sol";
import {MockERC20} from "./mocks/Mocks.sol";

/// @dev Drives random fund / settle / refund / withdraw sequences across several weeks.
contract PoolHandler is Test {
    PrizePool public pool;
    MockERC20 public token;
    address public sponsor;
    address public resolver;
    address[] public winners;
    uint64 public genesis;

    constructor(PrizePool pool_, MockERC20 token_, address sponsor_, address resolver_, uint64 genesis_) {
        pool = pool_;
        token = token_;
        sponsor = sponsor_;
        resolver = resolver_;
        genesis = genesis_;
        for (uint256 i; i < 5; ++i) {
            winners.push(address(uint160(0xA11CE + i)));
        }
    }

    function fund(uint8 week, uint64 amount) external {
        uint32 w = uint32(bound(week, 1, 4));
        amount = uint64(bound(amount, 1, 100e6));
        if (pool.closed(w, address(token)) || block.timestamp >= pool.refundableAt(w)) return;
        token.mint(sponsor, amount);
        vm.prank(sponsor);
        pool.fund(w, address(token), amount);
    }

    function settle(uint8 week, uint64 seed, bool blockOne) external {
        uint32 w = uint32(bound(week, 1, 4));
        if (pool.closed(w, address(token))) return;
        if (block.timestamp < pool.weekStart(w) + 3 days) vm.warp(pool.weekStart(w) + 3 days);
        uint256 pot = pool.funded(w, address(token));
        address[] memory ws = new address[](3);
        uint256[] memory as_ = new uint256[](3);
        uint256 left = pot;
        for (uint256 i; i < 3; ++i) {
            ws[i] = winners[(seed + i) % winners.length];
            as_[i] = left == 0 ? 0 : uint256(keccak256(abi.encode(seed, i))) % (left + 1);
            left -= as_[i];
        }
        if (blockOne) token.setBlocked(ws[0], true);
        vm.prank(resolver);
        pool.settle(w, address(token), ws, as_, bytes32(uint256(seed)));
        if (blockOne) token.setBlocked(ws[0], false);
    }

    function refund(uint8 week) external {
        uint32 w = uint32(bound(week, 1, 4));
        if (pool.closed(w, address(token)) || pool.funded(w, address(token)) == 0) return;
        vm.warp(pool.refundableAt(w));
        pool.refundExpired(w, address(token));
    }

    function withdraw(uint8 who) external {
        address a = winners[who % winners.length];
        if (pool.owed(address(token), a) == 0) return;
        vm.prank(a);
        pool.withdraw(address(token), a);
    }
}

contract PrizePoolInvariantTest is Test {
    PrizePool pool;
    MockERC20 token;
    PoolHandler handler;
    uint64 constant GENESIS = 1_794_182_400;

    function setUp() public {
        address sponsor = makeAddr("sponsor");
        address resolver = makeAddr("resolver");
        pool = new PrizePool(address(this), resolver, sponsor, GENESIS);
        token = new MockERC20("USD Coin", "USDC", 6);
        vm.prank(sponsor);
        token.approve(address(pool), type(uint256).max);
        vm.warp(GENESIS - 1 days);
        handler = new PoolHandler(pool, token, sponsor, resolver, GENESIS);
        targetContract(address(handler));
    }

    /// @notice Pool balance per token == unsettled funding + owed.
    function invariant_balanceEqualsUnsettledPlusOwed() public view {
        assertEq(
            token.balanceOf(address(pool)),
            pool.totalUnsettled(address(token)) + pool.totalOwed(address(token))
        );
    }

    function invariant_unsettledIsSumOfOpenWeeks() public view {
        uint256 sum;
        for (uint32 w = 1; w <= 4; ++w) {
            sum += pool.funded(w, address(token));
        }
        assertEq(sum, pool.totalUnsettled(address(token)));
    }
}
