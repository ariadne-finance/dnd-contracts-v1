module.exports = async ({ ethers, deployments }) => {
  const deployers = await ethers.getSigners();

  await deployments.deploy('SwapHelperBaseUniswapV3', {
    from: deployers[0].address,
    args: [ ],
    skipIfAlreadyDeployed: true,
    log: true
  });
};

module.exports.tags = ['SwapHelperBaseUniswapV3'];
