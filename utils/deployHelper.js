module.exports = hre => {
  hre.parseDeployConfig = (config, keysList) => {
    const result = {};

    const list = keysList.replace(/\s+/g, ' ').trim().split(' ');
    for (const entry of list) {
      let [ keyName, type ] = entry.split(':');

      type = type || 'string';

      if (!(keyName in config)) {
        console.log(`env variable is missing: ${keyName}`);
        console.log(`Required envs: ${list.join(' ')}`);
        return null;
      }

      const value = config[keyName];

      if (type == 'string') {
        result[keyName] = value;

      } else if (type == 'number') {
        result[keyName] = parseInt(value);

        if (isNaN(result[keyName])) {
          console.log(`env variable must be a number: ${keyName}`);
          return null;
        }

      } else if (type == 'bigint') {
        try {
          result[keyName] = BigInt(value);
        } catch {
          console.log(`env variable must be a bigint: ${keyName}`);
          return null;
        }

      } else if (type == 'address') {
        try {
          result[keyName] = ethers.getAddress(value);
        } catch {
          console.log(`env variable must be an address: ${keyName}`);
          return null;
        }

      } else {
        console.log(`Unknown type: ${type}`);
        return null;
      }
    }

    return result;
  };
};
