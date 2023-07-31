module.exports = async ({ ethers, deployments, upgrades }) => {
  const params = parseDeployConfig(process.env, 'ADDRESS:address');
  if (!params) {
    return;
  }

  const DeltaNeutralDollar = await ethers.getContractFactory('DeltaNeutralDollar');
  const upgraded = await upgrades.upgradeProxy(params.ADDRESS, DeltaNeutralDollar);
  await upgraded.waitForDeployment();
  console.log('Upgraded at', await upgraded.getAddress());
};

module.exports.tags = ['DeltaNeutralDollarUpgrade'];
