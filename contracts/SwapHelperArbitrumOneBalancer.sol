// SPDX-License-Identifier: Unlicensed
pragma solidity ^0.8.0;

import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

import { IVault } from "@balancer-labs/v2-interfaces/contracts/vault/IVault.sol";
import { IAsset } from "@balancer-labs/v2-interfaces/contracts/vault/IAsset.sol";
import { IBasePool } from "@balancer-labs/v2-interfaces/contracts/vault/IBasePool.sol";

import "./ISwapHelper.sol";

IVault constant VAULT = IVault(0xBA12222222228d8Ba445958a75a0704d566BF2C8);

address constant USDCE = 0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8;
address constant WSTETH = 0x5979D7b546E38E414F7E9822514be443A4800529;
address constant WETH = 0x82aF49447D8a07e3bd95BD0d56f35241523fBab1;

contract SwapHelperArbitrumOneBalancer is ISwapHelper {
    using SafeERC20Upgradeable for IERC20Upgradeable;

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
        IERC20Upgradeable(from).transferFrom(msg.sender, address(this), amount);
        IERC20Upgradeable(from).safeApprove(address(VAULT), amount);

        IBasePool poolWethWsteth = IBasePool(0x36bf227d6BaC96e2aB1EbB5492ECec69C691943f);
        IBasePool poolWethWbtcUsdce = IBasePool(0x64541216bAFFFEec8ea535BB71Fbc927831d0595);

        bytes memory userData;

        IAsset[] memory assets = new IAsset[](3);
        assets[0] = IAsset(WSTETH);
        assets[1] = IAsset(WETH);
        assets[2] = IAsset(USDCE);

        IVault.FundManagement memory fundManagement = IVault.FundManagement({
            sender: address(this),
            fromInternalBalance: false,
            recipient: payable(recipient),
            toInternalBalance: false
        });

        int256[] memory limits = new int256[](3);

        IVault.BatchSwapStep[] memory batchSwapSteps = new IVault.BatchSwapStep[](2);

        if (from == WSTETH && to == USDCE) {
            batchSwapSteps[0] = IVault.BatchSwapStep({
                poolId: poolWethWsteth.getPoolId(),
                assetInIndex: 0,
                assetOutIndex: 1,
                amount: amount,
                userData: userData
            });

            batchSwapSteps[1] = IVault.BatchSwapStep({
                poolId: poolWethWbtcUsdce.getPoolId(),
                assetInIndex: 1,
                assetOutIndex: 2,
                amount: 0,
                userData: userData
            });

            limits[0] = 2**128-1;
            limits[1] = 0;
            limits[2] = 0;

            int256[] memory assetDeltas = VAULT.batchSwap(
                IVault.SwapKind.GIVEN_IN,
                batchSwapSteps,
                assets,
                fundManagement,
                limits,
                block.timestamp
            );

            return uint256(-assetDeltas[2]);

        } else if (from == USDCE && to == WSTETH) {
            batchSwapSteps[0] = IVault.BatchSwapStep({
                poolId: poolWethWbtcUsdce.getPoolId(),
                assetInIndex: 2,
                assetOutIndex: 1,
                amount: amount,
                userData: userData
            });

            batchSwapSteps[1] = IVault.BatchSwapStep({
                poolId: poolWethWsteth.getPoolId(),
                assetInIndex: 1,
                assetOutIndex: 0,
                amount: 0,
                userData: userData
            });

            limits[0] = 2**128-1;
            limits[1] = 2**128-1;
            limits[2] = 2**128-1;

            int256[] memory assetDeltas = VAULT.batchSwap(
                IVault.SwapKind.GIVEN_IN,
                batchSwapSteps,
                assets,
                fundManagement,
                limits,
                block.timestamp
            );

            return uint256(-assetDeltas[0]);

        } else {
            revert("SWAP ROUTE?");
        }
    }
}
