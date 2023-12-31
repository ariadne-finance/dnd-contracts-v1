// SPDX-License-Identifier: Unlicensed
pragma solidity ^0.8.0;

// we use solady for safe ERC20 functions because of dependency hell and casting requirement of SafeERC20 in OpenZeppelin; solady has zero deps.
import { SafeTransferLib } from "solady/src/utils/SafeTransferLib.sol";

import "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";

import "./ISwapHelper.sol";

address constant USDCE = 0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8;
address constant WSTETH = 0x5979D7b546E38E414F7E9822514be443A4800529;
address constant WETH = 0x82aF49447D8a07e3bd95BD0d56f35241523fBab1;

address constant ROUTER = 0xE592427A0AEce92De3Edee1F18E0157C05861564;

contract SwapHelperArbitrumOneUniswapV3 is ISwapHelper {
    function calcSwapFee(address from, address to, uint256 amount) // solhint-disable-line no-unused-vars
        external
        view
        override
        returns (uint256)
    {
        return amount * 3 / 1000;
    }

    function swap(address from, address to, uint256 amount, address recipient)
        public
        override
        returns (uint256)
    {
        SafeTransferLib.safeTransferFrom(from, msg.sender, address(this), amount);
        SafeTransferLib.safeApprove(from, ROUTER, amount);

        if (from == WETH && to == WSTETH) {
            ISwapRouter.ExactInputParams memory params = ISwapRouter.ExactInputParams({
                path: abi.encodePacked(WETH, uint24(100), WSTETH),
                recipient: recipient,
                deadline: block.timestamp,
                amountIn: amount,
                amountOutMinimum: 0
            });

            return ISwapRouter(ROUTER).exactInput(params);

        } else if (from == WSTETH && to == WETH) {
            ISwapRouter.ExactInputParams memory params = ISwapRouter.ExactInputParams({
                path: abi.encodePacked(WSTETH, uint24(100), WETH),
                recipient: recipient,
                deadline: block.timestamp,
                amountIn: amount,
                amountOutMinimum: 0
            });

            return ISwapRouter(ROUTER).exactInput(params);

        } else if (from == USDCE && to == WSTETH) {
            ISwapRouter.ExactInputParams memory params = ISwapRouter.ExactInputParams({
                path: abi.encodePacked(USDCE, uint24(500), WETH, uint24(100), WSTETH),
                recipient: recipient,
                deadline: block.timestamp,
                amountIn: amount,
                amountOutMinimum: 0
            });

            return ISwapRouter(ROUTER).exactInput(params);

        } else if (from == WSTETH && to == USDCE) {
            ISwapRouter.ExactInputParams memory params = ISwapRouter.ExactInputParams({
                path: abi.encodePacked(WSTETH, uint24(100), WETH, uint24(500), USDCE),
                recipient: recipient,
                deadline: block.timestamp,
                amountIn: amount,
                amountOutMinimum: 0
            });

            return ISwapRouter(ROUTER).exactInput(params);
        }

        revert("SWAP ROUTE?");

        // ISwapRouter.ExactInputSingleParams memory params = ISwapRouter.ExactInputSingleParams({
        //     tokenIn: from,
        //     tokenOut: to,
        //     fee: poolFee,
        //     recipient: recipient,
        //     deadline: block.timestamp,
        //     amountIn: amount,
        //     amountOutMinimum: 0,
        //     sqrtPriceLimitX96: 0
        // });

        // // The call to `exactInputSingle` executes the swap.
        // return ISwapRouter(ROUTER).exactInputSingle(params);
    }
}
