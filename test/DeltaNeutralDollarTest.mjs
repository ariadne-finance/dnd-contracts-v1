import fs from 'fs';
import chai from 'chai';
import withinPercent from '../utils/chai-percent.js';
import { takeSnapshot, setBalance } from '@nomicfoundation/hardhat-network-helpers';
import chalk from 'chalk';

const ONE_ETHER = 1n * 10n ** 18n;
chai.use(withinPercent);
const expect = chai.expect;

const ADDRESSES_PROVIDER = '0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb'; // optimism and arbitrum

const WETH_OPTIMISM = '0x4200000000000000000000000000000000000006'; // WETH, optimism
const WSTETH_ARBITRUM = '0x5979D7b546E38E414F7E9822514be443A4800529'; // wstETH, arbitrum

const FLAGS_DEPOSIT_PAUSED  = 1 << 1;
const FLAGS_WITHDRAW_PAUSED = 1 << 2;

const ERROR_OPERATION_DISABLED_BY_FLAGS = 'DND-01';
const ERROR_ONLY_FLASHLOAN_LENDER = 'DND-02';
const ERROR_INCORRECT_FLASHLOAN_TOKEN_RECEIVED = 'DND-03';
const ERROR_UNKNOWN_FLASHLOAN_MODE = 'DND-04';
const ERROR_INCORRECT_DEPOSIT_OR_WITHDRAWAL_AMOUNT = 'DND-05';
const ERROR_CONTRACT_NOT_READY_FOR_WITHDRAWAL = 'DND-06';
const ERROR_POSITION_CLOSED = 'DND-07';
const ERROR_POSITION_UNCHANGED = 'DND-08';
const ERROR_IMPOSSIBLE_MODE = 'DND-09';

describe("DeltaNeutralDollar", function() {
  let snapshot, initialSnapshot;

  let WETH;
  let isOptimism;

  let myAccount, secondAccount, ownerAccount, swapEmulatorCustodian, liquidatorAccount, impersonatorUsdc, impersonatorWethBridge;
  let usdc, weth;
  let deltaNeutralDollar;
  let swapHelper;
  let pool;
  let mockedOracle;

  let wethPriceReal
  let wethPrice;
  let usdcPrice;

  let wethVariableDebtToken;
  let usdcAToken;

  before(async () => {
    const optimismWethCode = await ethers.provider.getCode(WETH_OPTIMISM);
    isOptimism = optimismWethCode.length > 2;
    console.log("Running on", isOptimism ? "optimism" : "arbitrum");

    WETH = isOptimism ? WETH_OPTIMISM : WSTETH_ARBITRUM;

    initialSnapshot = await takeSnapshot();

    [ myAccount, secondAccount, ownerAccount, swapEmulatorCustodian, liquidatorAccount ] = await hre.ethers.getSigners();

    impersonatorUsdc = await ethers.getImpersonatedSigner(isOptimism ? '0xEbe80f029b1c02862B9E8a70a7e5317C06F62Cae' : '0x5bdf85216ec1e38D6458C870992A69e38e03F7Ef');
    await setBalance(impersonatorUsdc.address, ONE_ETHER);

    const addressProvider = await ethers.getContractAt('IPoolAddressesProvider', ADDRESSES_PROVIDER);

    const SwapHelper = await ethers.getContractFactory('SwapHelperEmulator');
    const DeltaNeutralDollar = await ethers.getContractFactory('DeltaNeutralDollar');
    const MockAaveOracle = await ethers.getContractFactory('MockAaveOracle');

    [ mockedOracle, swapHelper, deltaNeutralDollar ] = await Promise.all([
      MockAaveOracle.deploy(await addressProvider.getPriceOracle()),
      SwapHelper.deploy(swapEmulatorCustodian.address, WETH),
      DeltaNeutralDollar.deploy()
    ]);

    await Promise.all([
      mockedOracle.waitForDeployment(),
      swapHelper.waitForDeployment(),
      deltaNeutralDollar.waitForDeployment()
    ]);

    const settings = {
      swapHelper: await swapHelper.getAddress(),

      minAmountToChangePositionBase: 17n * 10n ** 8n,

      minEthToDeposit: 10n ** 18n / 100n, // 0.01 ETH
      minAmountToWithdraw: 10n ** 8n, // 1 DND

      additionalLtvDistancePercent: 10,
      positionSizePercent: 100,
      flags: 0,
      minRebalancePercent: 5,
    };

    await deltaNeutralDollar.initialize(
      8,
      "DNH",
      "Delta Neutral Dollar",
      isOptimism ? '0x7F5c764cBc14f9669B88837ca1490cCa17c31607' : '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8',
      WETH,
      '0xBA12222222228d8Ba445958a75a0704d566BF2C8', // balancer vault
      ADDRESSES_PROVIDER,
      settings
    );

    await deltaNeutralDollar.transferOwnership(ownerAccount.address);

    usdc = await ethers.getContractAt('IERC20MetadataUpgradeable', await deltaNeutralDollar.stableToken());

    if (isOptimism) {
      weth = await ethers.getContractAt('IERC20MetadataUpgradeable', await deltaNeutralDollar.ethToken());

    } else {
      const abi = JSON.parse(fs.readFileSync('./test/WETHArbitrum.json'));
      weth = new ethers.Contract(await deltaNeutralDollar.ethToken(), abi, myAccount);

      const bridge = await weth.bridge();

      impersonatorWethBridge = await ethers.getImpersonatedSigner(bridge);
      await setBalance(impersonatorWethBridge.address, ONE_ETHER);
    }

    pool = await ethers.getContractAt('IPool', await addressProvider.getPool());

    await Promise.all([
      weth.approve(await deltaNeutralDollar.getAddress(), 2n ** 256n - 1n),
      getEth(myAccount, ONE_ETHER * 2n)
    ]);

    // prepare swapEmulator custodian
    {
      await Promise.all([
        getEth(swapEmulatorCustodian, 10n * ONE_ETHER),

        usdc.connect(impersonatorUsdc).transfer(await swapEmulatorCustodian.getAddress(), 10000n * 10n ** 6n),

        weth.connect(swapEmulatorCustodian).approve(await swapHelper.getAddress(), 2n**256n-1n),
        usdc.connect(swapEmulatorCustodian).approve(await swapHelper.getAddress(), 2n**256n-1n)
      ]);
    }

    // prepare liquidatorAccount
    {
      await Promise.all([
        getEth(liquidatorAccount, 10n * ONE_ETHER),

        usdc.connect(liquidatorAccount).approve(await pool.getAddress(), 2n ** 256n - 1n),
        weth.connect(liquidatorAccount).approve(await pool.getAddress(), 2n ** 256n - 1n)
      ]);
    }

    // prepare mock oracle
    {
      const addressProviderOwner = await (await ethers.getContractAt('OwnableUpgradeable', await addressProvider.getAddress())).owner();
      const impersonatorOwner = await ethers.getImpersonatedSigner(addressProviderOwner);
      await setBalance(await impersonatorOwner.getAddress(), ONE_ETHER);
      await addressProvider.connect(impersonatorOwner).setPriceOracle(await mockedOracle.getAddress());

      wethPriceReal = await mockedOracle.getAssetPrice(await weth.getAddress());

      await mockedOracle.setOverridePrice(await weth.getAddress(), 2000n * 10n**8n);

      wethPrice = await mockedOracle.getAssetPrice(await weth.getAddress());
      usdcPrice = await mockedOracle.getAssetPrice(await usdc.getAddress());
      console.log('eth price', formatBaseInUSDC(wethPriceReal, usdcPrice), '->', formatBaseInUSDC(wethPrice, usdcPrice));
    }

    // prepare aave tokens
    {
      const poolDataProvider = await ethers.getContractAt('IPoolDataProvider', await addressProvider.getPoolDataProvider());

      let reserveTokenAddresses = await poolDataProvider.getReserveTokensAddresses(await weth.getAddress());
      wethVariableDebtToken = await ethers.getContractAt('IERC20MetadataUpgradeable', reserveTokenAddresses.variableDebtTokenAddress);

      reserveTokenAddresses = await poolDataProvider.getReserveTokensAddresses(await usdc.getAddress());
      usdcAToken = await ethers.getContractAt('IERC20MetadataUpgradeable', reserveTokenAddresses.aTokenAddress);
    }

    snapshot = await takeSnapshot();
  });

  after(async () => initialSnapshot.restore());

  // beforeEach(async () => await getEth(myAccount, ONE_ETHER * 2n));

  afterEach("Revert snapshot after test", async () => {
    await snapshot.restore();
    snapshot = await takeSnapshot();
  });

  async function getEth(account, amount) {
    if (isOptimism) {
      return await account.sendTransaction({
        to: await weth.getAddress(),
        value: amount
      });
    }

    return await weth.connect(impersonatorWethBridge).bridgeMint(account.address, amount);
  }

  function formatBaseInUSDC(v, usdcPrice) {
    const baseValue = parseFloat(ethers.formatUnits(v, 8)).toFixed(2);

    if (usdcPrice >= 99000000n && usdcPrice <= 1_0100_0000n) {
      return chalk.yellow(baseValue);
    }

    const usdValue = parseFloat(ethers.formatUnits(v * 10n ** 8n / usdcPrice, 8)).toFixed(2);

    return chalk.yellow(baseValue) + ' aka ' + chalk.yellow(usdValue) + ' USDC';
  }

  function formatDecimals(v, d) {
    if (v >= BigInt(Number.MAX_SAFE_INTEGER) * 10n ** BigInt(d)) {
      return '∞';
    }

    return parseFloat(ethers.formatUnits(v, d));
  }

  async function log(title, originalWethPrice, address) {
    address ||= await deltaNeutralDollar.getAddress();

    console.log();
    console.log("=== %s ===", title);

    const userData = await pool.getUserAccountData(address);

    const wethPrice = await mockedOracle.getAssetPrice(await weth.getAddress());
    const usdcPrice = await mockedOracle.getAssetPrice(await usdc.getAddress());
    const netBase = userData.totalCollateralBase - userData.totalDebtBase;

    const ethPriceDiff = Number(wethPrice - originalWethPrice) / Number(originalWethPrice) * 100;

    console.log('                  eth price', formatBaseInUSDC(wethPrice, usdcPrice), chalk.blue(ethPriceDiff.toFixed(1)) + '%');
    console.log();

    const formattedHealthFactor = formatDecimals(userData.healthFactor, 18);
    const healthFactorString = '               healthFactor ' + formattedHealthFactor;

    if (userData.healthFactor <= ONE_ETHER / 100n * 101n) {
      console.log(chalk.red(healthFactorString));
    } else {
      console.log(healthFactorString);
    }

    console.log();
    console.log('       availableBorrowsBase', formatBaseInUSDC(userData.availableBorrowsBase, usdcPrice));
    console.log('        totalCollateralBase', formatBaseInUSDC(userData.totalCollateralBase, usdcPrice));
    console.log('            totalCollateral', formatDecimals(await usdcAToken.balanceOf(await deltaNeutralDollar.getAddress()), 6), 'USDC');
    console.log('              totalDebtBase', formatBaseInUSDC(userData.totalDebtBase, usdcPrice));
    console.log('                  totalDebt', formatDecimals(await wethVariableDebtToken.balanceOf(await deltaNeutralDollar.getAddress()), 18), 'ETH');
    console.log('                    netBase', formatBaseInUSDC(netBase, usdcPrice));

    const wethBalance = await weth.balanceOf(address);
    const wethBalanceBase = wethPrice * wethBalance / ONE_ETHER;
    console.log('               weth balance', formatDecimals(wethBalance, 18), 'ETH aka', formatBaseInUSDC(wethBalanceBase, usdcPrice));

    const usdcBalanceOfBase = (await usdc.balanceOf(await deltaNeutralDollar.getAddress())) * 10n ** 2n;
    if (usdcBalanceOfBase > 0n) {
      console.log('               usdc balance', chalk.blue(formatBaseInUSDC(usdcBalanceOfBase, usdcPrice)));
    }

    const totalBase = wethBalanceBase + netBase + usdcBalanceOfBase;
    console.log(chalk.bold('                      total', chalk.blue(formatBaseInUSDC(totalBase, usdcPrice))));

    const diffToOriginalEthPrice = Number(totalBase - originalWethPrice) / Number(originalWethPrice) * 100;
    console.log('       diff to original eth', chalk.blue(diffToOriginalEthPrice.toFixed(1)) + '%');
    console.log();
  }

  async function liquidate(address, collateral, debt) {
    const userData = await pool.getUserAccountData(address);
    if (userData.healthFactor > 1n * 10n ** 18n) {
      console.log("=== Failed to liquidate as health factor >= 1 ===");
      console.log();
      return false;
    }

    await usdc.connect(impersonatorUsdc).transfer(liquidatorAccount.address, 7000n * 10n ** 6n);

    collateral ||= weth;
    debt ||= usdc;

    const tr = await (await pool.connect(liquidatorAccount).liquidationCall(
      await collateral.getAddress(),
      await debt.getAddress(),
      address,
      2n ** 256n - 1n,
      false
    )).wait();

    const liquidationCallArgs = tr.logs.find(e => e.eventName == 'LiquidationCall').args.toObject();

    console.log();
    console.log("=== Liquidated ===");

    console.log(`    liquidation debtToCover`, ethers.formatUnits(liquidationCallArgs.debtToCover, await debt.decimals()), await debt.symbol());
    console.log(` liquidatedCollateralAmount`, ethers.formatUnits(liquidationCallArgs.liquidatedCollateralAmount, await collateral.decimals()), await collateral.symbol());

    return true;
  }

  it("open position", async () => {
    await deltaNeutralDollar.deposit(ONE_ETHER);

    expect(await deltaNeutralDollar.balanceOf(myAccount.address)).to.be.withinPercent(wethPrice, 1);
    expect(await deltaNeutralDollar.totalBalance()).to.be.withinPercent(wethPrice, 1);

    let diff = await deltaNeutralDollar.calculateRequiredPositionChange();
    expect(diff.toObject()).to.deep.equal({ collateralChangeBase: 0n, debtChangeBase: 0n });
  });

  it("eth price down", async () => {
    await deltaNeutralDollar.deposit(ONE_ETHER);

    await mockedOracle.setOverridePrice(await weth.getAddress(), wethPrice / 100n * 93n);

    expect(await deltaNeutralDollar.balanceOf(myAccount.address)).to.be.withinPercent(wethPrice, 1);

    let diff = await deltaNeutralDollar.calculateRequiredPositionChange();
    expect(diff.debtChangeBase).to.be.gt(0);
    expect(diff.collateralChangeBase).to.be.eq(0);

    await deltaNeutralDollar.rebalance();

    expect(await deltaNeutralDollar.balanceOf(myAccount.address)).to.be.withinPercent(wethPrice, 1);

    diff = await deltaNeutralDollar.calculateRequiredPositionChange();
    expect(diff.toObject()).to.deep.equal({ collateralChangeBase: 0n, debtChangeBase: 0n });
  });

  it("eth price up", async () => {
    await deltaNeutralDollar.deposit(ONE_ETHER);

    await mockedOracle.setOverridePrice(await weth.getAddress(), wethPrice / 100n * 103n);

    expect(await deltaNeutralDollar.balanceOf(myAccount.address)).to.be.withinPercent(wethPrice, 1);

    let diff = await deltaNeutralDollar.calculateRequiredPositionChange();
    expect(diff.debtChangeBase).to.be.lt(0);
    expect(diff.collateralChangeBase).to.be.eq(0);

    await deltaNeutralDollar.rebalance();

    expect(await deltaNeutralDollar.balanceOf(myAccount.address)).to.be.withinPercent(wethPrice, 1);

    diff = await deltaNeutralDollar.calculateRequiredPositionChange();
    expect(diff.toObject()).to.deep.equal({ collateralChangeBase: 0n, debtChangeBase: 0n });
  });

  it("eth price up then price down", async () => {
    await deltaNeutralDollar.deposit(ONE_ETHER);

    await mockedOracle.setOverridePrice(await weth.getAddress(), wethPrice / 100n * 103n);

    expect(await deltaNeutralDollar.balanceOf(myAccount.address)).to.be.withinPercent(wethPrice, 1);

    await deltaNeutralDollar.rebalance();
    expect(await deltaNeutralDollar.balanceOf(myAccount.address)).to.be.withinPercent(wethPrice, 1);

    await mockedOracle.setOverridePrice(await weth.getAddress(), wethPrice / 100n * 97n);

    await deltaNeutralDollar.rebalance();
    expect(await deltaNeutralDollar.balanceOf(myAccount.address)).to.be.withinPercent(wethPrice, 1);
    expect(await deltaNeutralDollar.totalBalance()).to.be.withinPercent(wethPrice, 1);
  });

  it("eth price down 2x stepwise", async () => {
    await deltaNeutralDollar.deposit(ONE_ETHER);

    for (let percent = 93; percent >= 51; percent -= 7) {
      console.log(`eth price at ${percent}%`);
      await mockedOracle.setOverridePrice(await weth.getAddress(), wethPrice / 100n * BigInt(percent));
      await deltaNeutralDollar.rebalance();
      expect(await deltaNeutralDollar.balanceOf(myAccount.address)).to.be.withinPercent(wethPrice, 1);
    }

    await deltaNeutralDollar.connect(ownerAccount).closePosition();

    const wethPriceAtTheEnd = await mockedOracle.getAssetPrice(await weth.getAddress());
    const balance = await weth.balanceOf(await deltaNeutralDollar.getAddress());
    const balanceInBase = balance * wethPriceAtTheEnd / 10n**18n;

    expect(balanceInBase).to.be.withinPercent(wethPrice, 1.1);
  });

  it("eth price up 2x stepwise", async () => {
    await deltaNeutralDollar.deposit(ONE_ETHER);

    for (let percent = 107; percent <= 198; percent += 7) {
      console.log(`eth price at ${percent}%`);
      await mockedOracle.setOverridePrice(await weth.getAddress(), wethPrice / 100n * BigInt(percent));
      await deltaNeutralDollar.rebalance();
      expect(await deltaNeutralDollar.balanceOf(myAccount.address)).to.be.withinPercent(wethPrice, 1);
    }

    await deltaNeutralDollar.connect(ownerAccount).closePosition();

    const wethPriceAtTheEnd = await mockedOracle.getAssetPrice(await weth.getAddress());
    const balance = await weth.balanceOf(await deltaNeutralDollar.getAddress());
    const balanceInBase = balance * wethPriceAtTheEnd / 10n**18n;

    expect(balanceInBase).to.be.withinPercent(wethPrice, 1.1);
  });

  it("deposit twice", async () => {
    await deltaNeutralDollar.deposit(ONE_ETHER);
    await deltaNeutralDollar.deposit(ONE_ETHER);

    expect(await deltaNeutralDollar.balanceOf(myAccount.address)).to.be.withinPercent(wethPrice * 2n, 2);
    expect(await deltaNeutralDollar.totalBalance()).to.be.withinPercent(wethPrice * 2n, 1);

    let diff = await deltaNeutralDollar.calculateRequiredPositionChange();
    expect(diff.toObject()).to.deep.equal({ collateralChangeBase: 0n, debtChangeBase: 0n });
  });

  it("deposit twice with a huge price change between deposits", async () => {
    await deltaNeutralDollar.deposit(ONE_ETHER);

    await mockedOracle.setOverridePrice(await weth.getAddress(), wethPrice / 100n * 96n);

    await deltaNeutralDollar.rebalance();

    await getEth(myAccount, ONE_ETHER * 1n);

    await deltaNeutralDollar.deposit(ONE_ETHER * 2n);

    const expectedBalanceBase = wethPrice + (wethPrice * 2n / 100n * 96n); // three eth, out of which two are deposited on diff price

    expect(await deltaNeutralDollar.balanceOf(myAccount.address)).to.be.withinPercent(expectedBalanceBase, 1);

    expect(await deltaNeutralDollar.totalBalance()).to.be.withinPercent(expectedBalanceBase, 1);

    let diff = await deltaNeutralDollar.calculateRequiredPositionChange();
    expect(diff.toObject()).to.deep.equal({ collateralChangeBase: 0n, debtChangeBase: 0n });
  });

  it("withdraw almost everything", async () => {
    await deltaNeutralDollar.deposit(ONE_ETHER);

    // burn to zero
    await weth.transfer(liquidatorAccount.address, await weth.balanceOf(myAccount.address));

    const myBalanceBefore = await deltaNeutralDollar.balanceOf(myAccount.address);
    await deltaNeutralDollar.withdraw(myBalanceBefore / 100n * 79n, false);

    let diff = await deltaNeutralDollar.calculateRequiredPositionChange();
    expect(diff.toObject()).to.deep.equal({ collateralChangeBase: 0n, debtChangeBase: 0n });

    // about 79% has been withdrawn, so 21% must be left.
    expect(await deltaNeutralDollar.balanceOf(myAccount.address)).to.be.withinPercent(myBalanceBefore / 100n * 21n, 2);
    expect(await deltaNeutralDollar.totalBalance()).to.be.withinPercent(myBalanceBefore / 100n * 21n, 2);
    expect(await deltaNeutralDollar.totalSupply()).to.be.withinPercent(myBalanceBefore / 100n * 21n, 2); // because for a single user it's the same as totalBalance
    expect(await weth.balanceOf(myAccount.address)).to.be.withinPercent(ONE_ETHER / 100n * 79n, 2);
  });

  it("withdraw in stable", async () => {
    await deltaNeutralDollar.deposit(ONE_ETHER);

    // burn to zero
    await usdc.transfer(liquidatorAccount.address, await usdc.balanceOf(myAccount.address));

    const myBalanceBefore = await deltaNeutralDollar.balanceOf(myAccount.address);
    await deltaNeutralDollar.withdraw(myBalanceBefore / 2n, true);

    expect(await usdc.balanceOf(myAccount.address)).to.be.withinPercent(wethPrice / 2n / 10n ** 2n, 2);
  });

  it("withdraw must emit events", async () => {
    await deltaNeutralDollar.deposit(ONE_ETHER);

    const myBalanceBefore = await deltaNeutralDollar.balanceOf(myAccount.address);
    await deltaNeutralDollar.withdraw(myBalanceBefore / 4n, true);

    function quarterOfEth(x) {
      const QUARTER = ONE_ETHER / 4n;
      return x >= QUARTER / 100n * 98n && x <= QUARTER / 100n * 102n;
    }

    function quarterOfEthInStable(x) {
      const quarter = wethPrice / 4n / 10n ** 2n;
      return x >= quarter / 100n * 98n && x <= quarter / 100n * 102n;
    }

    await expect(deltaNeutralDollar.withdraw(myBalanceBefore / 4n, true)).to.emit(deltaNeutralDollar, "Withdraw").withArgs(myBalanceBefore / 4n, quarterOfEth, quarterOfEthInStable);

    await expect(deltaNeutralDollar.withdraw(myBalanceBefore / 4n, false)).to.emit(deltaNeutralDollar, "Withdraw").withArgs(myBalanceBefore / 4n, quarterOfEth, 0);
  });

  it("deposit must emit events", async () => {
    function correctBaseAmount(x) {
      return x >= (wethPrice / 100n * 98n) && x <= (wethPrice / 100n * 102n);
    }

    await expect(deltaNeutralDollar.deposit(ONE_ETHER)).to.emit(deltaNeutralDollar, "Deposit").withArgs(correctBaseAmount, ONE_ETHER);
  });

  it("transfer tokens", async () => {
    await deltaNeutralDollar.deposit(ONE_ETHER);
    await deltaNeutralDollar.transfer(secondAccount.address, await deltaNeutralDollar.balanceOf(myAccount.address));

    // burn to zero
    await weth.connect(secondAccount).transfer(swapEmulatorCustodian.address, await weth.balanceOf(secondAccount.address));

    const secondBalanceBefore = await deltaNeutralDollar.balanceOf(secondAccount.address);
    expect(secondBalanceBefore).to.be.withinPercent(wethPrice, 1.1);

    await expect(deltaNeutralDollar.withdraw(1000000000, false)).to.be.revertedWith('ERC20: burn amount exceeds balance');

    await deltaNeutralDollar.connect(secondAccount).withdraw(secondBalanceBefore / 2n, false);

    expect(await weth.balanceOf(secondAccount.address)).to.be.withinPercent(ONE_ETHER / 2n, 1.1);
  });

  it("withdraw more than balance", async () => {
    await deltaNeutralDollar.deposit(ONE_ETHER);
    const myBalance = await deltaNeutralDollar.balanceOf(myAccount.address);
    await expect(deltaNeutralDollar.withdraw(myBalance + 1n, false)).to.be.revertedWith('ERC20: burn amount exceeds balance');
  });

  it("only owner can close position", async () => {
    await deltaNeutralDollar.deposit(ONE_ETHER);
    await expect(deltaNeutralDollar.closePosition()).to.be.revertedWith('Ownable: caller is not the owner');
  });

  it("only owner can set settings", async () => {
    const settings = {
      swapHelper: ethers.ZeroAddress,

      minAmountToChangePositionBase: 0,

      minEthToDeposit: 0,
      minAmountToWithdraw: 0,

      additionalLtvDistancePercent: 0,
      positionSizePercent: 0,
      flags: 0,
      minRebalancePercent: 0
    };

    await expect(deltaNeutralDollar.setSettings(settings)).to.be.revertedWith('Ownable: caller is not the owner');
  });

  it("only owner can collect tokens", async () => {
    await deltaNeutralDollar.deposit(ONE_ETHER);
    await expect(deltaNeutralDollar.collectTokens([ await weth.getAddress() ], myAccount.address)).to.be.revertedWith('Ownable: caller is not the owner');
  });

  it("cannot deposit when flags disabled", async () => {
    await deltaNeutralDollar.deposit(ONE_ETHER / 2n);

    const settings = (await deltaNeutralDollar.settings()).toObject();
    settings.flags = FLAGS_DEPOSIT_PAUSED;
    await deltaNeutralDollar.connect(ownerAccount).setSettings(settings);

    await expect(deltaNeutralDollar.deposit(ONE_ETHER / 2n)).to.be.revertedWith(ERROR_OPERATION_DISABLED_BY_FLAGS);

    await deltaNeutralDollar.withdraw(await deltaNeutralDollar.balanceOf(myAccount.address) / 2n, false); // withdraw still allowed
  });

  it("cannot withdraw when flags disabled", async () => {
    await deltaNeutralDollar.deposit(ONE_ETHER / 2n);

    const settings = (await deltaNeutralDollar.settings()).toObject();
    settings.flags = FLAGS_WITHDRAW_PAUSED;
    await deltaNeutralDollar.connect(ownerAccount).setSettings(settings);

    await expect(deltaNeutralDollar.withdraw(100, false)).to.be.revertedWith(ERROR_OPERATION_DISABLED_BY_FLAGS);

    await deltaNeutralDollar.deposit(ONE_ETHER / 2n); // deposit still allowed
  });

  it("close position with balance and emit event", async () => {
    await deltaNeutralDollar.deposit(ONE_ETHER);

    function aboutOneEther(x) {
      return x >= (ONE_ETHER / 100n * 98n) && x <= (ONE_ETHER / 100n * 102n);
    }

    await expect(deltaNeutralDollar.connect(ownerAccount).closePosition()).to.emit(deltaNeutralDollar, 'PositionClose').withArgs(aboutOneEther);

    expect(await weth.balanceOf(await deltaNeutralDollar.getAddress())).to.be.withinPercent(ONE_ETHER, 1.1);
    expect(await usdc.balanceOf(await deltaNeutralDollar.getAddress())).to.be.eq(0);
  });

  it("close position with flash loan and emit event", async () => {
    await deltaNeutralDollar.deposit(ONE_ETHER);

    const before = await weth.balanceOf(myAccount.address);
    await deltaNeutralDollar.connect(ownerAccount).collectTokens([ await weth.getAddress() ], myAccount.address);
    const after = await weth.balanceOf(myAccount.address);
    const diff = after - before - (ONE_ETHER / 2n);

    // force balance less than debt
    await weth.transfer(await deltaNeutralDollar.getAddress(), diff);

    await expect(deltaNeutralDollar.connect(ownerAccount).closePosition()).to.emit(deltaNeutralDollar, 'PositionClose');

    await weth.transfer(await deltaNeutralDollar.getAddress(), ONE_ETHER / 2n);

    expect(await weth.balanceOf(await deltaNeutralDollar.getAddress())).to.be.withinPercent(ONE_ETHER, 1.1);
    expect(await usdc.balanceOf(await deltaNeutralDollar.getAddress())).to.be.eq(0);
  });

  it("disallow deposit after close position", async () => {
    await deltaNeutralDollar.deposit(ONE_ETHER);
    await deltaNeutralDollar.connect(ownerAccount).closePosition();
    await expect(deltaNeutralDollar.deposit(ONE_ETHER)).to.be.revertedWith(ERROR_OPERATION_DISABLED_BY_FLAGS);
  });

  it("eth price down then close position", async () => {
    await deltaNeutralDollar.deposit(ONE_ETHER);

    await mockedOracle.setOverridePrice(await weth.getAddress(), wethPrice / 100n * 96n);

    await deltaNeutralDollar.connect(ownerAccount).closePosition();

    expect(await weth.balanceOf(await deltaNeutralDollar.getAddress())).to.be.withinPercent(ONE_ETHER / 100n * 104n, 1);
    expect(await usdc.balanceOf(await deltaNeutralDollar.getAddress())).to.be.eq(0);
  });

  it("does not rebalance in case of too small percent movement", async () => {
    await deltaNeutralDollar.deposit(ONE_ETHER);

    // mock 4% price difference
    await mockedOracle.setOverridePrice(await weth.getAddress(), wethPrice / 100n * 96n);

    let diff = await deltaNeutralDollar.calculateRequiredPositionChange();
    expect(diff.debtChangeBase).to.be.gt(0);
    expect(diff.collateralChangeBase).to.be.eq(0);

    const settings = (await deltaNeutralDollar.settings()).toObject();
    settings.minRebalancePercent = 41; // 4.1% is larger than 4% price difference we have just mocked
    await deltaNeutralDollar.connect(ownerAccount).setSettings(settings);

    diff = await deltaNeutralDollar.calculateRequiredPositionChange();
    expect(diff.debtChangeBase).to.be.eq(0);
    expect(diff.collateralChangeBase).to.be.eq(0);
  });

  it("eth price up then close position", async () => {
    await deltaNeutralDollar.deposit(ONE_ETHER);

    await mockedOracle.setOverridePrice(await weth.getAddress(), wethPrice / 100n * 104n);

    await deltaNeutralDollar.connect(ownerAccount).closePosition();

    expect(await weth.balanceOf(await deltaNeutralDollar.getAddress())).to.be.withinPercent(ONE_ETHER / 100n * 96n, 1);
    expect(await usdc.balanceOf(await deltaNeutralDollar.getAddress())).to.be.eq(0);
  });

  it("close position then withdraw", async () => {
    await deltaNeutralDollar.deposit(ONE_ETHER);

    // burn to zero
    await weth.transfer(liquidatorAccount.address, await weth.balanceOf(myAccount.address));

    await deltaNeutralDollar.connect(ownerAccount).closePosition();

    const myBalance = await deltaNeutralDollar.balanceOf(myAccount.address);
    await deltaNeutralDollar.withdraw(myBalance, false);

    expect(await weth.balanceOf(await deltaNeutralDollar.getAddress())).to.be.lt(10000000);
    expect(await weth.balanceOf(myAccount.address)).to.be.withinPercent(ONE_ETHER, 1.1);

    expect(await deltaNeutralDollar.totalSupply()).to.be.eq(0);
    expect(await deltaNeutralDollar.totalBalance()).to.be.withinPercent(0, 0.1);
  });

  it("usdc price down", async () => {
    await deltaNeutralDollar.deposit(ONE_ETHER);

    await mockedOracle.setOverridePrice(await usdc.getAddress(), usdcPrice / 100n * 97n);

    expect(await deltaNeutralDollar.balanceOf(myAccount.address)).to.be.withinPercent(wethPrice, 1.1);

    let diff = await deltaNeutralDollar.calculateRequiredPositionChange();
    expect(diff.debtChangeBase).to.be.lt(0);
    expect(diff.collateralChangeBase).to.be.eq(0);

    await deltaNeutralDollar.rebalance();

    expect(await deltaNeutralDollar.balanceOf(myAccount.address)).to.be.withinPercent(wethPrice, 1.1);

    diff = await deltaNeutralDollar.calculateRequiredPositionChange();
    expect(diff.toObject()).to.deep.equal({ collateralChangeBase: 0n, debtChangeBase: 0n });
  });

  it("basic liquidation test, no contracts", async () => {
    await weth.approve(await pool.getAddress(), 2n ** 256n - 1n);
    await pool.supply(await weth.getAddress(), 1n * ONE_ETHER, myAccount.address, 0);

    const { availableBorrowsBase } = await pool.getUserAccountData(myAccount.address);
    const borrowUsdc = availableBorrowsBase * 10n ** 6n / usdcPrice;

    await pool.borrow(await usdc.getAddress(), borrowUsdc, 2, 0, myAccount.address);

    const userDataBefore = await pool.getUserAccountData(myAccount.address);

    await mockedOracle.setOverridePrice(await weth.getAddress(), wethPrice / 100n * 87n);

    expect(await liquidate(myAccount.address, weth, usdc)).to.be.true;

    const userDataAfter = await pool.getUserAccountData(myAccount.address);

    expect(userDataAfter.totalCollateralBase).to.be.lt(userDataBefore.totalCollateralBase);
    expect(userDataAfter.totalDebtBase).to.be.lt(userDataBefore.totalDebtBase);
  });

  it("eth price up then liquidation then close", async () => {
    await deltaNeutralDollar.deposit(ONE_ETHER);

    // burn to zero
    await weth.transfer(liquidatorAccount.address, await weth.balanceOf(myAccount.address));

    const baseBalanceBefore = await deltaNeutralDollar.balanceOf(myAccount.address);
    const totalBalanceBefore = await deltaNeutralDollar.totalBalance();

    const higherWethPrice = wethPrice / 100n * 108n;

    await mockedOracle.setOverridePrice(await weth.getAddress(), higherWethPrice);

    expect(await liquidate(await deltaNeutralDollar.getAddress(), usdc, weth)).to.be.true;

    expect(await deltaNeutralDollar.balanceOf(myAccount.address)).to.be.withinPercent(baseBalanceBefore, 1);
    expect(await deltaNeutralDollar.totalBalance()).to.be.withinPercent(totalBalanceBefore / 100n * 98n, 1); // two percent liquidation hit

    await deltaNeutralDollar.connect(ownerAccount).closePosition();

    expect(await weth.balanceOf(await deltaNeutralDollar.getAddress())).to.be.withinPercent(ONE_ETHER / 100n * 90n, 1); // 2% hit and 8% price difff
    expect(await usdc.balanceOf(await deltaNeutralDollar.getAddress())).to.be.eq(0);
  });

  it("multiple users", async () => {
    await deltaNeutralDollar.deposit(ONE_ETHER);

    // burn to zero
    await weth.transfer(liquidatorAccount.address, await weth.balanceOf(myAccount.address));

    await weth.connect(secondAccount).approve(await deltaNeutralDollar.getAddress(), 2n ** 256n - 1n);

    await getEth(secondAccount, ONE_ETHER * 2n);

    await deltaNeutralDollar.connect(secondAccount).deposit(ONE_ETHER * 2n);

    const myBalanceAfterDeposit = await deltaNeutralDollar.balanceOf(myAccount.address);

    expect(myBalanceAfterDeposit).to.be.withinPercent(wethPrice, 1.1);
    expect(await deltaNeutralDollar.balanceOf(secondAccount.address)).to.be.withinPercent(wethPrice * 2n, 1.1);
    expect(await deltaNeutralDollar.totalBalance()).to.be.withinPercent(wethPrice * 3n, 1.1);

    const totalSupplyBefore = await deltaNeutralDollar.totalSupply();
    expect(totalSupplyBefore).to.be.withinPercent(wethPrice * 3n, 1.1);

    const higherWethPrice = wethPrice / 100n * 103n;
    await mockedOracle.setOverridePrice(await weth.getAddress(), higherWethPrice);

    expect(await deltaNeutralDollar.balanceOf(myAccount.address)).to.be.eq(myBalanceAfterDeposit);
    expect(await deltaNeutralDollar.balanceOf(secondAccount.address)).to.be.withinPercent(wethPrice * 2n, 1.1);
    expect(await deltaNeutralDollar.totalBalance()).to.be.withinPercent(wethPrice * 3n, 1.1);
    expect(await deltaNeutralDollar.totalSupply()).to.be.eq(totalSupplyBefore);

    await deltaNeutralDollar.withdraw(myBalanceAfterDeposit, false);

    expect(await weth.balanceOf(myAccount.address)).to.be.withinPercent(ONE_ETHER / 100n * 97n, 1.1);

    expect(await deltaNeutralDollar.balanceOf(myAccount.address)).to.be.eq(0);
    expect(await deltaNeutralDollar.balanceOf(secondAccount.address)).to.be.withinPercent(wethPrice * 2n, 1.1);
    expect(await deltaNeutralDollar.totalBalance()).to.be.withinPercent(wethPrice * 2n, 1.1);
    expect(await deltaNeutralDollar.totalSupply()).to.be.withinPercent(totalSupplyBefore / 3n * 2n, 1.1);
  });

  it("open position with real swap", async () => {
    const SwapHelper = await ethers.getContractFactory(isOptimism ? 'SwapHelperOptimisticEthereum' : 'SwapHelperArbitrumOneUniswapV3');
    const swapHelper = await SwapHelper.deploy();
    await swapHelper.waitForDeployment();

    const settings = (await deltaNeutralDollar.settings()).toObject();
    settings.swapHelper = await swapHelper.getAddress();

    await deltaNeutralDollar.connect(ownerAccount).setSettings(settings);

    await mockedOracle.setOverridePrice(await weth.getAddress(), wethPriceReal);

    await deltaNeutralDollar.deposit(ONE_ETHER);

    expect(await deltaNeutralDollar.balanceOf(myAccount.address)).to.be.withinPercent(wethPriceReal, 1);
    expect(await deltaNeutralDollar.totalBalance()).to.be.withinPercent(wethPriceReal, 1);

    let diff = await deltaNeutralDollar.calculateRequiredPositionChange();
    expect(diff.toObject()).to.deep.equal({ collateralChangeBase: 0n, debtChangeBase: 0n });
  });

  it("cannot be re-initialized", async () => {
    const settings = {
      swapHelper: '0x7F5c764cBc14f9669B88837ca1490cCa17c31607',
      minAmountToChangePositionBase: 1,
      minEthToDeposit: 1,
      minAmountToWithdraw: 1,
      additionalLtvDistancePercent: 1,
      positionSizePercent: 1,
      flags: 0,
      minRebalancePercent: 1
    };

    await expect(
      deltaNeutralDollar.initialize(
        8,
        "DNH",
        "Delta Neutral Dollar",
        '0xBA12222222228d8Ba445958a75a0704d566BF2C8', // doesn't matter
        '0xBA12222222228d8Ba445958a75a0704d566BF2C8', // doesn't matter
        '0xBA12222222228d8Ba445958a75a0704d566BF2C8', // doesn't matter
        '0xBA12222222228d8Ba445958a75a0704d566BF2C8', // doesn't matter
        settings
      )
    ).to.be.revertedWith('Initializable: contract is already initialized');
  });

  it("only balancer vault can call flash loan", async () => {
    const tokens = [ await usdc.getAddress() ];
    const amounts = [ 1 ];
    const feeAmounts = [ 0 ];
    const userData = ethers.encodeBytes32String('');

    await expect(deltaNeutralDollar.receiveFlashLoan(tokens, amounts, feeAmounts, userData)).to.be.revertedWith(ERROR_ONLY_FLASHLOAN_LENDER);
  });
});
