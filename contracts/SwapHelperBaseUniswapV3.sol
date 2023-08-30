// SPDX-License-Identifier: Unlicensed
pragma solidity ^0.8.0;

// we use solady for safe ERC20 functions because of dependency hell and casting requirement of SafeERC20 in OpenZeppelin; solady has zero deps.
import { SafeTransferLib } from "solady/src/utils/SafeTransferLib.sol";

import { ERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "./interfaces/uniswap-v3/IUniversalRouter.sol";

import "./ISwapHelper.sol";

address constant USDBC = 0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA;
address constant CBETH = 0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22;
address constant WETH = 0x4200000000000000000000000000000000000006;

address constant UNIVERSAL_ROUTER = 0x198EF79F1F515F02dFE9e3115eD9fC07183f02fC;

contract SwapHelperBaseUniswapV3 is ISwapHelper {
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
        bytes memory path;

        if (from == WETH && to == CBETH) {
            path = abi.encodePacked(WETH, uint24(500), CBETH);

        } else if (from == CBETH && to == WETH) {
            path = abi.encodePacked(CBETH, uint24(500), WETH);

        } else if (from == USDBC && to == CBETH) {
            path = abi.encodePacked(USDBC, uint24(500), WETH, uint24(500), CBETH);

        } else if (from == CBETH && to == USDBC) {
            path = abi.encodePacked(CBETH, uint24(500), WETH, uint24(500), USDBC);

        } else {
            revert("SWAP ROUTE?");
        }

        SafeTransferLib.safeTransferFrom(from, msg.sender, UNIVERSAL_ROUTER, amount);

        bytes memory commands = new bytes(1);
        commands[0] = 0x0; // V3_SWAP_EXACT_IN and absolutely revert

        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(recipient, amount, 0, path, false);

        uint256 balanceBefore = ERC20Upgradeable(to).balanceOf(recipient);

        IUniversalRouter(UNIVERSAL_ROUTER).execute(commands, inputs, block.timestamp);

        return ERC20Upgradeable(to).balanceOf(recipient) - balanceBefore;
    }
}
