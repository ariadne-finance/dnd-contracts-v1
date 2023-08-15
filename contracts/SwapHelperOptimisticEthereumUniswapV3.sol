// SPDX-License-Identifier: Unlicensed
pragma solidity ^0.8.0;

// we use solady for safe ERC20 functions because of dependency hell and casting requirement of SafeERC20 in OpenZeppelin; solady has zero deps.
import { SafeTransferLib } from "solady/src/utils/SafeTransferLib.sol";

import "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";

import "./ISwapHelper.sol";

address constant USDC = 0x7F5c764cBc14f9669B88837ca1490cCa17c31607;
address constant WSTETH = 0x1F32b1c2345538c0c6f582fCB022739c4A194Ebb;
address constant WETH = 0x4200000000000000000000000000000000000006;

address constant ROUTER = 0xE592427A0AEce92De3Edee1F18E0157C05861564;

contract SwapHelperOptimisticEthereumUniswapV3 is ISwapHelper {
    function calcSwapFee(address from, address to, uint256 amount) // solhint-disable-line no-unused-vars
        external
        view
        override
        returns (uint256)
    {
        return amount * 4 / 1000;
    }

    function swap(address from, address to, uint256 amount, address recipient)
        public
        override
        returns (uint256)
    {
        SafeTransferLib.safeTransferFrom(from, msg.sender, address(this), amount);
        SafeTransferLib.safeApprove(from, ROUTER, amount);

        if (from == WSTETH && to == WETH) {
            ISwapRouter.ExactInputParams memory params = ISwapRouter.ExactInputParams({
                path: abi.encodePacked(WSTETH, uint24(100), WETH),
                recipient: recipient,
                deadline: block.timestamp,
                amountIn: amount,
                amountOutMinimum: 0
            });

            return ISwapRouter(ROUTER).exactInput(params);

        } else if (from == WETH && to == WSTETH) {
            ISwapRouter.ExactInputParams memory params = ISwapRouter.ExactInputParams({
                path: abi.encodePacked(WETH, uint24(100), WSTETH),
                recipient: recipient,
                deadline: block.timestamp,
                amountIn: amount,
                amountOutMinimum: 0
            });

            return ISwapRouter(ROUTER).exactInput(params);

        } else if (from == USDC && to == WSTETH) {
            ISwapRouter.ExactInputParams memory params = ISwapRouter.ExactInputParams({
                path: abi.encodePacked(USDC, uint24(500), WETH, uint24(100), WSTETH),
                recipient: recipient,
                deadline: block.timestamp,
                amountIn: amount,
                amountOutMinimum: 0
            });

            return ISwapRouter(ROUTER).exactInput(params);

        } else if (from == WSTETH && to == USDC) {
            ISwapRouter.ExactInputParams memory params = ISwapRouter.ExactInputParams({
                path: abi.encodePacked(WSTETH, uint24(100), WETH, uint24(500), USDC),
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
