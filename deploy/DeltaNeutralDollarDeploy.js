module.exports = async ({ ethers, deployments, upgrades }) => {
  const params = parseDeployConfig(process.env, 'SWAPHELPER_ADDRESS:address BALANCER_VAULT_ADDRESS:address ETH_ADDRESS:address STABLE_ADDRESS:address ADDRESSES_PROVIDER_ADDRESS:address');
  if (!params) {
    return;
  }

  const args = [
    8,
    "DNH",
    "Delta Neutral Dollar",
    params.STABLE_ADDRESS,
    params.ETH_ADDRESS,
    params.BALANCER_VAULT_ADDRESS,
    params.ADDRESSES_PROVIDER_ADDRESS,
    {
      swapHelper: params.SWAPHELPER_ADDRESS,

      minAmountToChangePositionBase: 17n * 10n ** 8n,

      minEthToDeposit: 10n ** 18n / 1000n, // 0.001 ETH

      minAmountToWithdraw: 10n ** 8n, // 1 DND

      additionalLtvDistancePercent: 10,
      positionSizePercent: 100,
      flags: 0,
      minRebalancePercent: 5,
    }
  ];

  const DeltaNeutralDollar = await ethers.getContractFactory('DeltaNeutralDollar');
  const instance = await upgrades.deployProxy(DeltaNeutralDollar, args, { kind: 'uups' });
  await instance.waitForDeployment();

  console.log("Deployed to", await instance.getAddress());
};

module.exports.tags = ['DeltaNeutralDollarDeploy'];
