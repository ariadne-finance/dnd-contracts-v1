// SPDX-License-Identifier: Unlicensed
pragma solidity ^0.8.0;

import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

import "./interfaces/velodrome/IRouter.sol";
import "./interfaces/velodrome/IPairFactory.sol";
import "./interfaces/velodrome/IPair.sol";

import "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";

import "./ISwapHelper.sol";

address constant ammRouter = 0x9c12939390052919aF3155f41Bf4160Fd3666A6f;

contract SwapHelperOptimisticEthereum is ISwapHelper {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    function swap(address from, address to, uint256 amount, address recipient)
        external
        override
        returns (uint256)
    {
        IERC20Upgradeable(from).transferFrom(msg.sender, address(this), amount);

        IERC20Upgradeable(from).approve(ammRouter, amount);

        uint256[] memory swappedAmounts = IRouter(ammRouter).swapExactTokensForTokensSimple(
            amount,
            0,
            from,
            to,
            false,
            recipient,
            block.timestamp
        );

        return swappedAmounts[1];
    }

    function calcSwapFee(address from, address to, uint256 amount) // solhint-disable-line no-unused-vars
        public
        view
        override
        returns (uint256)
    {
        // address ammPair = IRouter(ammRouter).pairFor(from, to, false);
        uint256 fee = IPairFactory(IUniswapV2Router02(ammRouter).factory()).getFee(false);
        return amount / 1000 * (fee * 2);
    }
}
