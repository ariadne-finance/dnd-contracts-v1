require('dotenv/config');

require('@nomicfoundation/hardhat-chai-matchers');
require('@nomiclabs/hardhat-etherscan');
require('hardhat-deploy');
require('hardhat-abi-exporter');
require('hardhat-contract-sizer');
require('solidity-docgen');
require('@openzeppelin/hardhat-upgrades');

extendEnvironment(require('./utils/deployHelper.js'));

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
    },

    polygon: {
      url: `https://polygon-mainnet.infura.io/v3/${process.env.INFURA_API_KEY}`,
      chainId: 42161,
      accounts
    }
  },

  etherscan: {
    apiKey: {
      optimisticEthereum: process.env.ETHERSCAN_OPTIMISTIC_ETHEREUM,
      arbitrumOne: process.env.ETHERSCAN_ARBITRUM_ONE,
      polygon: process.env.ETHERSCAN_POLYGON
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
  },

  docgen: {
    pages: 'files'
  }
};
