// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {PrizePool} from "../src/PrizePool.sol";
import {MockERC20, MockB20} from "./mocks/Mocks.sol";

contract PrizePoolTest is Test {
    PrizePool pool;
    MockERC20 usdc;
    MockB20 stock;
    address owner = makeAddr("owner");
    address resolver = makeAddr("resolver");
    address sponsor = makeAddr("sponsor");
    address w1 = makeAddr("winner1");
    address w2 = makeAddr("winner2");
    address w3 = makeAddr("winner3");
    // Mon 9 Nov 2026 00:00:00 UTC
    uint64 constant GENESIS = 1_794_182_400;
    uint32 constant WEEK = 1;

    function setUp() public {
        pool = new PrizePool(owner, resolver, sponsor, GENESIS);
        usdc = new MockERC20("USD Coin", "USDC", 6);
        stock = new MockB20();
        usdc.mint(sponsor, 1_000e6);
        stock.mint(sponsor, 100e8);
        vm.startPrank(sponsor);
        usdc.approve(address(pool), type(uint256).max);
        stock.approve(address(pool), type(uint256).max);
        vm.stopPrank();
        vm.warp(GENESIS - 1 days);
    }

    function _fund(address token, uint256 amount) internal {
        vm.prank(sponsor);
        pool.fund(WEEK, token, amount);
    }

    function _arr(address a, address b, address c) internal pure returns (address[] memory r) {
        r = new address[](3);
        (r[0], r[1], r[2]) = (a, b, c);
    }

    function _amts(uint256 a, uint256 b, uint256 c) internal pure returns (uint256[] memory r) {
        r = new uint256[](3);
        (r[0], r[1], r[2]) = (a, b, c);
    }

    // ---------------------------------------------------------- deployment

    function test_genesisMustBeMonday() public {
        vm.expectRevert(PrizePool.BadGenesis.selector);
        new PrizePool(owner, resolver, sponsor, GENESIS + 1 days);
        assertEq(pool.weekStart(1), GENESIS);
        assertEq(pool.scoredAt(1), GENESIS + 4 days + 21 hours);
        assertEq(pool.weekStart(3), GENESIS + 2 weeks);
        vm.expectRevert(PrizePool.BadWeek.selector);
        pool.weekStart(0);
    }

    // ---------------------------------------------------------------- fund

    function test_fund_onlySponsor_andAccounting() public {
        vm.expectRevert(PrizePool.NotSponsor.selector);
        pool.fund(WEEK, address(usdc), 1e6);
        _fund(address(usdc), 50e6);
        assertEq(pool.funded(WEEK, address(usdc)), 50e6);
        assertEq(pool.totalUnsettled(address(usdc)), 50e6);
        assertEq(usdc.balanceOf(address(pool)), 50e6);
    }

    function test_fund_rejects() public {
        vm.startPrank(sponsor);
        vm.expectRevert(PrizePool.ZeroAmount.selector);
        pool.fund(WEEK, address(usdc), 0);
        vm.expectRevert(PrizePool.NotAToken.selector);
        pool.fund(WEEK, makeAddr("eoa"), 1);
        vm.expectRevert(PrizePool.BadWeek.selector);
        pool.fund(0, address(usdc), 1);
        vm.stopPrank();
        vm.warp(pool.refundableAt(WEEK));
        vm.prank(sponsor);
        vm.expectRevert(PrizePool.WeekExpired.selector);
        pool.fund(WEEK, address(usdc), 1);
    }

    function test_pause_blocksFundOnly() public {
        _fund(address(usdc), 40e6);
        vm.prank(owner);
        pool.setPaused(true);
        vm.prank(sponsor);
        vm.expectRevert(PrizePool.IsPaused.selector);
        pool.fund(WEEK, address(usdc), 1e6);
        // Settlement still works while paused.
        vm.warp(pool.scoredAt(WEEK));
        vm.prank(resolver);
        pool.settle(WEEK, address(usdc), _arr(w1, w2, w3), _amts(20e6, 12e6, 8e6), keccak256("r"));
        assertEq(usdc.balanceOf(w1), 20e6);
    }

    // -------------------------------------------------------------- settle

    function test_settle_paysWinners_5030_20() public {
        _fund(address(usdc), 40e6);
        vm.warp(pool.scoredAt(WEEK));
        bytes32 rh = keccak256("results-week-1");
        vm.prank(resolver);
        pool.settle(WEEK, address(usdc), _arr(w1, w2, w3), _amts(20e6, 12e6, 8e6), rh);
        assertEq(usdc.balanceOf(w1), 20e6);
        assertEq(usdc.balanceOf(w2), 12e6);
        assertEq(usdc.balanceOf(w3), 8e6);
        assertEq(usdc.balanceOf(address(pool)), 0);
        assertTrue(pool.closed(WEEK, address(usdc)));
        assertEq(pool.resultsHash(WEEK, address(usdc)), rh);
        assertEq(pool.totalUnsettled(address(usdc)), 0);
    }

    function test_settle_remainderReturnsToSponsor() public {
        _fund(address(usdc), 40e6);
        vm.warp(pool.scoredAt(WEEK));
        uint256 before = usdc.balanceOf(sponsor);
        address[] memory one = new address[](1);
        one[0] = w1;
        uint256[] memory amt = new uint256[](1);
        amt[0] = 25e6;
        vm.prank(resolver);
        pool.settle(WEEK, address(usdc), one, amt, bytes32(0));
        assertEq(usdc.balanceOf(w1), 25e6);
        assertEq(usdc.balanceOf(sponsor) - before, 15e6);
    }

    function test_settle_rules() public {
        _fund(address(usdc), 40e6);
        vm.prank(resolver);
        vm.expectRevert(PrizePool.TooEarly.selector);
        pool.settle(WEEK, address(usdc), _arr(w1, w2, w3), _amts(1, 1, 1), bytes32(0));

        vm.warp(pool.scoredAt(WEEK));
        vm.expectRevert(PrizePool.NotResolver.selector);
        pool.settle(WEEK, address(usdc), _arr(w1, w2, w3), _amts(1, 1, 1), bytes32(0));

        vm.startPrank(resolver);
        vm.expectRevert(PrizePool.OverFunded.selector);
        pool.settle(WEEK, address(usdc), _arr(w1, w2, w3), _amts(20e6, 20e6, 1), bytes32(0));
        vm.expectRevert(PrizePool.LengthMismatch.selector);
        pool.settle(WEEK, address(usdc), _arr(w1, w2, w3), new uint256[](2), bytes32(0));
        vm.expectRevert(PrizePool.ZeroAddress.selector);
        pool.settle(WEEK, address(usdc), _arr(w1, address(0), w3), _amts(1, 1, 1), bytes32(0));

        pool.settle(WEEK, address(usdc), _arr(w1, w2, w3), _amts(20e6, 12e6, 8e6), bytes32(0));
        vm.expectRevert(PrizePool.WeekClosed.selector);
        pool.settle(WEEK, address(usdc), _arr(w1, w2, w3), _amts(0, 0, 0), bytes32(0));
        vm.stopPrank();

        vm.prank(sponsor);
        vm.expectRevert(PrizePool.WeekClosed.selector);
        pool.fund(WEEK, address(usdc), 1e6);
    }

    function test_settle_failedTransferBecomesOwed_thenWithdraw() public {
        _fund(address(usdc), 40e6);
        usdc.setBlocked(w2, true);
        vm.warp(pool.scoredAt(WEEK));
        vm.prank(resolver);
        pool.settle(WEEK, address(usdc), _arr(w1, w2, w3), _amts(20e6, 12e6, 8e6), bytes32(0));
        assertEq(usdc.balanceOf(w1), 20e6);
        assertEq(pool.owed(address(usdc), w2), 12e6);
        assertEq(pool.totalOwed(address(usdc)), 12e6);
        assertEq(usdc.balanceOf(address(pool)), 12e6);

        // Still blocked: withdrawing to the same address fails, to another address of theirs works.
        vm.prank(w2);
        vm.expectRevert(PrizePool.TransferFailed.selector);
        pool.withdraw(address(usdc), w2);
        address other = makeAddr("w2-other-wallet");
        vm.prank(w2);
        pool.withdraw(address(usdc), other);
        assertEq(usdc.balanceOf(other), 12e6);
        assertEq(pool.owed(address(usdc), w2), 0);
        assertEq(pool.totalOwed(address(usdc)), 0);

        vm.prank(w2);
        vm.expectRevert(PrizePool.NothingOwed.selector);
        pool.withdraw(address(usdc), w2);
    }

    function test_settle_returnFalseTokenBecomesOwed() public {
        _fund(address(usdc), 10e6);
        usdc.setBlocked(w1, true);
        usdc.setReturnFalse(true);
        vm.warp(pool.scoredAt(WEEK));
        address[] memory one = new address[](1);
        one[0] = w1;
        uint256[] memory amt = new uint256[](1);
        amt[0] = 10e6;
        vm.prank(resolver);
        pool.settle(WEEK, address(usdc), one, amt, bytes32(0));
        assertEq(pool.owed(address(usdc), w1), 10e6);
    }

    // ------------------------------------------- tokenized-stock (B20) prizes

    function test_stockPrize_policyBlockedWinner_andMultiplierValuation() public {
        _fund(address(stock), 3e8);
        stock.setPolicyBlocked(w3, true);
        vm.warp(pool.scoredAt(WEEK));
        vm.prank(resolver);
        pool.settle(WEEK, address(stock), _arr(w1, w2, w3), _amts(1.5e8, 0.9e8, 0.6e8), bytes32(0));
        assertEq(stock.balanceOf(w1), 1.5e8);
        assertEq(pool.owed(address(stock), w3), 0.6e8);
        // A dividend raises the multiplier; raw balances stay, the UI balance grows.
        stock.setMultiplier(1.02e18);
        assertEq(stock.balanceOf(w1), 1.5e8);
        assertEq(stock.balanceOfUI(w1), 1.53e8);
        // The pool's accounting is in raw units and is unaffected.
        assertEq(stock.balanceOf(address(pool)), pool.totalOwed(address(stock)));
    }

    // -------------------------------------------------------------- refund

    function test_refundExpired() public {
        _fund(address(usdc), 40e6);
        vm.warp(pool.refundableAt(WEEK) - 1);
        vm.expectRevert(PrizePool.TooEarly.selector);
        pool.refundExpired(WEEK, address(usdc));
        vm.warp(pool.refundableAt(WEEK));
        uint256 before = usdc.balanceOf(sponsor);
        vm.prank(makeAddr("anyone"));
        pool.refundExpired(WEEK, address(usdc));
        assertEq(usdc.balanceOf(sponsor) - before, 40e6);
        assertTrue(pool.closed(WEEK, address(usdc)));
        vm.warp(pool.refundableAt(WEEK) + 1);
        vm.prank(resolver);
        vm.expectRevert(PrizePool.WeekClosed.selector);
        pool.settle(WEEK, address(usdc), _arr(w1, w2, w3), _amts(0, 0, 0), bytes32(0));
    }

    function test_refund_nothing() public {
        vm.warp(pool.refundableAt(WEEK));
        vm.expectRevert(PrizePool.NothingToRefund.selector);
        pool.refundExpired(WEEK, address(usdc));
    }

    // ---------------------------------------------------------- owner roles

    function test_roles() public {
        vm.expectRevert(PrizePool.NotOwner.selector);
        pool.setResolver(w1);
        vm.startPrank(owner);
        pool.setResolver(w1);
        pool.setSponsor(w2);
        vm.expectRevert(PrizePool.ZeroAddress.selector);
        pool.setSponsor(address(0));
        vm.stopPrank();
        assertEq(pool.resolver(), w1);
        assertEq(pool.sponsor(), w2);
    }

    function test_skim_onlyExcess() public {
        _fund(address(usdc), 40e6);
        vm.prank(owner);
        vm.expectRevert(PrizePool.ZeroAmount.selector);
        pool.skim(address(usdc));
        usdc.mint(address(pool), 5e6); // unsolicited transfer
        uint256 before = usdc.balanceOf(sponsor);
        vm.prank(owner);
        pool.skim(address(usdc));
        assertEq(usdc.balanceOf(sponsor) - before, 5e6);
        assertEq(usdc.balanceOf(address(pool)), 40e6);
    }

    // ---------------------------------------------------------------- fuzz

    function testFuzz_settle_sums(uint96 funding, uint96 a, uint96 b, uint96 c) public {
        funding = uint96(bound(funding, 1, 1_000e6));
        _fund(address(usdc), funding);
        vm.warp(pool.scoredAt(WEEK));
        uint256 sum = uint256(a) + b + c;
        uint256 sponsorBefore = usdc.balanceOf(sponsor);
        address[] memory ws = _arr(w1, w2, w3);
        uint256[] memory amts = _amts(a, b, c);
        vm.prank(resolver);
        if (sum > funding) {
            vm.expectRevert(PrizePool.OverFunded.selector);
            pool.settle(WEEK, address(usdc), ws, amts, bytes32(0));
            return;
        }
        pool.settle(WEEK, address(usdc), _arr(w1, w2, w3), _amts(a, b, c), bytes32(0));
        assertEq(usdc.balanceOf(w1), a);
        assertEq(usdc.balanceOf(w2), b);
        assertEq(usdc.balanceOf(w3), c);
        assertEq(usdc.balanceOf(sponsor) - sponsorBefore, funding - sum);
        assertEq(usdc.balanceOf(address(pool)), 0);
    }
}
