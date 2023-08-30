// SPDX-License-Identifier: Unlicensed
pragma solidity ^0.8.0;

import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

import { IAaveOracle } from "@aave/core-v3/contracts/interfaces/IAaveOracle.sol";
import { IPoolAddressesProvider } from "@aave/core-v3/contracts/interfaces/IPoolAddressesProvider.sol";

import "./ISwapHelper.sol";

contract SwapHelperEmulator is ISwapHelper {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    address private custodian;
    address private wstethToken;
    address private wethToken;
    address private addressesProvider;

    constructor(address _custodian, address _ethToken, address _wethToken, address _addressesProvider) {
        custodian = _custodian;
        wstethToken = _ethToken;
        wethToken = _wethToken;
        addressesProvider = _addressesProvider;
    }

    function oracle() internal view returns (IAaveOracle) {
        return IAaveOracle(IPoolAddressesProvider(addressesProvider).getPriceOracle());
    }

    function swap(address from, address to, uint256 amount, address recipient)
        external
        override
        returns (uint256)
    {
        IERC20Upgradeable(from).transferFrom(msg.sender, address(this), amount);

        uint256 wstethPrice = oracle().getAssetPrice(address(wstethToken));
        uint256 wethPrice = oracle().getAssetPrice(address(wethToken));

        if (from == wethToken && to == wstethToken) {
            uint256 amountEth = amount * wethPrice / wstethPrice / 1000 * 995; // 0.5%
            IERC20Upgradeable(wstethToken).transferFrom(custodian, recipient, amountEth);
            IERC20Upgradeable(from).transfer(custodian, amount);
            return amountEth;

        } else if (to == wstethToken) {
            uint256 stablePrice = oracle().getAssetPrice(from);
            uint256 amountEth = stableToEth(amount, stablePrice, wstethPrice) / 1000 * 995; // 0.5%
            IERC20Upgradeable(wstethToken).transferFrom(custodian, recipient, amountEth);
            IERC20Upgradeable(from).transfer(custodian, amount);
            return amountEth;

        } else if (from == wstethToken) {
            uint256 stablePrice = oracle().getAssetPrice(to);
            uint256 amountStable = ethToStable(amount, wstethPrice, stablePrice) / 1000 * 995; // 0.5%
            IERC20Upgradeable(to).transferFrom(custodian, recipient, amountStable);
            IERC20Upgradeable(wstethToken).transfer(custodian, amount);
            return amountStable;
        }

        revert("WTF");
    }

    function calcSwapFee(address from, address to, uint256 amount) // solhint-disable-line no-unused-vars
        public
        view
        override
        returns (uint256)
    {
        return amount * 10 / 1000;
    }

    function ethToStable(uint256 amount, uint256 ethPrice, uint256 stablePrice) internal pure returns (uint256) {
        return amount * ethPrice / 10 ** (18 - 6) / stablePrice;
    }

    function stableToEth(uint256 amount, uint256 stablePrice, uint256 ethPrice) internal pure returns (uint256) {
        return amount * stablePrice * 10 ** (18 - 6) / ethPrice;
    }
}
