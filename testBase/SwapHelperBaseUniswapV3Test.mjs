import chai from 'chai';
import withinPercent from '../utils/chai-percent.js';
import { takeSnapshot, setBalance } from '@nomicfoundation/hardhat-network-helpers';

const ONE_ETHER = 1n * 10n ** 18n;
const ONE_GRAND_USDCE = 1000n * 10n ** 6n;

chai.use(withinPercent);
const expect = chai.expect;

describe("SwapHelperBaseUniswapV3", function() {
  let snapshot;

  let myAccount, impersonatorUsdbc, impersonatorWeth;
  let cbeth, usdbc, weth;
  let swapHelper;

  before(async () => {
    [ myAccount ] = await hre.ethers.getSigners();

    const SwapHelper = await ethers.getContractFactory('SwapHelperBaseUniswapV3');
    swapHelper = await SwapHelper.deploy();
    await swapHelper.waitForDeployment();

    usdbc = await ethers.getContractAt('IERC20', '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA');
    cbeth = await ethers.getContractAt('IERC20', '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22');
    weth = await ethers.getContractAt('IERC20', '0x4200000000000000000000000000000000000006');

    impersonatorUsdbc = await ethers.getImpersonatedSigner('0x4c80E24119CFB836cdF0a6b53dc23F04F7e652CA'); // someone wealthy
    await setBalance(impersonatorUsdbc.address, ONE_ETHER);

    impersonatorWeth = await ethers.getImpersonatedSigner('0x46e6b214b524310239732d51387075e0e70970bf'); // someone wealthy
    await setBalance(impersonatorWeth.address, ONE_ETHER);

    await cbeth.approve(await swapHelper.getAddress(), 2n**256n-1n);
    await usdbc.approve(await swapHelper.getAddress(), 2n**256n-1n);
    await weth.approve(await swapHelper.getAddress(), 2n**256n-1n);

    snapshot = await takeSnapshot();
  });

  afterEach("Revert snapshot after test", async () => {
    await snapshot.restore();
    snapshot = await takeSnapshot();
  });

  it("swap usdce to wsteth and back", async () => {
    await usdbc.connect(impersonatorUsdbc).transfer(myAccount.address, ONE_GRAND_USDCE);

    expect(await cbeth.balanceOf(myAccount.address)).to.be.eq(0);

    await swapHelper.swap(await usdbc.getAddress(), await cbeth.getAddress(), ONE_GRAND_USDCE, myAccount.address);

    // let's assume $1000 buys you at least 0.3 wstETH
    const wstEthBalance = await cbeth.balanceOf(myAccount.address);
    expect(wstEthBalance).to.be.gt(ONE_ETHER / 3n);

    await swapHelper.swap(await cbeth.getAddress(), await usdbc.getAddress(), wstEthBalance, myAccount.address);

    expect(await usdbc.balanceOf(myAccount.address)).to.be.withinPercent(ONE_GRAND_USDCE, 0.2);
  });

  it("swap weth to wsteth and back", async () => {
    expect(await cbeth.balanceOf(myAccount.address)).to.be.eq(0);
    expect(await weth.balanceOf(myAccount.address)).to.be.eq(0);

    await weth.connect(impersonatorWeth).transfer(myAccount.address, ONE_ETHER);

    await swapHelper.swap(await weth.getAddress(), await cbeth.getAddress(), ONE_ETHER, myAccount.address);

    const wstEthBalance = await cbeth.balanceOf(myAccount.address);
    expect(wstEthBalance).to.be.gt(1)

    await swapHelper.swap(await cbeth.getAddress(), await weth.getAddress(), wstEthBalance, myAccount.address);
    expect(await weth.balanceOf(myAccount.address)).to.be.withinPercent(ONE_ETHER, 1);
  });
});
