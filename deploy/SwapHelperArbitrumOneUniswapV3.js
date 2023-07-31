module.exports = async ({ ethers, deployments }) => {
  const deployers = await ethers.getSigners();

  await deployments.deploy('SwapHelperArbitrumOneUniswapV3', {
    from: deployers[0].address,
    args: [ ],
    skipIfAlreadyDeployed: true,
    log: true
  });
};

module.exports.tags = ['SwapHelperArbitrumOneUniswapV3'];
