module.exports = async ({ ethers, deployments }) => {
  const deployers = await ethers.getSigners();

  await deployments.deploy('SwapHelperOptimisticEthereumUniswapV3', {
    from: deployers[0].address,
    args: [ ],
    skipIfAlreadyDeployed: true,
    log: true
  });
};

module.exports.tags = ['SwapHelperOptimisticEthereumUniswapV3'];
