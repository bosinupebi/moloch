usePlugin('@nomiclabs/buidler-truffle5')

require('./scripts/moloch-tasks')
require('./scripts/pool-tasks')

const INFURA_API_KEY = ''
const MAINNET_PRIVATE_KEY '
const ROPSTEN_PRIVATE_KEY = ''

module.exports = {
  networks: {
    develop: {
      deployedContracts: {
        moloch: '',
        pool: ''
      }
    },
    // ropsten: {
    //   url: `https://ropsten.infura.io/v3/${INFURA_API_KEY}`,
    //   accounts: [ ROPSTEN_PRIVATE_KEY ],
    //   deployedContracts: {
    //     moloch: "",
    //     pool: ""
    //   }
    // },
    mainnet: {
      url: `https://www.ethercluster.com/mordor`,
      accounts: [MAINNET_PRIVATE_KEY],
      deployedContracts: {
        moloch: "", 
        pool: ""
      }
    }, 
    coverage: {
      url: 'http://localhost:8555'
    }
  },
  solc: {
    version: '0.5.3',
    evmVersion: 'byzantium'
  }
}
