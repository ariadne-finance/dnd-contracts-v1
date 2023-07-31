// SPDX-License-Identifier: Unlicensed
pragma solidity ^0.8.0;

import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

import { IAaveOracle } from "@aave/core-v3/contracts/interfaces/IAaveOracle.sol";
import { IPoolAddressesProvider } from "@aave/core-v3/contracts/interfaces/IPoolAddressesProvider.sol";

import "./ISwapHelper.sol";

address constant ADDRESSES_PROVIDER = 0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb; // solhint-disable-line var-name-mixedcase

contract SwapHelperEmulator is ISwapHelper {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    address private custodian;
    address private ethToken;

    constructor(address _custodian, address _ethToken) {
        custodian = _custodian;
        ethToken = _ethToken;
    }

    function oracle() internal view returns (IAaveOracle) {
        return IAaveOracle(IPoolAddressesProvider(ADDRESSES_PROVIDER).getPriceOracle());
    }

    function swap(address from, address to, uint256 amount, address recipient)
        external
        override
        returns (uint256)
    {
        IERC20Upgradeable(from).transferFrom(msg.sender, address(this), amount);

        uint256 ethPrice = oracle().getAssetPrice(address(ethToken));

        if (to == ethToken) {
            uint256 stablePrice = oracle().getAssetPrice(from);
            uint256 amountEth = stableToEth(amount, stablePrice, ethPrice) / 1000 * 995; // 0.5%
            IERC20Upgradeable(ethToken).transferFrom(custodian, recipient, amountEth);
            IERC20Upgradeable(from).transfer(custodian, amount);
            return amountEth;

        } else if (from == ethToken) {
            uint256 stablePrice = oracle().getAssetPrice(to);
            uint256 amountStable = ethToStable(amount, ethPrice, stablePrice) / 1000 * 995; // 0.5%
            IERC20Upgradeable(to).transferFrom(custodian, recipient, amountStable);
            IERC20Upgradeable(ethToken).transfer(custodian, amount);
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
