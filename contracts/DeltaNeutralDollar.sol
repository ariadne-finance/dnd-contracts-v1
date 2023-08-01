/* solhint-disable no-inline-assembly */
pragma solidity ^0.8.19;

import { IERC20MetadataUpgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/IERC20MetadataUpgradeable.sol";
import { ERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import { SignedMathUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/math/SignedMathUpgradeable.sol";
import { MathUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/math/MathUpgradeable.sol";
import { SafeCastUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/math/SafeCastUpgradeable.sol";
import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

import { IVault, IERC20 } from "@balancer-labs/v2-interfaces/contracts/vault/IVault.sol";
import { IFlashLoanRecipient } from "@balancer-labs/v2-interfaces/contracts/vault/IFlashLoanRecipient.sol";

import { IPool } from "@aave/core-v3/contracts/interfaces/IPool.sol";
import { IAaveOracle } from "@aave/core-v3/contracts/interfaces/IAaveOracle.sol";
import { IPoolAddressesProvider } from "@aave/core-v3/contracts/interfaces/IPoolAddressesProvider.sol";
import { IPoolDataProvider } from "@aave/core-v3/contracts/interfaces/IPoolDataProvider.sol";
import { DataTypes } from "@aave/core-v3/contracts/protocol/libraries/types/DataTypes.sol";

// we use solady for safe ERC20 functions because of dependency hell and casting requirement of SafeERC20 in OpenZeppelin; solady has zero deps.
import { SafeTransferLib } from "solady/src/utils/SafeTransferLib.sol";

import { ISwapHelper } from "./ISwapHelper.sol";

uint256 constant AAVE_INTEREST_RATE_MODE_VARIABLE = 2;

uint8 constant FLASH_LOAN_MODE_CLOSE_POSITION = 3;
uint8 constant FLASH_LOAN_MODE_REBALANCE_SUPPLY_AND_BORROW = 4;
uint8 constant FLASH_LOAN_MODE_REBALANCE_REPAY_THEN_WITHDRAW = 5;

uint8 constant FLAGS_POSITION_CLOSED = 1 << 0;
uint8 constant FLAGS_DEPOSIT_PAUSED  = 1 << 1;
uint8 constant FLAGS_WITHDRAW_PAUSED = 1 << 2;

uint256 constant EXTRACT_LTV_FROM_POOL_CONFIGURATION_DATA_MASK = (1 << 16) - 1;

string constant ERROR_OPERATION_DISABLED_BY_FLAGS = "DND-01";
string constant ERROR_ONLY_FLASHLOAN_LENDER = "DND-02";
string constant ERROR_INCORRECT_FLASHLOAN_TOKEN_RECEIVED = "DND-03";
string constant ERROR_UNKNOWN_FLASHLOAN_MODE = "DND-04";
string constant ERROR_INCORRECT_DEPOSIT_OR_WITHDRAWAL_AMOUNT = "DND-05";
string constant ERROR_CONTRACT_NOT_READY_FOR_WITHDRAWAL = "DND-06";
string constant ERROR_POSITION_CLOSED = "DND-07";
string constant ERROR_POSITION_UNCHANGED = "DND-08";
string constant ERROR_IMPOSSIBLE_MODE = "DND-09";

contract DeltaNeutralDollar is IFlashLoanRecipient, ERC20Upgradeable, OwnableUpgradeable, UUPSUpgradeable {
    struct Settings {
        address swapHelper;

        uint256 minAmountToChangePositionBase;

        uint256 minEthToDeposit;
        uint256 minAmountToWithdraw;

        uint8 additionalLtvDistancePercent; // multiplied by 100, so "300" == 3%
        uint8 positionSizePercent;
        uint8 flags;
        uint8 minRebalancePercent; // multiplied by 10, so "10" == 1%
    }

    Settings public settings;

    IPoolAddressesProvider private aaveAddressProvider;
    IVault private balancerVault;

    IERC20 public stableToken;
    IERC20 public ethToken;

    uint8 private _decimals;

    uint8 private stableTokenDecimals;
    uint8 private ethTokenDecimals;
    // 8 bits left here

    event PositionChange(uint256 ethBalance, uint256 totalCollateralBase, uint256 totalDebtBase, int256 collateralChangeBase, int256 debtChangeBase);
    event PositionClose(uint256 finalEthBalance);

    event Withdraw(uint256 amountBase, uint256 amountEth, uint256 amountStable);
    event Deposit(uint256 amountBase, uint256 amountEth);

    function initialize(
        uint8 __decimals,
        string memory symbol,
        string memory name,
        address _stableToken,
        address _ethToken,
        address _balancerVault,
        address _aaveAddressProvider,
        Settings calldata _settings
    )
        public
        initializer
    {
        __ERC20_init(name, symbol);
        __Ownable_init();

        _decimals = __decimals;

        aaveAddressProvider = IPoolAddressesProvider(_aaveAddressProvider);

        settings = _settings;

        balancerVault = IVault(_balancerVault);

        ethToken = IERC20(_ethToken);
        stableToken = IERC20(_stableToken);

        ethTokenDecimals = IERC20MetadataUpgradeable(_ethToken).decimals();
        stableTokenDecimals = IERC20MetadataUpgradeable(_stableToken).decimals();

        _transferOwnership(msg.sender);
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    function implementation() public view returns (address) {
        return _getImplementation();
    }

    modifier whenNotPaused(uint8 whatExactly) {
        require((settings.flags & whatExactly) != whatExactly, ERROR_OPERATION_DISABLED_BY_FLAGS);
        _;
    }

    modifier onlyBalancerVault() {
        require(msg.sender == address(balancerVault), ERROR_ONLY_FLASHLOAN_LENDER);
        _;
    }

    function closePosition() public whenNotPaused(FLAGS_POSITION_CLOSED) onlyOwner {
        settings.flags = settings.flags | FLAGS_POSITION_CLOSED;

        (, , address variableDebtTokenAddress) = poolDataProvider().getReserveTokensAddresses(address(ethToken));

        uint256 debtEth = SafeTransferLib.balanceOf(variableDebtTokenAddress, address(this));
        uint256 balanceEth = SafeTransferLib.balanceOf(address(ethToken), address(this));

        if (balanceEth >= debtEth) { // even if debtEth and/or balanceEth == 0
            if (debtEth > 0) {
                debtRepay(type(uint256).max);
            }

            collateralWithdraw(type(uint).max);
            approveAndSwap(stableToken, ethToken, SafeTransferLib.balanceOf(address(stableToken), address(this)));

        } else {
            uint256 flashLoanEth = debtEth - balanceEth; // there is no underflow risk as it has been checked in the "if" above

            IERC20[] memory tokens = new IERC20[](1);
            tokens[0] = ethToken;

            uint256[] memory amounts = new uint256[](1);
            amounts[0] = flashLoanEth;

            bytes memory userData = abi.encode(FLASH_LOAN_MODE_CLOSE_POSITION);
            balancerVault.flashLoan(IFlashLoanRecipient(this), tokens, amounts, userData);
        }

        emit PositionClose(SafeTransferLib.balanceOf(address(ethToken), address(this)));
    }

    function calculateRequiredPositionChange() public view returns (int256 collateralChangeBase, int256 debtChangeBase) {
        uint256 ethPrice = oracle().getAssetPrice(address(ethToken));
        (uint256 totalCollateralBase, uint256 totalDebtBase, , , , ) = pool().getUserAccountData(address(this));
        return _calculateRequiredPositionChange(totalCollateralBase, totalDebtBase, ethPrice);
    }

    function _calculateRequiredPositionChange(uint256 totalCollateralBase, uint256 totalDebtBase, uint256 ethPrice)
        internal
        view
        returns (
            int256 collateralChangeBase,
            int256 debtChangeBase
        )
    {
        uint256 balanceBase = convertEthToBase(SafeTransferLib.balanceOf(address(ethToken), address(this)), ethPrice);
        uint256 totalAssetsBase = totalCollateralBase - totalDebtBase + balanceBase;

        uint256 idealTotalCollateralBase = MathUpgradeable.mulDiv(totalAssetsBase, settings.positionSizePercent, 100);
        idealTotalCollateralBase = MathUpgradeable.mulDiv(idealTotalCollateralBase, 999, 1000); // shave 0.1% to give room

        // positive means supply; negative: withdraw
        collateralChangeBase = diffBaseAtLeastMinAmountToChangePosition(idealTotalCollateralBase, totalCollateralBase);

        uint256 collateralChangePercent = MathUpgradeable.mulDiv(SignedMathUpgradeable.abs(collateralChangeBase), 1000, idealTotalCollateralBase);
        if (collateralChangePercent < settings.minRebalancePercent) {
            collateralChangeBase = 0;
        }

        uint256 idealLtv = ltv() - (settings.additionalLtvDistancePercent * 10);
        uint256 idealTotalDebtBase = MathUpgradeable.mulDiv(idealTotalCollateralBase, idealLtv, 10000);

        // positive means borrow; negative: repay
        debtChangeBase = diffBaseAtLeastMinAmountToChangePosition(idealTotalDebtBase, totalDebtBase);

        uint256 debtChangePercent = MathUpgradeable.mulDiv(SignedMathUpgradeable.abs(debtChangeBase), 1000, idealTotalDebtBase);
        if (debtChangePercent < settings.minRebalancePercent) {
            debtChangeBase = 0;
        }
    }

    function rebalance() public {
        _rebalance(true);
    }

    function _rebalance(bool shouldRevert) internal {
        if (settings.flags & FLAGS_POSITION_CLOSED == FLAGS_POSITION_CLOSED) {
            if (shouldRevert) {
                revert(ERROR_POSITION_CLOSED);
            }

            return;
        }

        uint256 ethPrice = oracle().getAssetPrice(address(ethToken));

        (uint256 totalCollateralBase, uint256 totalDebtBase, , , , ) = pool().getUserAccountData(address(this));
        (int256 collateralChangeBase, int256 debtChangeBase) = _calculateRequiredPositionChange(totalCollateralBase, totalDebtBase, ethPrice);

        if (collateralChangeBase == 0 && debtChangeBase == 0) {
            if (shouldRevert) {
                revert(ERROR_POSITION_UNCHANGED);
            }

            return;
        }

        if (collateralChangeBase > 0 && debtChangeBase > 0) {
            // console.log("C00 ==> Supply collateral then borrow debt");
            implementSupplyThenBorrow(SignedMathUpgradeable.abs(collateralChangeBase), SignedMathUpgradeable.abs(debtChangeBase), ethPrice);

        } else if (collateralChangeBase < 0 && debtChangeBase < 0) {
            // console.log("C00 ==> Repay debt then withdraw collateral");
            implementRepayThenWithdraw(SignedMathUpgradeable.abs(collateralChangeBase), SignedMathUpgradeable.abs(debtChangeBase), ethPrice);

        } else if (collateralChangeBase > 0 && debtChangeBase < 0) {
            // console.log("C00 ==> Repay debt then supply collateral"); // not found yet
            implementRepay(SignedMathUpgradeable.abs(debtChangeBase), ethPrice);
            implementSupply(SignedMathUpgradeable.abs(collateralChangeBase), ethPrice);

        } else if (collateralChangeBase < 0 && debtChangeBase > 0) {
            // console.log("C00 ==> Borrow debt and withdraw collateral"); // not found yet
            implementWithdraw(SignedMathUpgradeable.abs(collateralChangeBase), oracle().getAssetPrice(address(stableToken)));
            implementBorrow(SignedMathUpgradeable.abs(debtChangeBase), ethPrice);

        } else if (collateralChangeBase == 0 && debtChangeBase > 0) {
            // console.log("C00 ==> Just borrow debt");
            implementBorrow(SignedMathUpgradeable.abs(debtChangeBase), ethPrice);

        } else if (collateralChangeBase == 0 && debtChangeBase < 0) {
            // console.log("C00 ==> Just repay debt");
            implementRepay(SignedMathUpgradeable.abs(debtChangeBase), ethPrice);

        } else if (collateralChangeBase < 0 && debtChangeBase == 0) {
            // console.log("C00 ==> Just withdraw collateral"); // not found yet
            implementWithdraw(SignedMathUpgradeable.abs(collateralChangeBase), oracle().getAssetPrice(address(stableToken)));

        } else if (collateralChangeBase > 0 && debtChangeBase == 0) {
            // console.log("C00 ==> Just supply collateral"); // not found yet
            implementSupply(SignedMathUpgradeable.abs(collateralChangeBase), ethPrice);

        } else {
            revert(ERROR_IMPOSSIBLE_MODE);
        }

        emit PositionChange(
            SafeTransferLib.balanceOf(address(ethToken), address(this)),
            totalCollateralBase,
            totalDebtBase,
            collateralChangeBase,
            debtChangeBase
        );
    }

    function implementSupply(uint256 supplyCollateralBase, uint256 ethPrice) internal {
        uint256 collateralEth = convertBaseToEth(supplyCollateralBase, ethPrice);
        uint256 collateralStable = approveAndSwap(ethToken, stableToken, collateralEth);
        collateralSupply(collateralStable);
    }

    function implementBorrow(uint256 borrowDebtBase, uint256 ethPrice) internal {
        uint256 borrowEth = convertBaseToEth(borrowDebtBase, ethPrice);
        debtBorrow(borrowEth);
    }

    function implementRepayThenWithdraw(uint256 withdrawCollateralBase, uint256 repayDebtBase, uint256 ethPrice) internal {
        uint256 repayDebtEth = convertBaseToEth(repayDebtBase, ethPrice);

        uint256 myBalanceEth = SafeTransferLib.balanceOf(address(ethToken), address(this));

        if (repayDebtEth <= myBalanceEth) {
            implementRepay(repayDebtBase, ethPrice);
            implementWithdraw(withdrawCollateralBase, oracle().getAssetPrice(address(stableToken)));
            return;
        }

        uint256 flashLoanEth = repayDebtEth - myBalanceEth;

        IERC20[] memory tokens = new IERC20[](1);
        tokens[0] = ethToken;

        uint256[] memory amounts = new uint256[](1);
        amounts[0] = flashLoanEth;

        bytes memory userData = abi.encode(FLASH_LOAN_MODE_REBALANCE_REPAY_THEN_WITHDRAW, repayDebtEth, withdrawCollateralBase);
        balancerVault.flashLoan(IFlashLoanRecipient(this), tokens, amounts, userData);
    }

    function implementSupplyThenBorrow(uint256 supplyCollateralBase, uint256 borrowDebtBase, uint256 ethPrice) internal {
        uint256 supplyCollateralEth = convertBaseToEth(supplyCollateralBase, ethPrice);

        uint256 collateralEth = supplyCollateralEth / 5;

        // this actually cannot happen, because base currency in aave is 8 decimals and ether is 18, so smallest
        // aave amount is divisable by 5. But we keep this sanity check anyway.
        assert(collateralEth > 0);

        uint256 collateralStable = approveAndSwap(ethToken, stableToken, collateralEth);
        assert(collateralStable > 0);

        uint256 flashLoanStable = collateralStable * 4;

        uint256 positionStable = collateralStable * 5;

        uint256 borrowDebtEth = convertBaseToEth(borrowDebtBase, ethPrice);

        IERC20[] memory tokens = new IERC20[](1);
        tokens[0] = stableToken;

        uint256[] memory amounts = new uint256[](1);
        amounts[0] = flashLoanStable;

        bytes memory userData = abi.encode(FLASH_LOAN_MODE_REBALANCE_SUPPLY_AND_BORROW, borrowDebtEth, positionStable);
        balancerVault.flashLoan(IFlashLoanRecipient(this), tokens, amounts, userData);
    }

    function implementRepay(uint256 repayDebtBase, uint256 ethPrice) internal {
        uint256 repayDebtEth = convertBaseToEth(repayDebtBase, ethPrice);
        debtRepay(repayDebtEth);
    }

    function implementWithdraw(uint256 withdrawCollateralBase, uint256 stablePrice) internal {
        uint256 withdrawCollateralStable = convertBaseToStable(withdrawCollateralBase, stablePrice);
        assert(withdrawCollateralStable > 0);
        collateralWithdraw(withdrawCollateralStable);
        approveAndSwap(stableToken, ethToken, withdrawCollateralStable);
    }

    function receiveFlashLoanRebalanceSupplyAndBorrow(uint256 flashLoanStable, uint256 positionStable, uint256 borrowDebtEth) internal {
        collateralSupply(positionStable);
        debtBorrow(borrowDebtEth);

        uint256 ethPrice = oracle().getAssetPrice(address(ethToken));
        uint256 stablePrice = oracle().getAssetPrice(address(stableToken));

        uint256 ethToSwap = convertBaseToEth(convertStableToBase(flashLoanStable, stablePrice), ethPrice);

        uint256 feeEth = ISwapHelper(settings.swapHelper).calcSwapFee(address(ethToken), address(stableToken), ethToSwap);
        ethToSwap = ethToSwap + feeEth;

        // at this point we assume we always have enough eth to cover swap fees
        approveAndSwap(ethToken, stableToken, ethToSwap);

        assert(SafeTransferLib.balanceOf(address(stableToken), address(this)) >= flashLoanStable);

        SafeTransferLib.safeTransfer(address(stableToken), address(balancerVault), flashLoanStable);

        uint256 dustStable = SafeTransferLib.balanceOf(address(stableToken), address(this));
        if (dustStable > 0) {
            approveAndSwap(stableToken, ethToken, dustStable);
        }
    }

    function receiveFlashLoanClosePosition(uint256 flashLoanEth) internal {
        // prior to that in closePosition() we have calculated that debt actually exists,
        // so it should NOT revert here with NO_DEBT_OF_SELECTED_TYPE
        debtRepay(type(uint256).max);

        collateralWithdraw(type(uint).max);

        approveAndSwap(stableToken, ethToken, SafeTransferLib.balanceOf(address(stableToken), address(this)));

        SafeTransferLib.safeTransfer(address(ethToken), address(balancerVault), flashLoanEth);
    }

    function receiveFlashLoanRepayThenWithdraw(uint256 flashLoanEth, uint256 repayDebtEth, uint256 withdrawCollateralBase) internal {
        debtRepay(repayDebtEth);

        uint256 withdrawCollateralStable = convertBaseToStable(withdrawCollateralBase, oracle().getAssetPrice(address(stableToken)));
        assert(withdrawCollateralStable > 0);

        collateralWithdraw(withdrawCollateralStable);

        approveAndSwap(stableToken, ethToken, withdrawCollateralStable);

        SafeTransferLib.safeTransfer(address(ethToken), address(balancerVault), flashLoanEth);
    }

    function receiveFlashLoan(IERC20[] memory tokens, uint256[] memory amounts, uint256[] memory feeAmounts, bytes memory userData) external onlyBalancerVault  { // solhint-disable-line no-unused-vars
        (uint8 mode) = abi.decode(userData, (uint8));

        if (mode == FLASH_LOAN_MODE_REBALANCE_SUPPLY_AND_BORROW) {
            require(tokens.length == 1 && tokens[0] == stableToken, ERROR_INCORRECT_FLASHLOAN_TOKEN_RECEIVED);
            (, uint256 borrowDebtEth, uint256 positionStable) = abi.decode(userData, (uint8, uint256, uint256));
            receiveFlashLoanRebalanceSupplyAndBorrow(amounts[0], positionStable, borrowDebtEth);
            return;
        }

        if (mode == FLASH_LOAN_MODE_CLOSE_POSITION) {
            require(tokens.length == 1 && tokens[0] == ethToken, ERROR_INCORRECT_FLASHLOAN_TOKEN_RECEIVED);
            receiveFlashLoanClosePosition(amounts[0]);
            return;
        }

        if (mode == FLASH_LOAN_MODE_REBALANCE_REPAY_THEN_WITHDRAW) {
            require(tokens.length == 1 && tokens[0] == ethToken, ERROR_INCORRECT_FLASHLOAN_TOKEN_RECEIVED);
            (, uint256 repayDebtEth, uint256 withdrawCollateralBase) = abi.decode(userData, (uint8, uint256, uint256));
            receiveFlashLoanRepayThenWithdraw(amounts[0], repayDebtEth, withdrawCollateralBase);
            return;
        }

        require(false, ERROR_UNKNOWN_FLASHLOAN_MODE);
    }

    function _collect(address tokenAddress, address to) internal {
        if (tokenAddress == address(0)) {
            if (address(this).balance == 0) {
                return;
            }

            payable(to).transfer(address(this).balance);

            return;
        }

        SafeTransferLib.safeTransferAll(tokenAddress, to);
    }

    function collectTokens(address[] memory tokens, address to) public onlyOwner {
        for (uint i=0; i<tokens.length; i++) {
            _collect(tokens[i], to);
        }
    }

    function deposit(uint256 amountEth) public whenNotPaused(FLAGS_DEPOSIT_PAUSED) whenNotPaused(FLAGS_POSITION_CLOSED) {
        require(amountEth > 0 && amountEth >= settings.minEthToDeposit, ERROR_INCORRECT_DEPOSIT_OR_WITHDRAWAL_AMOUNT);

        uint256 totalBalanceBaseBefore = totalBalance();

        SafeTransferLib.safeTransferFrom(address(ethToken), msg.sender, address(this), amountEth);
        _rebalance(false);

        uint256 totalBalanceBaseAfter = totalBalance();

        if (totalSupply() == 0) {
            emit Deposit(totalBalanceBaseAfter, amountEth);
            _mint(msg.sender, totalBalanceBaseAfter);
            return;
        }

        uint256 totalBalanceAddedPercent = MathUpgradeable.mulDiv(totalBalanceBaseAfter, 10e18, totalBalanceBaseBefore) - 10e18;

        uint256 minted = MathUpgradeable.mulDiv(totalSupply(), totalBalanceAddedPercent, 10e18);
        assert(minted > 0);

        _mint(msg.sender, minted);

        emit Deposit(minted, amountEth);
    }

    function withdraw(uint256 amount, bool shouldSwapToStable) public whenNotPaused(FLAGS_WITHDRAW_PAUSED) {
        require(amount > 0 && amount >= settings.minAmountToWithdraw, ERROR_INCORRECT_DEPOSIT_OR_WITHDRAWAL_AMOUNT);

        uint256 percent = MathUpgradeable.mulDiv(amount, 10e18, totalSupply());
        assert(percent > 0);

        _burn(msg.sender, amount);

        uint256 amountBase = MathUpgradeable.mulDiv(totalBalance(), percent, 10e18);
        assert(amountBase > 0);

        uint256 ethPrice = oracle().getAssetPrice(address(ethToken));
        uint256 amountEth = convertBaseToEth(amountBase, ethPrice);
        assert(amountEth > 0);

        require(amountEth <= SafeTransferLib.balanceOf(address(ethToken), address(this)), ERROR_CONTRACT_NOT_READY_FOR_WITHDRAWAL);

        uint256 amountStable = 0;

        if (shouldSwapToStable) {
            amountStable = approveAndSwap(ethToken, stableToken, amountEth);
            SafeTransferLib.safeTransfer(address(stableToken), msg.sender, amountStable);
        } else {
            SafeTransferLib.safeTransfer(address(ethToken), msg.sender, amountEth);
        }

        _rebalance(false);

        emit Withdraw(amount, amountEth, amountStable);
    }

    function totalBalance() public view returns (uint256) {
        (uint256 totalCollateralBase, uint256 totalDebtBase, , , ,) = pool().getUserAccountData(address(this));
        uint256 netBase = totalCollateralBase - totalDebtBase;

        uint256 ethPrice = oracle().getAssetPrice(address(ethToken));
        uint256 ethBalanceBase = MathUpgradeable.mulDiv(SafeTransferLib.balanceOf(address(ethToken), address(this)), ethPrice, 10 ** ethTokenDecimals);

        return ethBalanceBase + netBase;
    }

    function debtBorrow(uint256 amount) internal {
        pool().borrow(address(ethToken), amount, AAVE_INTEREST_RATE_MODE_VARIABLE, 0, address(this));
    }

    function debtRepay(uint256 amount) internal {
        possiblyApprove(ethToken, address(pool()), amount);

        pool().repay(address(ethToken), amount, AAVE_INTEREST_RATE_MODE_VARIABLE, address(this));

        SafeTransferLib.safeApprove(address(ethToken), address(pool()), 0);
    }

    function collateralSupply(uint256 amount) internal {
        possiblyApprove(stableToken, address(pool()), amount);

        pool().supply(address(stableToken), amount, address(this), 0);
        pool().setUserUseReserveAsCollateral(address(stableToken), true);

        SafeTransferLib.safeApprove(address(stableToken), address(pool()), 0);
    }

    function collateralWithdraw(uint256 amount) internal {
        pool().withdraw(address(stableToken), amount, address(this));
    }

    function approveAndSwap(IERC20 from, IERC20 to, uint256 amount) internal returns (uint256 swappedAmount) {
        if (amount == 0) {
            return 0;
        }

        possiblyApprove(from, settings.swapHelper, amount);

        swappedAmount = ISwapHelper(settings.swapHelper).swap(address(from), address(to), amount, address(this));

        SafeTransferLib.safeApprove(address(from), settings.swapHelper, 0);
    }

    function possiblyApprove(IERC20 token, address spender, uint256 amount) internal {
        uint256 allowance = token.allowance(address(this), spender);

        if (allowance > 0) {
            SafeTransferLib.safeApprove(address(token), spender, 0);
        }

        if (amount == 0 || allowance > amount) {
            return;
        }

        SafeTransferLib.safeApprove(address(token), spender, amount);
    }

    function diffBaseAtLeastMinAmountToChangePosition(uint256 amountA, uint256 amountB) internal view returns (int256) {
        int256 amountBaseDiff = SafeCastUpgradeable.toInt256(amountA) - SafeCastUpgradeable.toInt256(amountB);
        return (SignedMathUpgradeable.abs(amountBaseDiff) >= settings.minAmountToChangePositionBase) ? amountBaseDiff : int256(0);
    }

    function convertBaseToStable(uint256 amount, uint256 stablePrice) internal view returns (uint256) {
        return MathUpgradeable.mulDiv(amount, 10 ** stableTokenDecimals, stablePrice);
    }

    function convertStableToBase(uint256 amount, uint256 stablePrice) internal view returns (uint256) {
        return MathUpgradeable.mulDiv(amount, stablePrice, 10 ** stableTokenDecimals);
    }

    function convertBaseToEth(uint256 amount, uint256 ethPrice) internal view returns (uint256) {
        return MathUpgradeable.mulDiv(amount, 10 ** ethTokenDecimals, ethPrice);
    }

    function convertEthToBase(uint256 amount, uint256 ethPrice) internal view returns (uint256) {
        return MathUpgradeable.mulDiv(amount, ethPrice, 10 ** ethTokenDecimals);
    }

    /*
    // those are not actually used, but kept in code for posterity

    function ethToStable(uint256 amount, uint256 ethPrice, uint256 stablePrice) internal view returns (uint256) {
        return amount * ethPrice / 10 ** (ethTokenDecimals - stableTokenDecimals) / stablePrice;
    }

    function stableToEth(uint256 amount, uint256 stablePrice, uint256 ethPrice) internal view returns (uint256) {
        return amount * stablePrice * 10 ** (ethTokenDecimals - stableTokenDecimals) / ethPrice;
    }
    */

    function setSettings(Settings calldata _settings) public onlyOwner {
        settings = _settings;
    }

    function ltv() internal view returns (uint256) {
        DataTypes.ReserveConfigurationMap memory poolConfiguration = pool().getConfiguration(address(stableToken));
        return poolConfiguration.data & EXTRACT_LTV_FROM_POOL_CONFIGURATION_DATA_MASK;
    }

    function pool() internal view returns (IPool) {
        return IPool(aaveAddressProvider.getPool());
    }

    function poolDataProvider() internal view returns (IPoolDataProvider) {
        return IPoolDataProvider(aaveAddressProvider.getPoolDataProvider());
    }

    function oracle() internal view returns (IAaveOracle) {
        return IAaveOracle(aaveAddressProvider.getPriceOracle());
    }

    function decimals() public view virtual override returns (uint8) {
        return _decimals;
    }
}
