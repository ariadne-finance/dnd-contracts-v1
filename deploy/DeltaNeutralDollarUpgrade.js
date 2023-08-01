module.exports = async ({ ethers, deployments, upgrades }) => {
  const params = parseDeployConfig(process.env, 'ADDRESS:address');
  if (!params) {
    return;
  }

  const contract = await ethers.getContractAt('DeltaNeutralDollar', params.ADDRESS);

  const implementationAddressBefore = await contract.implementation();

  const DeltaNeutralDollar = await ethers.getContractFactory('DeltaNeutralDollar');

  const upgraded = await upgrades.upgradeProxy(params.ADDRESS, DeltaNeutralDollar);
  await upgraded.waitForDeployment();

  console.log('Upgraded at', await upgraded.getAddress());

  const implementationAddressAfter = await contract.implementation();

  console.log("Implementation address before", implementationAddressBefore);
  console.log("Implementation address after ", implementationAddressAfter);
};

module.exports.tags = ['DeltaNeutralDollarUpgrade'];
