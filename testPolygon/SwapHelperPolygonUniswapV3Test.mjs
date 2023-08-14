import chai from 'chai';
import withinPercent from '../utils/chai-percent.js';
import { takeSnapshot, setBalance } from '@nomicfoundation/hardhat-network-helpers';

const ONE_ETHER = 1n * 10n ** 18n;
const ONE_GRAND_USDCE = 1000n * 10n ** 6n;

chai.use(withinPercent);
const expect = chai.expect;

describe("SwapHelperPolygonUniswapV3", function() {
  let snapshot;

  let myAccount, impersonatorUsdc;
  let wsteth, usdc;
  let swapHelper;

  before(async () => {
    [ myAccount ] = await hre.ethers.getSigners();

    const SwapHelper = await ethers.getContractFactory('SwapHelperPolygonUniswapV3');
    swapHelper = await SwapHelper.deploy();
    await swapHelper.waitForDeployment();

    usdc = await ethers.getContractAt('IERC20', '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174');
    wsteth = await ethers.getContractAt('IERC20', '0x03b54A6e9a984069379fae1a4fC4dBAE93B3bCCD');

    impersonatorUsdc = await ethers.getImpersonatedSigner('0x0639556F03714A74a5fEEaF5736a4A64fF70D206'); // someone wealthy
    await setBalance(impersonatorUsdc.address, ONE_ETHER);

    await wsteth.approve(await swapHelper.getAddress(), 2n**256n-1n);
    await usdc.approve(await swapHelper.getAddress(), 2n**256n-1n);

    snapshot = await takeSnapshot();
  });

  afterEach("Revert snapshot after test", async () => {
    await snapshot.restore();
    snapshot = await takeSnapshot();
  });

  it("swap usdce to wsteth and back", async () => {
    await usdc.connect(impersonatorUsdc).transfer(myAccount.address, ONE_GRAND_USDCE);

    expect(await wsteth.balanceOf(myAccount.address)).to.be.eq(0);

    await swapHelper.swap(await usdc.getAddress(), await wsteth.getAddress(), ONE_GRAND_USDCE, myAccount.address);

    // let's assume $1000 buys you at least 0.3 wstETH
    const wstEthBalance = await wsteth.balanceOf(myAccount.address);
    expect(wstEthBalance).to.be.gt(ONE_ETHER / 3n);

    await swapHelper.swap(await wsteth.getAddress(), await usdc.getAddress(), wstEthBalance, myAccount.address);

    expect(await usdc.balanceOf(myAccount.address)).to.be.withinPercent(ONE_GRAND_USDCE, 0.2);
  });
});
