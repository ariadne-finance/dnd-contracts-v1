const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const createKeccakHash = require('keccak');

if (process.arch !== 'arm64' && process.platform !== 'darwin') {
  console.error("This script hacks hardhat to use locally installed aarch64 solc in hardhat");
  console.error("It is only required on M1 Macs.");
  process.exit(1);
}

const LAST_VERSION = '0.8.23';

const localSolcFilename = '/opt/homebrew/Cellar/solidity/' + LAST_VERSION + '/bin/solc';

if (!localSolcFilename) {
  console.error(`solc not found at ${localSolcFilename}`);
  process.exit(1);
}

const listFilename = path.join(process.env.HOME, 'Library', 'Caches', 'hardhat-nodejs', 'compilers-v2', 'macosx-amd64', 'list.json');
if (!fs.existsSync(listFilename)) {
  console.error(`Compiler list not found at ${listFilename}. Let hardhat compile something first`);
  process.exit(1);
}

const list = JSON.parse(fs.readFileSync(listFilename));
const lastEntry = list.builds.find(entry => entry.version == LAST_VERSION);
if (!lastEntry) {
  console.error(`Cannot find ${LAST_VERSION} in ${listFilename}`);
  process.exit(1);
}

if (lastEntry.path.includes('-aarch64')) {
  console.error(`Already hacked`);
  process.exit(1);
}

const aarch64Filename = lastEntry.path.replaceAll('amd64', 'aarch64');
const destinationPath = path.join(path.dirname(listFilename), aarch64Filename);
fs.cpSync(localSolcFilename, destinationPath);

lastEntry.path = aarch64Filename;

const solcBinary = fs.readFileSync(destinationPath);

const sha256Sum = crypto.createHash('sha256').update(solcBinary).digest('hex');
lastEntry.sha256 = '0x' + sha256Sum;

const keccak256Sum = createKeccakHash('keccak256').update(solcBinary).digest('hex');
lastEntry.keccak256 = '0x' + keccak256Sum;

list.releases[LAST_VERSION] = aarch64Filename;

fs.writeFileSync(listFilename, JSON.stringify(list, null, "\t") + "\n");

console.log(`Now using local solc for ${LAST_VERSION}`);
