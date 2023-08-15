import chai from 'chai';
import withinPercent from '../utils/chai-percent.js';
import { takeSnapshot, setBalance } from '@nomicfoundation/hardhat-network-helpers';

const ONE_ETHER = 1n * 10n ** 18n;
const ONE_GRAND_USDC = 1000n * 10n ** 6n;

chai.use(withinPercent);
const expect = chai.expect;

describe("SwapHelperOptimisticEthereumUniswapV3", function() {
  let snapshot;

  let myAccount, impersonatorUsdce, impersonatorWeth;
  let wsteth, usdc, weth;
  let swapHelper;

  before(async () => {
    [ myAccount ] = await hre.ethers.getSigners();

    const SwapHelper = await ethers.getContractFactory('SwapHelperOptimisticEthereumUniswapV3');
    swapHelper = await SwapHelper.deploy();
    await swapHelper.waitForDeployment();

    usdc = await ethers.getContractAt('IERC20', '0x7F5c764cBc14f9669B88837ca1490cCa17c31607');
    wsteth = await ethers.getContractAt('IERC20', '0x1F32b1c2345538c0c6f582fCB022739c4A194Ebb');
    weth = await ethers.getContractAt('IERC20', '0x4200000000000000000000000000000000000006');

    impersonatorUsdce = await ethers.getImpersonatedSigner('0x5bdf85216ec1e38D6458C870992A69e38e03F7Ef'); // someone wealthy
    await setBalance(impersonatorUsdce.address, ONE_ETHER);

    impersonatorWeth = await ethers.getImpersonatedSigner('0xc4d4500326981eacD020e20A81b1c479c161c7EF'); // someone wealthy
    await setBalance(impersonatorWeth.address, ONE_ETHER);

    await wsteth.approve(await swapHelper.getAddress(), 2n**256n-1n);
    await usdc.approve(await swapHelper.getAddress(), 2n**256n-1n);
    await weth.approve(await swapHelper.getAddress(), 2n**256n-1n);

    snapshot = await takeSnapshot();
  });

  afterEach("Revert snapshot after test", async () => {
    await snapshot.restore();
    snapshot = await takeSnapshot();
  });

  it("swap usdce to wsteth and back", async () => {
    await usdc.connect(impersonatorUsdce).transfer(myAccount.address, ONE_GRAND_USDC);

    expect(await wsteth.balanceOf(myAccount.address)).to.be.eq(0);

    await swapHelper.swap(await usdc.getAddress(), await wsteth.getAddress(), ONE_GRAND_USDC, myAccount.address);

    // let's assume $1000 buys you at least 0.3 wstETH
    const wstEthBalance = await wsteth.balanceOf(myAccount.address);
    expect(wstEthBalance).to.be.gt(ONE_ETHER / 3n);

    await swapHelper.swap(await wsteth.getAddress(), await usdc.getAddress(), wstEthBalance, myAccount.address);

    expect(await usdc.balanceOf(myAccount.address)).to.be.withinPercent(ONE_GRAND_USDC, 0.2);
  });

  it("swap weth to wsteth and back", async () => {
    expect(await wsteth.balanceOf(myAccount.address)).to.be.eq(0);
    expect(await weth.balanceOf(myAccount.address)).to.be.eq(0);

    await weth.connect(impersonatorWeth).transfer(myAccount.address, ONE_ETHER);

    await swapHelper.swap(await weth.getAddress(), await wsteth.getAddress(), ONE_ETHER, myAccount.address);

    const wstEthBalance = await wsteth.balanceOf(myAccount.address);
    expect(wstEthBalance).to.be.gt(1)

    await swapHelper.swap(await wsteth.getAddress(), await weth.getAddress(), wstEthBalance, myAccount.address);
    expect(await weth.balanceOf(myAccount.address)).to.be.withinPercent(ONE_ETHER, 1);
  });
});
