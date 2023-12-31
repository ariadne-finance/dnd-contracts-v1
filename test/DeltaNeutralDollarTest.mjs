import chai from 'chai';
import withinPercent from '../utils/chai-percent.js';
import { takeSnapshot, setBalance } from '@nomicfoundation/hardhat-network-helpers';
import chalk from 'chalk';

const ONE_ETHER = 1n * 10n ** 18n;
chai.use(withinPercent);
const expect = chai.expect;

const BALANCER_VAULT = '0xBA12222222228d8Ba445958a75a0704d566BF2C8'; // optimism, arbitrum, polygon and base

const AAVE_ADDRESSES_PROVIDER_OPTIMISM_ARBITRUM_POLYGON = '0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb';
const AAVE_ADDRESSES_PROVIDER_BASE = '0xe20fCBdBfFC4Dd138cE8b2E6FBb6CB49777ad64D';

const WSTETH_OPTIMISM = '0x1F32b1c2345538c0c6f582fCB022739c4A194Ebb';
const WSTETH_ARBITRUM = '0x5979D7b546E38E414F7E9822514be443A4800529';
const WSTETH_POLYGON = '0x03b54A6e9a984069379fae1a4fC4dBAE93B3bCCD';
const CBETH_BASE = '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22';

const WETH_OPTIMISM = '0x4200000000000000000000000000000000000006';
const WETH_ARBITRUM = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1';
const WETH_POLYGON = '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619';
const WETH_BASE = '0x4200000000000000000000000000000000000006';

const USDC_OPTIMISM = '0x7F5c764cBc14f9669B88837ca1490cCa17c31607';
const USDC_ARBITRUM = '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8';
const USDC_POLYGON = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
const USDBC_BASE = '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA';

const CONNEXT_OPTIMISM = '0x8f7492DE823025b4CfaAB1D34c58963F2af5DEDA';
const CONNEXT_ARBITRUM = '0xEE9deC2712cCE65174B561151701Bf54b99C24C8';
const CONNEXT_POLYGON = '0x11984dc4465481512eb5b777E44061C158CF2259';

const CONNEXT_DOMAIN_ID_OPTIMISM = 1869640809;
const CONNEXT_DOMAIN_ID_ARBITRUM = 1634886255;
const CONNEXT_DOMAIN_ID_POLYGON = 1886350457;

const USDC_SPONSOR_OPTIMISM = '0xEbe80f029b1c02862B9E8a70a7e5317C06F62Cae';
const USDC_SPONSOR_ARBITRUM = '0x5bdf85216ec1e38D6458C870992A69e38e03F7Ef';
const USDC_SPONSOR_POLYGON = '0x0639556F03714A74a5fEEaF5736a4A64fF70D206';
const USDBC_SPONSOR_BASE = '0x4c80E24119CFB836cdF0a6b53dc23F04F7e652CA';

const WSTETH_SPONSOR_OPTIMISM = '0xc45A479877e1e9Dfe9FcD4056c699575a1045dAA';
const WSTETH_SPONSOR_ARBITRUM = '0x513c7E3a9c69cA3e22550eF58AC1C0088e918FFf';
const WSTETH_SPONSOR_POLYGON = '0xf59036caebea7dc4b86638dfa2e3c97da9fccd40';
const CBETH_SPONSOR_BASE = '0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf';

const WETH_SPONSOR_OPTIMISM = '0xc4d4500326981eacD020e20A81b1c479c161c7EF';
const WETH_SPONSOR_ARBITRUM = '0x0dF5dfd95966753f01cb80E76dc20EA958238C46';
const WETH_SPONSOR_POLYGON = '0xF25212E676D1F7F89Cd72fFEe66158f541246445';
const WETH_SPONSOR_BASE = '0x46e6b214b524310239732d51387075e0e70970bf';

const CHAIN_OPTIMISM = 'optimism';
const CHAIN_ARBITRUM = 'arbitrum';
const CHAIN_POLYGON = 'polygon';
const CHAIN_BASE = 'base';

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
const ERROR_ONLY_ALLOWED_TOKEN = 'DND-10';
const ERROR_ONLY_ALLOWED_DESTINATION_DOMAIN = "DND-11";

describe("DeltaNeutralDollar", function() {
  let snapshot, initialSnapshot;

  let currentChain;

  let usdcSponsorAddress, wstethSponsorAddress, wethSponsorAddress;
  let myAccount, secondAccount, ownerAccount, swapEmulatorCustodian, liquidatorAccount, impersonatorUsdc, impersonatorWsteth, impersonatorWeth;

  let wstethAddress, usdcAddress, wethAddress;
  let usdc, wsteth, weth;
  let aaveAddressesProvider;

  let deltaNeutralDollar;
  let swapHelper;
  let pool;
  let mockedOracle;

  let wstethPriceReal
  let wstethPrice;
  let wethPrice;
  let usdcPrice;

  let wstethVariableDebtToken;
  let usdcAToken;
  let connextAddress;
  let connextDestinationDomain;

  async function detectChain() {
    const [ optimismCode, arbitrumCode, baseCode ] = await Promise.all([
      ethers.provider.getCode(WSTETH_OPTIMISM),
      ethers.provider.getCode(WSTETH_ARBITRUM),
      ethers.provider.getCode(CBETH_BASE)
    ]);

    if (optimismCode.length > 2) {
      currentChain = CHAIN_OPTIMISM;
      connextAddress = CONNEXT_OPTIMISM;
      connextDestinationDomain = CONNEXT_DOMAIN_ID_ARBITRUM;
      wstethAddress = WSTETH_OPTIMISM;
      usdcAddress = USDC_OPTIMISM;
      usdcSponsorAddress = USDC_SPONSOR_OPTIMISM;
      wstethSponsorAddress = WSTETH_SPONSOR_OPTIMISM;
      wethAddress = WETH_OPTIMISM;
      wethSponsorAddress = WETH_SPONSOR_OPTIMISM;
      aaveAddressesProvider = AAVE_ADDRESSES_PROVIDER_OPTIMISM_ARBITRUM_POLYGON;
      return;
    }

    if (arbitrumCode.length > 2) {
      currentChain = CHAIN_ARBITRUM;
      connextAddress = CONNEXT_ARBITRUM;
      connextDestinationDomain = CONNEXT_DOMAIN_ID_POLYGON;
      wstethAddress = WSTETH_ARBITRUM;
      usdcAddress = USDC_ARBITRUM;
      usdcSponsorAddress = USDC_SPONSOR_ARBITRUM;
      wstethSponsorAddress = WSTETH_SPONSOR_ARBITRUM;
      wethAddress = WETH_ARBITRUM;
      wethSponsorAddress = WETH_SPONSOR_ARBITRUM;
      aaveAddressesProvider = AAVE_ADDRESSES_PROVIDER_OPTIMISM_ARBITRUM_POLYGON;
      return;
    }

    if (baseCode.length > 2) {
      currentChain = CHAIN_BASE;
      connextAddress = ethers.ZeroAddress; // is not supported
      connextDestinationDomain = 0; // is not supported
      wstethAddress = CBETH_BASE;
      usdcAddress = USDBC_BASE;
      usdcSponsorAddress = USDBC_SPONSOR_BASE;
      wstethSponsorAddress = CBETH_SPONSOR_BASE;
      wethAddress = WETH_BASE;
      wethSponsorAddress = WETH_SPONSOR_BASE;
      aaveAddressesProvider = AAVE_ADDRESSES_PROVIDER_BASE;
      return;
    }

    currentChain = CHAIN_POLYGON;
    connextAddress = CONNEXT_POLYGON;
    connextDestinationDomain = CONNEXT_DOMAIN_ID_OPTIMISM;
    wstethAddress = WSTETH_POLYGON;
    usdcAddress = USDC_POLYGON;
    usdcSponsorAddress = USDC_SPONSOR_POLYGON;
    wstethSponsorAddress = WSTETH_SPONSOR_POLYGON;
    wethAddress = WETH_POLYGON;
    wethSponsorAddress = WETH_SPONSOR_POLYGON;
    aaveAddressesProvider = AAVE_ADDRESSES_PROVIDER_OPTIMISM_ARBITRUM_POLYGON;
  }

  before(async () => {
    await detectChain();
    console.log(`Running on ${currentChain}`);

    initialSnapshot = await takeSnapshot();

    [ myAccount, secondAccount, ownerAccount, swapEmulatorCustodian, liquidatorAccount ] = await hre.ethers.getSigners();

    impersonatorUsdc = await ethers.getImpersonatedSigner(usdcSponsorAddress);
    await setBalance(impersonatorUsdc.address, ONE_ETHER);

    const addressProvider = await ethers.getContractAt('IPoolAddressesProvider', aaveAddressesProvider);

    const SwapHelper = await ethers.getContractFactory('SwapHelperEmulator');
    const DeltaNeutralDollar = await ethers.getContractFactory('DeltaNeutralDollar');
    const MockAaveOracle = await ethers.getContractFactory('MockAaveOracle');

    [ mockedOracle, swapHelper, deltaNeutralDollar ] = await Promise.all([
      MockAaveOracle.deploy(await addressProvider.getPriceOracle()),
      SwapHelper.deploy(swapEmulatorCustodian.address, wstethAddress, wethAddress, aaveAddressesProvider),
      DeltaNeutralDollar.deploy()
    ]);

    await Promise.all([
      mockedOracle.waitForDeployment(),
      swapHelper.waitForDeployment(),
      deltaNeutralDollar.waitForDeployment()
    ]);

    const settings = {
      swapHelper: await swapHelper.getAddress(),
      connext: connextAddress,

      minAmountToChangePositionBase: 17n * 10n ** 8n,

      minEthToDeposit: 10n ** 18n / 100n, // 0.01 ETH
      maxEthToDeposit: 10n ** 18n * 2n, // 2 ETH

      minAmountToWithdraw: 10n ** 8n, // 1 DND

      additionalLtvDistancePercent: 10,
      positionSizePercent: 100,
      flags: 0,
      minRebalancePercent: 5,
    };

    await deltaNeutralDollar.initialize(
      8,
      "DND",
      "Delta Neutral Dividend",
      usdcAddress,
      wstethAddress,
      BALANCER_VAULT,
      aaveAddressesProvider,
      settings
    );

    await deltaNeutralDollar.transferOwnership(ownerAccount.address);

    usdc = await ethers.getContractAt('IERC20MetadataUpgradeable', await deltaNeutralDollar.stableToken());

    // for optimism and arbitrum we can use .bridge()

    // const abi = JSON.parse(fs.readFileSync('./test/WETHArbitrum.json'));
    // weth = new ethers.Contract(await deltaNeutralDollar.ethToken(), abi, myAccount);
    // const bridge = await weth.bridge();
    // impersonatorWethBridge = await ethers.getImpersonatedSigner(bridge);

    wsteth = await ethers.getContractAt('IERC20MetadataUpgradeable', await deltaNeutralDollar.ethToken());
    weth = await ethers.getContractAt('IERC20MetadataUpgradeable', wethAddress);

    impersonatorWsteth = await ethers.getImpersonatedSigner(wstethSponsorAddress);
    impersonatorWeth = await ethers.getImpersonatedSigner(wethSponsorAddress);

    await setBalance(impersonatorWsteth.address, ONE_ETHER);
    await setBalance(impersonatorWeth.address, ONE_ETHER);

    await deltaNeutralDollar.connect(ownerAccount).setAllowedDepositToken(await weth.getAddress(), true);

    if (currentChain !== CHAIN_BASE) {
      await deltaNeutralDollar.connect(ownerAccount).setAllowedDestinationDomain(CONNEXT_DOMAIN_ID_OPTIMISM, true);
      await deltaNeutralDollar.connect(ownerAccount).setAllowedDestinationDomain(CONNEXT_DOMAIN_ID_ARBITRUM, true);
      await deltaNeutralDollar.connect(ownerAccount).setAllowedDestinationDomain(CONNEXT_DOMAIN_ID_POLYGON, true);
    }

    pool = await ethers.getContractAt('IPool', await addressProvider.getPool());

    await Promise.all([
      weth.approve(await deltaNeutralDollar.getAddress(), 2n ** 256n - 1n),
      wsteth.approve(await deltaNeutralDollar.getAddress(), 2n ** 256n - 1n),
      getWsteth(myAccount, ONE_ETHER * 2n)
    ]);

    // prepare swapEmulator custodian
    {
      await Promise.all([
        getWsteth(swapEmulatorCustodian, 10n * ONE_ETHER),
        weth.connect(impersonatorWeth).transfer(await swapEmulatorCustodian.getAddress(), 10n * ONE_ETHER),
        usdc.connect(impersonatorUsdc).transfer(await swapEmulatorCustodian.getAddress(), 10000n * 10n ** 6n),

        wsteth.connect(swapEmulatorCustodian).approve(await swapHelper.getAddress(), 2n**256n-1n),
        usdc.connect(swapEmulatorCustodian).approve(await swapHelper.getAddress(), 2n**256n-1n),
        weth.connect(swapEmulatorCustodian).approve(await swapHelper.getAddress(), 2n**256n-1n)
      ]);
    }

    // prepare liquidatorAccount
    {
      await Promise.all([
        getWsteth(liquidatorAccount, 10n * ONE_ETHER),

        usdc.connect(liquidatorAccount).approve(await pool.getAddress(), 2n ** 256n - 1n),
        wsteth.connect(liquidatorAccount).approve(await pool.getAddress(), 2n ** 256n - 1n)
      ]);
    }

    // prepare mock oracle
    {
      const addressProviderOwner = await (await ethers.getContractAt('OwnableUpgradeable', await addressProvider.getAddress())).owner();
      const impersonatorOwner = await ethers.getImpersonatedSigner(addressProviderOwner);
      await setBalance(await impersonatorOwner.getAddress(), ONE_ETHER);
      await addressProvider.connect(impersonatorOwner).setPriceOracle(await mockedOracle.getAddress());

      wstethPriceReal = await mockedOracle.getAssetPrice(await wsteth.getAddress());

      await mockedOracle.setOverridePrice(await wsteth.getAddress(), 2000n * 10n**8n);
      await mockedOracle.setOverridePrice(await weth.getAddress(), 1800n * 10n**8n);

      wstethPrice = await mockedOracle.getAssetPrice(await wsteth.getAddress());
      wethPrice = await mockedOracle.getAssetPrice(await weth.getAddress());
      usdcPrice = await mockedOracle.getAssetPrice(await usdc.getAddress());
      console.log('eth price', formatBaseInUSDC(wstethPriceReal, usdcPrice), '->', formatBaseInUSDC(wstethPrice, usdcPrice));
    }

    // prepare aave tokens
    {
      const poolDataProvider = await ethers.getContractAt('IPoolDataProvider', await addressProvider.getPoolDataProvider());

      let reserveTokenAddresses = await poolDataProvider.getReserveTokensAddresses(await wsteth.getAddress());
      wstethVariableDebtToken = await ethers.getContractAt('IERC20MetadataUpgradeable', reserveTokenAddresses.variableDebtTokenAddress);

      reserveTokenAddresses = await poolDataProvider.getReserveTokensAddresses(await usdc.getAddress());
      usdcAToken = await ethers.getContractAt('IERC20MetadataUpgradeable', reserveTokenAddresses.aTokenAddress);
    }

    snapshot = await takeSnapshot();
  });

  after(async () => initialSnapshot.restore());

  afterEach("Revert snapshot after test", async () => {
    await snapshot.restore();
    snapshot = await takeSnapshot();
  });

  async function getWsteth(account, amount) {
    return await wsteth.connect(impersonatorWsteth).transfer(account.address, amount);

    // mint function for optimism and arbitrum
    // return await weth.connect(impersonatorWethBridge).bridgeMint(account.address, amount);
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

    const wethPrice = await mockedOracle.getAssetPrice(await wsteth.getAddress());
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
    console.log('                  totalDebt', formatDecimals(await wstethVariableDebtToken.balanceOf(await deltaNeutralDollar.getAddress()), 18), 'ETH');
    console.log('                    netBase', formatBaseInUSDC(netBase, usdcPrice));

    const wethBalance = await wsteth.balanceOf(address);
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

    collateral ||= wsteth;
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

  it("open position in wsteth", async () => {
    await deltaNeutralDollar.deposit(await wsteth.getAddress(), ONE_ETHER);

    expect(await deltaNeutralDollar.balanceOf(myAccount.address)).to.be.withinPercent(wstethPrice, 1);
    expect(await deltaNeutralDollar.totalBalanceBase()).to.be.withinPercent(wstethPrice, 1);

    let diff = await deltaNeutralDollar.calculateRequiredPositionChange();
    expect(diff.toObject()).to.deep.equal({ collateralChangeBase: 0n, debtChangeBase: 0n });
  });

  it("open position in weth", async () => {
    await weth.connect(impersonatorWeth).transfer(myAccount.address, ONE_ETHER);

    await deltaNeutralDollar.deposit(wethAddress, ONE_ETHER);

    expect(await deltaNeutralDollar.balanceOf(myAccount.address)).to.be.withinPercent(wethPrice, 1.1);
    expect(await deltaNeutralDollar.totalBalanceBase()).to.be.withinPercent(wethPrice, 1.1);

    let diff = await deltaNeutralDollar.calculateRequiredPositionChange();
    expect(diff.toObject()).to.deep.equal({ collateralChangeBase: 0n, debtChangeBase: 0n });
  });

  it("eth price down", async () => {
    await deltaNeutralDollar.deposit(await wsteth.getAddress(), ONE_ETHER);

    await mockedOracle.setOverridePrice(await wsteth.getAddress(), wstethPrice / 100n * 93n);

    expect(await deltaNeutralDollar.balanceOf(myAccount.address)).to.be.withinPercent(wstethPrice, 1);

    let diff = await deltaNeutralDollar.calculateRequiredPositionChange();
    expect(diff.debtChangeBase).to.be.gt(0);
    expect(diff.collateralChangeBase).to.be.eq(0);

    await deltaNeutralDollar.rebalance();

    expect(await deltaNeutralDollar.balanceOf(myAccount.address)).to.be.withinPercent(wstethPrice, 1);

    diff = await deltaNeutralDollar.calculateRequiredPositionChange();
    expect(diff.toObject()).to.deep.equal({ collateralChangeBase: 0n, debtChangeBase: 0n });
  });

  it("eth price up", async () => {
    await deltaNeutralDollar.deposit(await wsteth.getAddress(), ONE_ETHER);

    await mockedOracle.setOverridePrice(await wsteth.getAddress(), wstethPrice / 100n * 103n);

    expect(await deltaNeutralDollar.balanceOf(myAccount.address)).to.be.withinPercent(wstethPrice, 1);

    let diff = await deltaNeutralDollar.calculateRequiredPositionChange();
    expect(diff.debtChangeBase).to.be.lt(0);
    expect(diff.collateralChangeBase).to.be.eq(0);

    await deltaNeutralDollar.rebalance();

    expect(await deltaNeutralDollar.balanceOf(myAccount.address)).to.be.withinPercent(wstethPrice, 1);

    diff = await deltaNeutralDollar.calculateRequiredPositionChange();
    expect(diff.toObject()).to.deep.equal({ collateralChangeBase: 0n, debtChangeBase: 0n });
  });

  it("eth price up then price down", async () => {
    await deltaNeutralDollar.deposit(await wsteth.getAddress(), ONE_ETHER);

    await mockedOracle.setOverridePrice(await wsteth.getAddress(), wstethPrice / 100n * 103n);

    expect(await deltaNeutralDollar.balanceOf(myAccount.address)).to.be.withinPercent(wstethPrice, 1);

    await deltaNeutralDollar.rebalance();
    expect(await deltaNeutralDollar.balanceOf(myAccount.address)).to.be.withinPercent(wstethPrice, 1);

    await mockedOracle.setOverridePrice(await wsteth.getAddress(), wstethPrice / 100n * 97n);

    await deltaNeutralDollar.rebalance();
    expect(await deltaNeutralDollar.balanceOf(myAccount.address)).to.be.withinPercent(wstethPrice, 1);
    expect(await deltaNeutralDollar.totalBalanceBase()).to.be.withinPercent(wstethPrice, 1);
  });

  it("eth price down 2x stepwise", async () => {
    await deltaNeutralDollar.deposit(await wsteth.getAddress(), ONE_ETHER);

    for (let percent = 93; percent >= 51; percent -= 7) {
      console.log(`eth price at ${percent}%`);
      await mockedOracle.setOverridePrice(await wsteth.getAddress(), wstethPrice / 100n * BigInt(percent));
      await deltaNeutralDollar.rebalance();
      expect(await deltaNeutralDollar.balanceOf(myAccount.address)).to.be.withinPercent(wstethPrice, 1);
    }

    await deltaNeutralDollar.connect(ownerAccount).closePosition();

    const wethPriceAtTheEnd = await mockedOracle.getAssetPrice(await wsteth.getAddress());
    const balance = await wsteth.balanceOf(await deltaNeutralDollar.getAddress());
    const balanceInBase = balance * wethPriceAtTheEnd / 10n**18n;

    expect(balanceInBase).to.be.withinPercent(wstethPrice, 1.1);
  });

  it("eth price up 2x stepwise", async () => {
    await deltaNeutralDollar.deposit(await wsteth.getAddress(), ONE_ETHER);

    for (let percent = 107; percent <= 198; percent += 7) {
      console.log(`eth price at ${percent}%`);
      await mockedOracle.setOverridePrice(await wsteth.getAddress(), wstethPrice / 100n * BigInt(percent));
      await deltaNeutralDollar.rebalance();
      expect(await deltaNeutralDollar.balanceOf(myAccount.address)).to.be.withinPercent(wstethPrice, 1);
    }

    await deltaNeutralDollar.connect(ownerAccount).closePosition();

    const wethPriceAtTheEnd = await mockedOracle.getAssetPrice(await wsteth.getAddress());
    const balance = await wsteth.balanceOf(await deltaNeutralDollar.getAddress());
    const balanceInBase = balance * wethPriceAtTheEnd / 10n**18n;

    expect(balanceInBase).to.be.withinPercent(wstethPrice, 1.1);
  });

  it("deposit twice", async () => {
    await deltaNeutralDollar.deposit(await wsteth.getAddress(), ONE_ETHER);
    await deltaNeutralDollar.deposit(await wsteth.getAddress(), ONE_ETHER);

    expect(await deltaNeutralDollar.balanceOf(myAccount.address)).to.be.withinPercent(wstethPrice * 2n, 2);
    expect(await deltaNeutralDollar.totalBalanceBase()).to.be.withinPercent(wstethPrice * 2n, 1);

    let diff = await deltaNeutralDollar.calculateRequiredPositionChange();
    expect(diff.toObject()).to.deep.equal({ collateralChangeBase: 0n, debtChangeBase: 0n });
  });

  it("deposit twice with a huge price change between deposits", async () => {
    await deltaNeutralDollar.deposit(await wsteth.getAddress(), ONE_ETHER);

    await mockedOracle.setOverridePrice(await wsteth.getAddress(), wstethPrice / 100n * 96n);

    await deltaNeutralDollar.rebalance();

    await getWsteth(myAccount, ONE_ETHER * 1n);

    await deltaNeutralDollar.deposit(await wsteth.getAddress(), ONE_ETHER * 2n);

    const expectedBalanceBase = wstethPrice + (wstethPrice * 2n / 100n * 96n); // three eth, out of which two are deposited on diff price

    expect(await deltaNeutralDollar.balanceOf(myAccount.address)).to.be.withinPercent(expectedBalanceBase, 1);

    expect(await deltaNeutralDollar.totalBalanceBase()).to.be.withinPercent(expectedBalanceBase, 1);

    let diff = await deltaNeutralDollar.calculateRequiredPositionChange();
    expect(diff.toObject()).to.deep.equal({ collateralChangeBase: 0n, debtChangeBase: 0n });
  });

  it("withdraw almost everything", async () => {
    await deltaNeutralDollar.deposit(await wsteth.getAddress(), ONE_ETHER);

    // burn to zero
    await wsteth.transfer(liquidatorAccount.address, await wsteth.balanceOf(myAccount.address));

    const myBalanceBefore = await deltaNeutralDollar.balanceOf(myAccount.address);
    await deltaNeutralDollar.withdraw(await wsteth.getAddress(), myBalanceBefore / 100n * 75n);

    let diff = await deltaNeutralDollar.calculateRequiredPositionChange();
    expect(diff.toObject()).to.deep.equal({ collateralChangeBase: 0n, debtChangeBase: 0n });

    // about 75% has been withdrawn, so 25% must be left.
    expect(await deltaNeutralDollar.balanceOf(myAccount.address)).to.be.withinPercent(myBalanceBefore / 100n * 25n, 2);
    expect(await deltaNeutralDollar.totalBalanceBase()).to.be.withinPercent(myBalanceBefore / 100n * 25n, 2);
    expect(await deltaNeutralDollar.totalSupply()).to.be.withinPercent(myBalanceBefore / 100n * 25n, 2); // because for a single user it's the same as totalBalance
    expect(await wsteth.balanceOf(myAccount.address)).to.be.withinPercent(ONE_ETHER / 100n * 75n, 2);
  });

  it("withdraw in stable", async () => {
    await deltaNeutralDollar.deposit(await wsteth.getAddress(), ONE_ETHER);

    // burn to zero
    await usdc.transfer(liquidatorAccount.address, await usdc.balanceOf(myAccount.address));

    const myBalanceBefore = await deltaNeutralDollar.balanceOf(myAccount.address);
    await deltaNeutralDollar.withdraw(await usdc.getAddress(), myBalanceBefore / 2n);

    expect(await usdc.balanceOf(myAccount.address)).to.be.withinPercent(wstethPrice / 2n / 10n ** 2n, 2);
  });

  it("withdraw in disallowed token", async () => {
    await deltaNeutralDollar.deposit(await wsteth.getAddress(), ONE_ETHER);
    const myBalance = await deltaNeutralDollar.balanceOf(myAccount.address);
    await expect(deltaNeutralDollar.withdraw(ethers.ZeroAddress, myBalance / 2n)).to.be.revertedWith(ERROR_ONLY_ALLOWED_TOKEN);
  });

  it("withdraw to connext", async () => {
    if (currentChain == CHAIN_BASE) {
      console.log("connext not supported on base");
      return;
    }

    await deltaNeutralDollar.deposit(await wsteth.getAddress(), ONE_ETHER);

    // burn to zero
    const myBalanceBefore = await deltaNeutralDollar.balanceOf(myAccount.address);
    await usdc.transfer(liquidatorAccount.address, await usdc.balanceOf(myAccount.address));

    const RELAYER_FEE = 10n ** 18n / 100n * 3n;
    await deltaNeutralDollar.withdrawX(await usdc.getAddress(), myBalanceBefore / 2n, connextDestinationDomain, 100, RELAYER_FEE, { value: RELAYER_FEE });

    expect(await usdc.balanceOf(myAccount.address)).to.be.eq(0);
  });

  it("withdraw to connext to disabled destination domain", async () => {
    if (currentChain == CHAIN_BASE) {
      console.log("connext not supported on base");
      return;
    }

    await deltaNeutralDollar.deposit(await wsteth.getAddress(), ONE_ETHER);

    const myBalance = await deltaNeutralDollar.balanceOf(myAccount.address);

    const RELAYER_FEE = 10n ** 18n / 100n * 3n;
    await expect(
      deltaNeutralDollar.withdrawX(await usdc.getAddress(), myBalance / 2n, 111, 100, RELAYER_FEE, { value: RELAYER_FEE })
    ).to.be.revertedWith(ERROR_ONLY_ALLOWED_DESTINATION_DOMAIN);
  });

  it("withdraw must emit events", async () => {
    await deltaNeutralDollar.deposit(await wsteth.getAddress(), ONE_ETHER);

    const myBalanceBefore = await deltaNeutralDollar.balanceOf(myAccount.address);
    await deltaNeutralDollar.withdraw(await wsteth.getAddress(), myBalanceBefore / 4n);

    function quarterOfEth(x) {
      const QUARTER = ONE_ETHER / 4n;
      return x >= QUARTER / 100n * 98n && x <= QUARTER / 100n * 102n;
    }

    function quarterOfEthInStable(x) {
      const quarter = wstethPrice / 4n / 10n ** 2n;
      return x >= quarter / 100n * 98n && x <= quarter / 100n * 102n;
    }

    function quarterOfBalance(x) {
      const referenceValue = myBalanceBefore / 4n;
      return x >= referenceValue / 100n * 98n && x <= referenceValue / 100n * 102n;
    }

    await expect(deltaNeutralDollar.withdraw(await usdc.getAddress(), myBalanceBefore / 4n)).to.emit(deltaNeutralDollar, 'PositionWithdraw')
      .withArgs(await usdc.getAddress(), myBalanceBefore / 4n, quarterOfBalance, quarterOfEth, quarterOfEthInStable, 0);

    await expect(deltaNeutralDollar.withdraw(await wsteth.getAddress(), myBalanceBefore / 4n)).to.emit(deltaNeutralDollar, 'PositionWithdraw')
      .withArgs(await wsteth.getAddress(), myBalanceBefore / 4n, quarterOfBalance, quarterOfEth, 0, 0);
  });

  it("deposit must emit events", async () => {
    function correctBaseAmount(x) {
      return x >= (wstethPrice / 100n * 98n) && x <= (wstethPrice / 100n * 102n);
    }

    await expect(deltaNeutralDollar.deposit(await wsteth.getAddress(), ONE_ETHER)).to.emit(deltaNeutralDollar, 'PositionDeposit')
      .withArgs(await wsteth.getAddress(), ONE_ETHER, correctBaseAmount, ONE_ETHER);
  });

  it("transfer tokens", async () => {
    await deltaNeutralDollar.deposit(await wsteth.getAddress(), ONE_ETHER);
    await deltaNeutralDollar.transfer(secondAccount.address, await deltaNeutralDollar.balanceOf(myAccount.address));

    // burn to zero
    await wsteth.connect(secondAccount).transfer(swapEmulatorCustodian.address, await wsteth.balanceOf(secondAccount.address));

    const secondBalanceBefore = await deltaNeutralDollar.balanceOf(secondAccount.address);
    expect(secondBalanceBefore).to.be.withinPercent(wstethPrice, 1.1);

    await expect(deltaNeutralDollar.withdraw(await wsteth.getAddress(), 1000000000)).to.be.revertedWith(ERROR_INCORRECT_DEPOSIT_OR_WITHDRAWAL_AMOUNT);

    await deltaNeutralDollar.connect(secondAccount).withdraw(await wsteth.getAddress(), secondBalanceBefore / 2n);

    expect(await wsteth.balanceOf(secondAccount.address)).to.be.withinPercent(ONE_ETHER / 2n, 1.1);
  });

  it("withdraw more than balance", async () => {
    await deltaNeutralDollar.deposit(await wsteth.getAddress(), ONE_ETHER);
    const myBalance = await deltaNeutralDollar.balanceOf(myAccount.address);
    await expect(deltaNeutralDollar.withdraw(await wsteth.getAddress(), myBalance + 1n)).to.be.revertedWith(ERROR_INCORRECT_DEPOSIT_OR_WITHDRAWAL_AMOUNT);
  });

  it("only owner can close position", async () => {
    await deltaNeutralDollar.deposit(await wsteth.getAddress(), ONE_ETHER);
    await expect(deltaNeutralDollar.closePosition()).to.be.revertedWith('Ownable: caller is not the owner');
  });

  it("only owner can set settings and mappings", async () => {
    const settings = {
      swapHelper: ethers.ZeroAddress,
      connext: ethers.ZeroAddress,

      minAmountToChangePositionBase: 0,

      minEthToDeposit: 0,
      maxEthToDeposit: 2n**256n-1n,

      minAmountToWithdraw: 0,

      additionalLtvDistancePercent: 0,
      positionSizePercent: 0,
      flags: 0,
      minRebalancePercent: 0
    };

    await expect(deltaNeutralDollar.setSettings(settings)).to.be.revertedWith('Ownable: caller is not the owner');

    await expect(deltaNeutralDollar.setAllowedDepositToken(ethers.ZeroAddress, true)).to.be.revertedWith('Ownable: caller is not the owner');
    await expect(deltaNeutralDollar.setAllowedWithdrawToken(ethers.ZeroAddress, true)).to.be.revertedWith('Ownable: caller is not the owner');
    await expect(deltaNeutralDollar.setAllowedDestinationDomain(111, true)).to.be.revertedWith('Ownable: caller is not the owner');
  });

  it("only owner can collect tokens", async () => {
    await deltaNeutralDollar.deposit(await wsteth.getAddress(), ONE_ETHER);
    await expect(deltaNeutralDollar.collectTokens([ await wsteth.getAddress() ], myAccount.address)).to.be.revertedWith('Ownable: caller is not the owner');
  });

  it("caps are respected", async () => {
    await wsteth.connect(impersonatorWsteth).transfer(myAccount.address, ONE_ETHER * 3n + 1n);
    await expect(deltaNeutralDollar.deposit(await wsteth.getAddress(), ONE_ETHER * 3n + 1n)).to.be.revertedWith(ERROR_INCORRECT_DEPOSIT_OR_WITHDRAWAL_AMOUNT);
    await expect(deltaNeutralDollar.deposit(await wsteth.getAddress(), 1n)).to.be.revertedWith(ERROR_INCORRECT_DEPOSIT_OR_WITHDRAWAL_AMOUNT);
  });

  it("cannot deposit when flags disabled", async () => {
    await deltaNeutralDollar.deposit(await wsteth.getAddress(), ONE_ETHER / 2n);

    const settings = (await deltaNeutralDollar.settings()).toObject();
    settings.flags = FLAGS_DEPOSIT_PAUSED;
    await deltaNeutralDollar.connect(ownerAccount).setSettings(settings);

    await expect(deltaNeutralDollar.deposit(await wsteth.getAddress(), ONE_ETHER / 2n)).to.be.revertedWith(ERROR_OPERATION_DISABLED_BY_FLAGS);

    await deltaNeutralDollar.withdraw(await wsteth.getAddress(), await deltaNeutralDollar.balanceOf(myAccount.address) / 2n); // withdraw still allowed
  });

  it("cannot withdraw when flags disabled", async () => {
    await deltaNeutralDollar.deposit(await wsteth.getAddress(), ONE_ETHER / 2n);

    const settings = (await deltaNeutralDollar.settings()).toObject();
    settings.flags = FLAGS_WITHDRAW_PAUSED;
    await deltaNeutralDollar.connect(ownerAccount).setSettings(settings);

    await expect(deltaNeutralDollar.withdraw(await wsteth.getAddress(), 100)).to.be.revertedWith(ERROR_OPERATION_DISABLED_BY_FLAGS);

    await deltaNeutralDollar.deposit(await wsteth.getAddress(), ONE_ETHER / 2n); // deposit still allowed
  });

  it("close position with balance and emit event", async () => {
    await deltaNeutralDollar.deposit(await wsteth.getAddress(), ONE_ETHER);

    function aboutOneEther(x) {
      return x >= (ONE_ETHER / 100n * 98n) && x <= (ONE_ETHER / 100n * 102n);
    }

    await expect(deltaNeutralDollar.connect(ownerAccount).closePosition()).to.emit(deltaNeutralDollar, 'PositionClose').withArgs(aboutOneEther);

    expect(await wsteth.balanceOf(await deltaNeutralDollar.getAddress())).to.be.withinPercent(ONE_ETHER, 1.1);
    expect(await usdc.balanceOf(await deltaNeutralDollar.getAddress())).to.be.eq(0);
  });

  it("close position with flash loan and emit event", async () => {
    await deltaNeutralDollar.deposit(await wsteth.getAddress(), ONE_ETHER);

    const before = await wsteth.balanceOf(myAccount.address);
    await deltaNeutralDollar.connect(ownerAccount).collectTokens([ await wsteth.getAddress() ], myAccount.address);
    const after = await wsteth.balanceOf(myAccount.address);
    const diff = after - before - (ONE_ETHER / 2n);

    // force balance less than debt
    await wsteth.transfer(await deltaNeutralDollar.getAddress(), diff);

    await expect(deltaNeutralDollar.connect(ownerAccount).closePosition()).to.emit(deltaNeutralDollar, 'PositionClose');

    await wsteth.transfer(await deltaNeutralDollar.getAddress(), ONE_ETHER / 2n);

    expect(await wsteth.balanceOf(await deltaNeutralDollar.getAddress())).to.be.withinPercent(ONE_ETHER, 1.1);
    expect(await usdc.balanceOf(await deltaNeutralDollar.getAddress())).to.be.eq(0);
  });

  it("disallow deposit after close position", async () => {
    await deltaNeutralDollar.deposit(await wsteth.getAddress(), ONE_ETHER);
    await deltaNeutralDollar.connect(ownerAccount).closePosition();
    await expect(deltaNeutralDollar.deposit(await wsteth.getAddress(), ONE_ETHER)).to.be.revertedWith(ERROR_OPERATION_DISABLED_BY_FLAGS);
  });

  it("eth price down then close position", async () => {
    await deltaNeutralDollar.deposit(await wsteth.getAddress(), ONE_ETHER);

    await mockedOracle.setOverridePrice(await wsteth.getAddress(), wstethPrice / 100n * 96n);

    await deltaNeutralDollar.connect(ownerAccount).closePosition();

    expect(await wsteth.balanceOf(await deltaNeutralDollar.getAddress())).to.be.withinPercent(ONE_ETHER / 100n * 104n, 1);
    expect(await usdc.balanceOf(await deltaNeutralDollar.getAddress())).to.be.eq(0);
  });

  it("does not rebalance in case of too small percent movement", async () => {
    await deltaNeutralDollar.deposit(await wsteth.getAddress(), ONE_ETHER);

    // mock 4% price difference
    await mockedOracle.setOverridePrice(await wsteth.getAddress(), wstethPrice / 100n * 96n);

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
    await deltaNeutralDollar.deposit(await wsteth.getAddress(), ONE_ETHER);

    await mockedOracle.setOverridePrice(await wsteth.getAddress(), wstethPrice / 100n * 104n);

    await deltaNeutralDollar.connect(ownerAccount).closePosition();

    expect(await wsteth.balanceOf(await deltaNeutralDollar.getAddress())).to.be.withinPercent(ONE_ETHER / 100n * 96n, 1);
    expect(await usdc.balanceOf(await deltaNeutralDollar.getAddress())).to.be.eq(0);
  });

  it("close position then withdraw", async () => {
    await deltaNeutralDollar.deposit(await wsteth.getAddress(), ONE_ETHER);

    // burn to zero
    await wsteth.transfer(liquidatorAccount.address, await wsteth.balanceOf(myAccount.address));

    await deltaNeutralDollar.connect(ownerAccount).closePosition();

    const myBalance = await deltaNeutralDollar.balanceOf(myAccount.address);
    await deltaNeutralDollar.withdraw(await wsteth.getAddress(), myBalance);

    expect(await wsteth.balanceOf(await deltaNeutralDollar.getAddress())).to.be.lt(10000000);
    expect(await wsteth.balanceOf(myAccount.address)).to.be.withinPercent(ONE_ETHER, 1.1);

    expect(await deltaNeutralDollar.totalSupply()).to.be.eq(0);
    expect(await deltaNeutralDollar.totalBalanceBase()).to.be.withinPercent(0, 0.1);
  });

  it("usdc price down", async () => {
    await deltaNeutralDollar.deposit(await wsteth.getAddress(), ONE_ETHER);

    await mockedOracle.setOverridePrice(await usdc.getAddress(), usdcPrice / 100n * 97n);

    expect(await deltaNeutralDollar.balanceOf(myAccount.address)).to.be.withinPercent(wstethPrice, 1.1);

    let diff = await deltaNeutralDollar.calculateRequiredPositionChange();
    expect(diff.debtChangeBase).to.be.lt(0);
    expect(diff.collateralChangeBase).to.be.eq(0);

    await deltaNeutralDollar.rebalance();

    expect(await deltaNeutralDollar.balanceOf(myAccount.address)).to.be.withinPercent(wstethPrice, 1.1);

    diff = await deltaNeutralDollar.calculateRequiredPositionChange();
    expect(diff.toObject()).to.deep.equal({ collateralChangeBase: 0n, debtChangeBase: 0n });
  });

  it("basic liquidation test, no contracts", async () => {
    await usdc.approve(await pool.getAddress(), 2n ** 256n - 1n);
    await usdc.connect(impersonatorUsdc).transfer(myAccount.address, wstethPrice / 10n ** 2n * 2n); // usdc is 6 decimals, prices are 8 decimals
    await pool.supply(await usdc.getAddress(), wstethPrice / 10n ** 2n * 2n, myAccount.address, 0);

    const { availableBorrowsBase } = await pool.getUserAccountData(myAccount.address);
    const borrowWeth = availableBorrowsBase * 10n ** 18n / wstethPrice;

    await pool.borrow(await wsteth.getAddress(), borrowWeth, 2, 0, myAccount.address);

    const userDataBefore = await pool.getUserAccountData(myAccount.address);

    await mockedOracle.setOverridePrice(await wsteth.getAddress(), wstethPrice / 100n * 108n);

    expect(await liquidate(myAccount.address, usdc, wsteth)).to.be.true;

    const userDataAfter = await pool.getUserAccountData(myAccount.address);

    expect(userDataAfter.totalCollateralBase).to.be.lt(userDataBefore.totalCollateralBase);
    expect(userDataAfter.totalDebtBase).to.be.lt(userDataBefore.totalDebtBase);
  });

  it("eth price up then liquidation then close", async () => {
    await deltaNeutralDollar.deposit(await wsteth.getAddress(), ONE_ETHER);

    // burn to zero
    await wsteth.transfer(liquidatorAccount.address, await wsteth.balanceOf(myAccount.address));

    const baseBalanceBefore = await deltaNeutralDollar.balanceOf(myAccount.address);
    const totalBalanceBefore = await deltaNeutralDollar.totalBalanceBase();

    const higherWethPrice = wstethPrice / 100n * 108n;

    await mockedOracle.setOverridePrice(await wsteth.getAddress(), higherWethPrice);

    expect(await liquidate(await deltaNeutralDollar.getAddress(), usdc, wsteth)).to.be.true;

    expect(await deltaNeutralDollar.balanceOf(myAccount.address)).to.be.withinPercent(baseBalanceBefore, 1);
    expect(await deltaNeutralDollar.totalBalanceBase()).to.be.withinPercent(totalBalanceBefore / 100n * 98n, 1); // two percent liquidation hit

    await deltaNeutralDollar.connect(ownerAccount).closePosition();

    expect(await wsteth.balanceOf(await deltaNeutralDollar.getAddress())).to.be.withinPercent(ONE_ETHER / 100n * 90n, 1); // 2% hit and 8% price difff
    expect(await usdc.balanceOf(await deltaNeutralDollar.getAddress())).to.be.eq(0);
  });

  it("multiple users", async () => {
    await deltaNeutralDollar.deposit(await wsteth.getAddress(), ONE_ETHER);

    // burn to zero
    await wsteth.transfer(liquidatorAccount.address, await wsteth.balanceOf(myAccount.address));

    await wsteth.connect(secondAccount).approve(await deltaNeutralDollar.getAddress(), 2n ** 256n - 1n);

    await getWsteth(secondAccount, ONE_ETHER * 2n);

    await deltaNeutralDollar.connect(secondAccount).deposit(await wsteth.getAddress(), ONE_ETHER * 2n);

    const myBalanceAfterDeposit = await deltaNeutralDollar.balanceOf(myAccount.address);

    expect(myBalanceAfterDeposit).to.be.withinPercent(wstethPrice, 1.1);
    expect(await deltaNeutralDollar.balanceOf(secondAccount.address)).to.be.withinPercent(wstethPrice * 2n, 1.1);
    expect(await deltaNeutralDollar.totalBalanceBase()).to.be.withinPercent(wstethPrice * 3n, 1.1);

    const totalSupplyBefore = await deltaNeutralDollar.totalSupply();
    expect(totalSupplyBefore).to.be.withinPercent(wstethPrice * 3n, 1.1);

    const higherWethPrice = wstethPrice / 100n * 103n;
    await mockedOracle.setOverridePrice(await wsteth.getAddress(), higherWethPrice);

    expect(await deltaNeutralDollar.balanceOf(myAccount.address)).to.be.eq(myBalanceAfterDeposit);
    expect(await deltaNeutralDollar.balanceOf(secondAccount.address)).to.be.withinPercent(wstethPrice * 2n, 1.1);
    expect(await deltaNeutralDollar.totalBalanceBase()).to.be.withinPercent(wstethPrice * 3n, 1.1);
    expect(await deltaNeutralDollar.totalSupply()).to.be.eq(totalSupplyBefore);

    await deltaNeutralDollar.withdraw(await wsteth.getAddress(), myBalanceAfterDeposit);

    expect(await wsteth.balanceOf(myAccount.address)).to.be.withinPercent(ONE_ETHER / 100n * 97n, 1.1);

    expect(await deltaNeutralDollar.balanceOf(myAccount.address)).to.be.eq(0);
    expect(await deltaNeutralDollar.balanceOf(secondAccount.address)).to.be.withinPercent(wstethPrice * 2n, 1.1);
    expect(await deltaNeutralDollar.totalBalanceBase()).to.be.withinPercent(wstethPrice * 2n, 1.1);
    expect(await deltaNeutralDollar.totalSupply()).to.be.withinPercent(totalSupplyBefore / 3n * 2n, 1.1);
  });

  it("open position with real swap", async () => {
    const SWAP_HELPER_NAME_BY_CHAIN = {
      [CHAIN_ARBITRUM]: 'SwapHelperArbitrumOneUniswapV3',
      [CHAIN_OPTIMISM]: 'SwapHelperOptimisticEthereumUniswapV3',
      [CHAIN_POLYGON]: 'SwapHelperPolygonUniswapV3',
      [CHAIN_BASE]: 'SwapHelperBaseUniswapV3',
    };

    const SwapHelper = await ethers.getContractFactory(SWAP_HELPER_NAME_BY_CHAIN[currentChain]);
    const swapHelper = await SwapHelper.deploy();
    await swapHelper.waitForDeployment();

    const settings = (await deltaNeutralDollar.settings()).toObject();
    settings.swapHelper = await swapHelper.getAddress();

    await deltaNeutralDollar.connect(ownerAccount).setSettings(settings);

    await mockedOracle.setOverridePrice(await wsteth.getAddress(), wstethPriceReal);

    await deltaNeutralDollar.deposit(await wsteth.getAddress(), ONE_ETHER);

    expect(await deltaNeutralDollar.balanceOf(myAccount.address)).to.be.withinPercent(wstethPriceReal, 1);
    expect(await deltaNeutralDollar.totalBalanceBase()).to.be.withinPercent(wstethPriceReal, 1);

    let diff = await deltaNeutralDollar.calculateRequiredPositionChange();
    expect(diff.toObject()).to.deep.equal({ collateralChangeBase: 0n, debtChangeBase: 0n });
  });

  it("open position in disallowed token", async () => {
    await expect(deltaNeutralDollar.deposit(ethers.ZeroAddress, ONE_ETHER)).to.be.revertedWith(ERROR_ONLY_ALLOWED_TOKEN);
  });

  it("cannot be re-initialized", async () => {
    const settings = {
      swapHelper: '0x7F5c764cBc14f9669B88837ca1490cCa17c31607',
      connext: '0x7F5c764cBc14f9669B88837ca1490cCa17c31607',
      minAmountToChangePositionBase: 1,
      minEthToDeposit: 1,
      maxEthToDeposit: 1,
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
