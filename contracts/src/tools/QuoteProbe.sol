// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface ICLPoolSwap {
    function swap(address recipient, bool zeroForOne, int256 amountSpecified, uint160 sqrtPriceLimitX96, bytes calldata data)
        external
        returns (int256 amount0, int256 amount1);
}

/// @title QuoteProbe
/// @notice Never deployed. The app places this runtime code at a fixed address through an eth_call state
///         override and asks a concentrated-liquidity pool for an exact quote: the pool computes the swap,
///         calls back, and the callback reverts with the amounts, so nothing is ever paid or kept.
contract QuoteProbe {
    error Quote(int256 amount0, int256 amount1);

    uint160 internal constant MIN_SQRT_RATIO_PLUS_ONE = 4295128740;
    uint160 internal constant MAX_SQRT_RATIO_MINUS_ONE = 1461446703485210103287273052203988822378723970341;

    function quote(address pool, bool zeroForOne, int256 amountSpecified)
        external
        returns (int256 amount0, int256 amount1)
    {
        uint160 limit = zeroForOne ? MIN_SQRT_RATIO_PLUS_ONE : MAX_SQRT_RATIO_MINUS_ONE;
        try ICLPoolSwap(pool).swap(address(this), zeroForOne, amountSpecified, limit, "") {
            revert("QuoteProbe: no callback");
        } catch (bytes memory reason) {
            if (reason.length != 68 || bytes4(reason) != Quote.selector) {
                assembly {
                    revert(add(reason, 32), mload(reason))
                }
            }
            assembly {
                amount0 := mload(add(reason, 36))
                amount1 := mload(add(reason, 68))
            }
        }
    }

    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata) external pure {
        revert Quote(amount0Delta, amount1Delta);
    }
}
