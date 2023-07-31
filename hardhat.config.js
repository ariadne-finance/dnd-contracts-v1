require('dotenv/config');

require('@nomicfoundation/hardhat-chai-matchers');
require('@nomiclabs/hardhat-etherscan');
require('hardhat-deploy');
require('hardhat-abi-exporter');
require('hardhat-contract-sizer');
require('@openzeppelin/hardhat-upgrades');

task('proper-verify', "Actually verify contract")
  .addParam('name', "Deployment name")
  .addOptionalParam('contract', 'contracts/Something.sol:Something')
  .setAction(async (taskArgs, hre) => {
    const d = await hre.deployments.get(taskArgs.name);

    const contract = taskArgs.contract || `contracts/${taskArgs.name}.sol:${taskArgs.name}`;

    await hre.run('verify:verify', {
      address: d.address,
      constructorArguments: d.args,
      contract
    });
  });

const accounts = process.env.PRIVATE_KEY ? [ process.env.PRIVATE_KEY ] : undefined;

module.exports = {
  networks: {
    forked: {
      url: 'http://127.0.0.1:8545',
      chainId: 0x7a69,
      accounts
    },

    optimisticEthereum: {
      url: `https://optimism-mainnet.infura.io/v3/${process.env.INFURA_API_KEY}`,
      chainId: 0x0a,
      accounts
    },

    arbitrumOne: {
      url: `https://arbitrum-mainnet.infura.io/v3/${process.env.INFURA_API_KEY}`,
      chainId: 42161,
      accounts
    }
  },

  etherscan: {
    apiKey: {
      optimisticEthereum: process.env.ETHERSCAN_OPTIMISTIC_ETHEREUM,
      arbitrumOne: process.env.ETHERSCAN_ARBITRUM_ONE,
    }
  },

  solidity: {
    compilers: [
      {
        version: '0.8.21',
        settings: {
          evmVersion: "paris",
          optimizer: {
            enabled: true,
            runs: 200,
          },
          outputSelection: {
            "*": {
              "*": ["storageLayout"]
            }
          }
        }
      }
    ]
  },

  abiExporter: {
    path: './abi',
    runOnCompile: false,
    clear: true,
    flat: true,
    spacing: 2,
    pretty: false
  }
};
