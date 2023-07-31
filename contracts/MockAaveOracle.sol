// SPDX-License-Identifier: MIT

pragma solidity >=0.8.0;

/* solhint-disable func-name-mixedcase, no-console */

import "@aave/core-v3/contracts/interfaces/IAaveOracle.sol";
import "hardhat/console.sol";

contract MockAaveOracle {
    IAaveOracle public original;

    mapping (address => uint) public overridePrice;

    constructor(address _original) {
        original = IAaveOracle(_original);
    }

    function getAssetPrice(address asset) external view returns (uint256) {
        if (overridePrice[asset] != 0) {
            // console.log("[MOCK ORACLE] getAssetPrice override %s to %d", asset, overridePrice[asset]);
            return overridePrice[asset];
        }

        return original.getAssetPrice(asset);
    }

    function getAssetsPrices(address[] calldata assets) external view returns (uint256[] memory) {
        uint256[] memory assetsPrices = original.getAssetsPrices(assets);

        for (uint i=0; i<assets.length; i++) {
            if (overridePrice[assets[i]] == 0) {
                continue;
            }

            assetsPrices[i] = overridePrice[assets[i]];

            // console.log("[MOCK ORACLE] getAssetsPrices asset %s override %d", assets[i], assetsPrices[i]);
        }

        return assetsPrices;
    }

    function getSourceOfAsset(address asset) external view returns (address) {
        return original.getSourceOfAsset(asset);
    }

    function getFallbackOracle() external view returns (address) {
        return original.getFallbackOracle();
    }

    function setOverridePrice(address asset, uint256 price) external {
        console.log("[MOCK ORACLE] setOverridePrice %s = %d", asset, price);
        overridePrice[asset] = price;
    }

    function ADDRESSES_PROVIDER() external view returns (address) {
        return address(original.ADDRESSES_PROVIDER());
    }

    function BASE_CURRENCY() external view returns (address) {
        return original.BASE_CURRENCY();
    }

    function BASE_CURRENCY_UNIT() external view returns (uint256) {
        return original.BASE_CURRENCY_UNIT();
    }
}
