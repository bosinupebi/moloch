/* global artifacts, contract, assert, web3 */
/* eslint-env mocha */

// TODO
// - events
// - accounts[0] -> owner & accounts[1] -> summoner (easy balance checks)

const Moloch = artifacts.require('./Moloch')
const GuildBank = artifacts.require('./GuildBank')
const Token = artifacts.require('./Token')
const config = require('../migrations/config.json')

const abi = require('web3-eth-abi')

const HttpProvider = require(`ethjs-provider-http`)
const EthRPC = require(`ethjs-rpc`)
const ethRPC = new EthRPC(new HttpProvider('http://localhost:8545'))

const BigNumber = web3.BigNumber

const should = require('chai').use(require('chai-as-promised')).use(require('chai-bignumber')(BigNumber)).should()

const SolRevert = 'VM Exception while processing transaction: revert'
const InvalidOpcode = 'VM Exception while processing transaction: invalid opcode'

async function blockTime() {
  return (await web3.eth.getBlock('latest')).timestamp
}

function getEventParams(tx, event) {
  if (tx.logs.length > 0) {
    for (let idx=0; idx < tx.logs.length; idx++) {
      if (tx.logs[idx].event == event) {
        return tx.logs[idx].args
      }
    }
  }
  return false
}

async function snapshot() {
  return new Promise((accept, reject) => {
    ethRPC.sendAsync({method: `evm_snapshot`}, (err, result)=> {
      if (err) {
        reject(err)
      } else {
        accept(result)
      }
    })
  })
}

async function restore(snapshotId) {
  return new Promise((accept, reject) => {
    ethRPC.sendAsync({method: `evm_revert`, params: [snapshotId]}, (err, result) => {
      if (err) {
        reject(err)
      } else {
        accept(result)
      }
    })
  })
}

async function forceMine() {
  return await ethRPC.sendAsync({method: `evm_mine`}, (err)=> {});
}

async function blockTime() {
  return await web3.eth.getBlock('latest').timestamp
}

async function moveForwardPeriods(periods) {
  const blocktimestamp = await blockTime()
  const goToTime = config.PERIOD_DURATION_IN_SECONDS * periods
  await ethRPC.sendAsync({
    jsonrpc:'2.0', method: `evm_increaseTime`,
    params: [goToTime],
    id: 0
  }, (err)=> {`error increasing time`});
  await forceMine()
  const updatedBlocktimestamp = await blockTime()
  return true
}

let moloch, guildBank, token

contract('Moloch', accounts => {
  let snapshotId

  before('deploy contracts', async () => {
    moloch = await Moloch.deployed()
    const guildBankAddress = await moloch.guildBank()
    guildBank = await GuildBank.at(guildBankAddress)
    token = await Token.deployed()
  })

  beforeEach(async () => {
    snapshotId = await snapshot()

    summoner = accounts[0]

    proposal1 = {
      applicant: accounts[1],
      tokenTribute: 100,
      sharesRequested: 1,
      details: ""
    }
  })

  afterEach(async () => {
    await restore(snapshotId)
  })

  it('verify deployment parameters', async () => {
    const now = await blockTime()

    const approvedTokenAddress = await moloch.approvedToken()
    assert.equal(approvedTokenAddress, token.address)

    const guildBankAddress = await moloch.guildBank()
    assert.equal(guildBankAddress, guildBank.address)

    const guildBankOwner = await guildBank.owner()
    assert.equal(guildBankOwner, moloch.address)

    const periodDuration = await moloch.periodDuration()
    assert.equal(+periodDuration, config.PERIOD_DURATION_IN_SECONDS)

    const votingPeriodLength = await moloch.votingPeriodLength()
    assert.equal(+votingPeriodLength, config.VOTING_DURATON_IN_PERIODS)

    const gracePeriodLength = await moloch.gracePeriodLength()
    assert.equal(+gracePeriodLength, config.GRACE_DURATON_IN_PERIODS)

    const proposalDeposit = await moloch.proposalDeposit()
    assert.equal(+proposalDeposit, config.PROPOSAL_DEPOSIT)

    const dilutionBound = await moloch.dilutionBound()
    assert.equal(+dilutionBound, config.DILUTION_BOUND)

    const processingReward = await moloch.processingReward()
    assert.equal(+processingReward, config.PROCESSING_REWARD)

    const currentPeriod = await moloch.getCurrentPeriod()
    assert.equal(+currentPeriod, 0)

    // TODO check the summoning time = last blocktime

    const summonerData = await moloch.members(config.SUMMONER)
    assert.equal(summonerData[0].toLowerCase(), config.SUMMONER) // delegateKey matches
    assert.equal(+summonerData[1], 1)
    assert.equal(summonerData[2], true)
    assert.equal(+summonerData[3], 0)

    const summonerAddressByDelegateKey = await moloch.memberAddressByDelegateKey(config.SUMMONER)
    assert.equal(summonerAddressByDelegateKey.toLowerCase(), config.SUMMONER)

    const totalShares = await moloch.totalShares()
    assert.equal(+totalShares, 1)

    // confirm initial token supply and summoner balance
    const tokenSupply = await token.totalSupply()
    assert.equal(+tokenSupply.toString(), config.TOKEN_SUPPLY)
    const summonerTokenBalance = await token.balanceOf(summoner)
    assert.equal(+summonerTokenBalance.toString(), config.TOKEN_SUPPLY)
  })

  describe('submitProposal', () => {
    beforeEach(async () => {
      await token.transfer(proposal1.applicant, proposal1.tokenTribute, { from: summoner })
      await token.approve(moloch.address, 10, { from: summoner })
      await token.approve(moloch.address, proposal1.tokenTribute, { from: proposal1.applicant })
    })

    it('happy case', async () => {
      await moloch.submitProposal(proposal1.applicant, proposal1.tokenTribute, proposal1.sharesRequested, proposal1.details)

      const proposal = await moloch.proposalQueue.call(0)
      assert.equal(proposal.proposer, summoner)
      assert.equal(proposal.applicant, proposal1.applicant)
      assert.equal(proposal.sharesRequested, proposal1.sharesRequested)
      assert.equal(proposal.startingPeriod, 1)
      assert.equal(proposal.yesVotes, 0)
      assert.equal(proposal.noVotes, 0)
      assert.equal(proposal.processed, false)
      assert.equal(proposal.tokenTribute, proposal1.tokenTribute)
      assert.equal(proposal.details, proposal1.details)
      assert.equal(proposal.maxTotalSharesAtYesVote, 0)

      const totalSharesRequested = await moloch.totalSharesRequested()
      assert.equal(totalSharesRequested, proposal1.sharesRequested)

      const totalShares = await moloch.totalShares()
      assert.equal(totalShares, 1)

      const proposalQueueLength = await moloch.getProposalQueueLength()
      assert.equal(proposalQueueLength, 1)

      const molochTokenBalance = await token.balanceOf(moloch.address)
      assert.equal(molochTokenBalance, proposal1.tokenTribute + config.PROPOSAL_DEPOSIT)
    })

    // TODO trigger the uint overflow

    it('fail - insufficient proposal deposit', async () => {
      await token.decreaseAllowance(moloch.address, 1, { from: summoner })

      await moloch.submitProposal(proposal1.applicant, proposal1.tokenTribute, proposal1.sharesRequested, proposal1.details).should.be.rejectedWith(SolRevert)
    })

    it('fail - insufficient applicant tokens', async () => {
      await token.decreaseAllowance(moloch.address, 1, { from: proposal1.applicant })

      await moloch.submitProposal(proposal1.applicant, proposal1.tokenTribute, proposal1.sharesRequested, proposal1.details).should.be.rejectedWith(SolRevert)
    })
  })

  describe('submitVote', () => {
    beforeEach(async () => {
      await token.transfer(proposal1.applicant, proposal1.tokenTribute, { from: summoner })
      await token.approve(moloch.address, 10, { from: summoner })
      await token.approve(moloch.address, proposal1.tokenTribute, { from: proposal1.applicant })

      await moloch.submitProposal(proposal1.applicant, proposal1.tokenTribute, proposal1.sharesRequested, proposal1.details)
    })

    it('happy case - yes vote', async () => {
      await moveForwardPeriods(1)
      await moloch.submitVote(0, 1, { from: summoner })

      const proposal = await moloch.proposalQueue.call(0)
      assert.equal(proposal.yesVotes, 1)
      assert.equal(proposal.noVotes, 0)
      assert.equal(proposal.maxTotalSharesAtYesVote, 1)

      const memberVote = await moloch.getMemberProposalVote(summoner, 0)
      assert.equal(memberVote, 1)
    })

    it('happy case - no vote', async () => {
      await moveForwardPeriods(1)
      await moloch.submitVote(0, 2, { from: summoner })

      const proposal = await moloch.proposalQueue.call(0)
      assert.equal(proposal.yesVotes, 0)
      assert.equal(proposal.noVotes, 1)
      assert.equal(proposal.maxTotalSharesAtYesVote, 0)

      const memberVote = await moloch.getMemberProposalVote(summoner, 0)
      assert.equal(memberVote, 2)
    })

    it('fail - proposal does not exist', async () => {
      await moveForwardPeriods(1)
      await moloch.submitVote(1, 1, { from: summoner }).should.be.rejectedWith(SolRevert)
    })

    it('fail - voting period has not started', async () => {
      // don't move the period forward
      await moloch.submitVote(0, 1, { from: summoner }).should.be.rejectedWith(SolRevert)
    })

    it('fail - voting period has expired', async () => {
      await moveForwardPeriods(config.VOTING_DURATON_IN_PERIODS + 1)
      await moloch.submitVote(0, 1, { from: summoner }).should.be.rejectedWith(SolRevert)
    })

    it('fail - member has already voted', async () => {
      await moveForwardPeriods(1)
      await moloch.submitVote(0, 1, { from: summoner })
      await moloch.submitVote(0, 1, { from: summoner }).should.be.rejectedWith(SolRevert)
    })

    it('fail - vote must be yes or no', async () => {
      await moveForwardPeriods(1)

      // vote null
      await moloch.submitVote(0, 0, { from: summoner }).should.be.rejectedWith(SolRevert)

      // vote out of bounds
      await moloch.submitVote(0, 3, { from: summoner }).should.be.rejectedWith(InvalidOpcode)
    })
  })

  describe('processProposal', () => {
    beforeEach(async () => {

      await token.transfer(proposal1.applicant, proposal1.tokenTribute, { from: summoner })
      await token.approve(moloch.address, 10, { from: summoner })
      await token.approve(moloch.address, proposal1.tokenTribute, { from: proposal1.applicant })

      await moloch.submitProposal(proposal1.applicant, proposal1.tokenTribute, proposal1.sharesRequested, proposal1.details)

      await moveForwardPeriods(1)
      await moloch.submitVote(0, 1, { from: summoner })

      await moveForwardPeriods(config.VOTING_DURATON_IN_PERIODS)
    })

    it('happy case', async () => {
      await moveForwardPeriods(config.GRACE_DURATON_IN_PERIODS)
      await moloch.processProposal(0, { from: accounts[2] })

      const proposal = await moloch.proposalQueue.call(0)
      assert.equal(proposal.yesVotes, 1)
      assert.equal(proposal.noVotes, 0)
      assert.equal(proposal.maxTotalSharesAtYesVote, 1)
      assert.equal(proposal.processed, true)

      const totalSharesRequested = await moloch.totalSharesRequested()
      assert.equal(totalSharesRequested, 0)

      const totalShares = await moloch.totalShares()
      assert.equal(totalShares, proposal1.sharesRequested + 1)

      const processorBalance = await token.balanceOf(accounts[2])
      assert.equal(processorTokenBalance, config.PROCESSING_REWARD)

      const guildBankBalance = await token.balanceOf(guildBank.address)
      assert.equal(guildBankBalance, proposal1.tokenTribute)

      const molochBalance = await token.balanceOf(moloch.address)
      assert.equal(molochBalance, 0)

      const summonerBalance = await token.balanceOf(summoner)
      assert.equal()

      // TODO
      // - moloch token balance -> 0
      // - guildbank token balance -> 100
      // - reward recipient -> 1
      // - proposer -> +9
    })

    it('fail - proposal does not exist', async () => {
      await moveForwardPeriods(config.GRACE_DURATON_IN_PERIODS)
      await moloch.processProposal(1).should.be.rejectedWith(SolRevert)
    })

    it('fail - proposal is not ready to be processed', async () => {
      await moveForwardPeriods(config.GRACE_DURATON_IN_PERIODS - 1)
      await moloch.processProposal(0).should.be.rejectedWith(SolRevert)
    })

    it('fail - proposal has already been processed', async () => {
      await moveForwardPeriods(config.GRACE_DURATON_IN_PERIODS)
      await moloch.processProposal(0)
      await moloch.processProposal(0).should.be.rejectedWith(SolRevert)
    })

    it('fail - previous proposal must be processed', async () => {
      // TODO two proposals back to back
    })
  })

  describe.only('ragequit', () => {
    beforeEach(async () => {
      proposal1.sharesRequested = 1 // make it so total shares is 2

      await token.transfer(proposal1.applicant, proposal1.tokenTribute, { from: summoner })
      await token.approve(moloch.address, 10, { from: summoner })
      await token.approve(moloch.address, proposal1.tokenTribute, { from: proposal1.applicant })

      await moloch.submitProposal(proposal1.applicant, proposal1.tokenTribute, proposal1.sharesRequested, proposal1.details)

      await moveForwardPeriods(1)
      await moloch.submitVote(0, 1, { from: summoner })

      await moveForwardPeriods(config.VOTING_DURATON_IN_PERIODS)
      await moveForwardPeriods(config.GRACE_DURATON_IN_PERIODS)
      await moloch.processProposal(0)
    })

    it('happy case', async () => {
      await moloch.ragequit(1, { from: summoner })

      const totalShares = await moloch.totalShares()
      assert.equal(totalShares, proposal1.sharesRequested)

      const summonerData = await moloch.members(summoner)
      assert.equal(+summonerData[1], 0)
      assert.equal(summonerData[2], true)
      assert.equal(+summonerData[3], 0)

      const summonerTokenBalance = await token.balanceOf(summoner)
      assert.equal(+summonerTokenBalance.toString(), config.TOKEN_SUPPLY - (proposal1.tokenTribute / 2))

      /*
      const molochTokenBalance = await token.balanceOf(moloch.address)
      assert.equal(molochTokenBalance, proposal1.tokenTribute + config.PROPOSAL_DEPOSIT)
      */
    })

  })

  describe('GuildBank::redeemLootTokens', () => {

  })

  describe('GuildBank::safeRedeemLootTokens', () => {

  })
})
