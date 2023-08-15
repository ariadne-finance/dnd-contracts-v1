import chai from 'chai';
import withinPercent from '../utils/chai-percent.js';
import { takeSnapshot, setBalance } from '@nomicfoundation/hardhat-network-helpers';

const ONE_ETHER = 1n * 10n ** 18n;
const ONE_GRAND_USDCE = 1000n * 10n ** 6n;

chai.use(withinPercent);
const expect = chai.expect;

describe("SwapHelperArbitrumOneUniswapV3", function() {
  let snapshot;

  let myAccount, impersonatorUsdce, impersonatorWeth;
  let wsteth, usdce, weth;
  let swapHelper;

  before(async () => {
    [ myAccount ] = await hre.ethers.getSigners();

    const SwapHelper = await ethers.getContractFactory('SwapHelperArbitrumOneUniswapV3');
    swapHelper = await SwapHelper.deploy();
    await swapHelper.waitForDeployment();

    usdce = await ethers.getContractAt('IERC20', '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8');
    wsteth = await ethers.getContractAt('IERC20', '0x5979D7b546E38E414F7E9822514be443A4800529');
    weth = await ethers.getContractAt('IERC20', '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1');

    impersonatorUsdce = await ethers.getImpersonatedSigner('0x5bdf85216ec1e38D6458C870992A69e38e03F7Ef'); // someone wealthy
    await setBalance(impersonatorUsdce.address, ONE_ETHER);

    impersonatorWeth = await ethers.getImpersonatedSigner('0x0dF5dfd95966753f01cb80E76dc20EA958238C46'); // someone wealthy
    await setBalance(impersonatorWeth.address, ONE_ETHER);

    await wsteth.approve(await swapHelper.getAddress(), 2n**256n-1n);
    await usdce.approve(await swapHelper.getAddress(), 2n**256n-1n);
    await weth.approve(await swapHelper.getAddress(), 2n**256n-1n);

    snapshot = await takeSnapshot();
  });

  afterEach("Revert snapshot after test", async () => {
    await snapshot.restore();
    snapshot = await takeSnapshot();
  });

  it("swap usdce to wsteth and back", async () => {
    await usdce.connect(impersonatorUsdce).transfer(myAccount.address, ONE_GRAND_USDCE);

    expect(await wsteth.balanceOf(myAccount.address)).to.be.eq(0);

    await swapHelper.swap(await usdce.getAddress(), await wsteth.getAddress(), ONE_GRAND_USDCE, myAccount.address);

    // let's assume $1000 buys you at least 0.3 wstETH
    const wstEthBalance = await wsteth.balanceOf(myAccount.address);
    expect(wstEthBalance).to.be.gt(ONE_ETHER / 3n);

    await swapHelper.swap(await wsteth.getAddress(), await usdce.getAddress(), wstEthBalance, myAccount.address);

    expect(await usdce.balanceOf(myAccount.address)).to.be.withinPercent(ONE_GRAND_USDCE, 0.2);
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
