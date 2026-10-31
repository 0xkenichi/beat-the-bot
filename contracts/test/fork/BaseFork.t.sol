// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {PrizePool} from "../../src/PrizePool.sol";

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function approve(address, uint256) external returns (bool);
}

interface IAggregatorV3 {
    function decimals() external view returns (uint8);
    function description() external view returns (string memory);
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80);
}

interface IB20 {
    function uiMultiplier() external view returns (uint256);
    function balanceOfUI(address) external view returns (uint256);
    function balanceOf(address) external view returns (uint256);
}

/// @notice Runs against a Base mainnet fork: FORK_TESTS=true BASE_RPC_URL=... forge test --match-path 'test/fork/*'
/// @dev Coinbase tokenized stocks are B20 precompiles implemented in Base's node, not EVM bytecode, so a local
///      fork cannot execute them. Their hold-and-send and multiplier checks run against Base's own node with
///      eth_simulateV1 in scripts/live/b20-hold-and-send.ts. This file covers everything a fork can run.
contract BaseForkTest is Test {
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant FEED_AAPL = 0x787f13dEa48Db0897CbCDD985de77809D837F988;
    address constant FEED_NVDA = 0x04689a41629776563E6822F76f2e57D148d28513;
    address constant NVDAC = 0xb20000000000000000000078ee7ce2fE4908108C;
    uint64 constant GENESIS = 1_794_182_400; // Mon 9 Nov 2026 00:00 UTC

    function setUp() public {
        if (!vm.envOr("FORK_TESTS", false)) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(vm.envOr("BASE_RPC_URL", string("https://mainnet.base.org")));
        assertEq(block.chainid, 8453);
    }

    function test_fork_usdcPrizeRoundTrip() public {
        address sponsor = makeAddr("sponsor");
        address resolver = makeAddr("resolver");
        PrizePool pool = new PrizePool(address(this), resolver, sponsor, GENESIS);
        deal(USDC, sponsor, 50e6);
        vm.startPrank(sponsor);
        IERC20(USDC).approve(address(pool), 50e6);
        if (block.timestamp >= pool.refundableAt(1)) vm.warp(GENESIS - 1 days);
        pool.fund(1, USDC, 50e6);
        vm.stopPrank();
        assertEq(IERC20(USDC).balanceOf(address(pool)), 50e6);

        vm.warp(pool.scoredAt(1));
        address[] memory w = new address[](3);
        uint256[] memory a = new uint256[](3);
        (w[0], w[1], w[2]) = (makeAddr("a"), makeAddr("b"), makeAddr("c"));
        (a[0], a[1], a[2]) = (20e6, 12e6, 8e6);
        vm.prank(resolver);
        pool.settle(1, USDC, w, a, keccak256("results"));
        assertEq(IERC20(USDC).balanceOf(w[0]), 20e6);
        assertEq(IERC20(USDC).balanceOf(w[2]), 8e6);
        assertEq(IERC20(USDC).balanceOf(sponsor), 10e6, "the unawarded $10 went back to the sponsor");
        assertEq(IERC20(USDC).balanceOf(address(pool)), 0);
    }

    function test_fork_chainlinkStockFeeds() public view {
        address[2] memory feeds = [FEED_AAPL, FEED_NVDA];
        for (uint256 i; i < feeds.length; ++i) {
            IAggregatorV3 f = IAggregatorV3(feeds[i]);
            assertEq(f.decimals(), 8);
            (, int256 answer,, uint256 updatedAt,) = f.latestRoundData();
            assertGt(answer, 0);
            assertLe(updatedAt, block.timestamp);
            console2.log(f.description(), uint256(answer), block.timestamp - updatedAt);
        }
    }

    function test_fork_b20PrecompileAvailability() public view {
        try IB20(NVDAC).uiMultiplier() returns (uint256 m) {
            console2.log("B20 precompile ran in the fork, uiMultiplier:", m);
            assertGe(m, 1e18);
        } catch {
            console2.log("B20 precompile is not executable in a local fork (expected).");
            console2.log("Hold-and-send and multiplier valuation: scripts/live/b20-hold-and-send.ts");
        }
    }
}
