import chai from 'chai';
import withinPercent from '../utils/chai-percent.js';
import { setBalance, takeSnapshot } from '@nomicfoundation/hardhat-network-helpers';

chai.use(withinPercent);
const expect = chai.expect;

const ADDRESSES_PROVIDER = '0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb';
const WETH = '0x4200000000000000000000000000000000000006';

describe("MockAaveOracle", function() {
  let myAccount, mockedOracle;
  let snapshot;
  let impersonator;

  before(async () => {
    snapshot = await takeSnapshot();

    [ myAccount ] = await hre.ethers.getSigners();
    await setBalance(myAccount.address, 10n**18n);

    const addressProvider = await ethers.getContractAt('IPoolAddressesProvider', ADDRESSES_PROVIDER);
    const originalOracleAddress = await addressProvider.getPriceOracle();

    const MockAaveOracle = await ethers.getContractFactory('MockAaveOracle');
    mockedOracle = await MockAaveOracle.deploy(originalOracleAddress);

    const addressProviderOwner = await (await ethers.getContractAt('OwnableUpgradeable', await addressProvider.getAddress())).owner();

    impersonator = await ethers.getImpersonatedSigner(addressProviderOwner);
    await setBalance(impersonator.address, 10n**18n);

    await addressProvider.connect(impersonator).setPriceOracle(await mockedOracle.getAddress());
  });

  after(async () => {
    await snapshot.restore();
  });

  it("test oracle mocking", async () => {
    expect(await mockedOracle.getAssetPrice(WETH)).to.be.gt(1000n * 10n ** 6n);

    await mockedOracle.setOverridePrice(WETH, 123);
    expect(await mockedOracle.getAssetPrice(WETH)).to.be.eq(123);
  });
});
