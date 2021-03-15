/* eslint-disable prefer-const */
import { Address, BigDecimal, BigInt, log } from '@graphprotocol/graph-ts'
import { updatePairDayData, updatePairHourData, updateTokenDayData, updateEmiswapDayData } from './dayUpdates'
import { getTrackedVolumeUSD } from './pricing'
import {
  ADDRESS_ZERO,
  BI_18, calculateFormula,
  convertTokenToDecimal,
  createLiquidityPosition,
  createUser,
  FACTORY_ADDRESS,
  fetchReserves, getEmiswapFee,
  handleSync, ONE_BD,
  ONE_BI,
  ZERO_BD
} from './helpers'
import { Transfer } from '../types/Factory/ERC20'
import {
  Bundle,
  Burn,
  Mint,
  EmiswapDayData,
  EmiswapFactory,
  Pair,
  PairDayData,
  Swap,
  Token,
  TokenDayData,
  Transaction
} from '../types/schema'
import { Deposited, Pair as PairContract, Swapped, Withdrawn } from '../types/templates/Pair/Pair'

export function handleTransfer(event: Transfer): void {

  let factory = EmiswapFactory.load(FACTORY_ADDRESS)
  let transactionHash = event.transaction.hash.toHexString()

  // user stats
  let from = event.params.from
  createUser(from)
  let to = event.params.to
  createUser(to)

  let pair = Pair.load(event.address.toHexString())

  // ignore initial transfers for first adds
  if (
    event.params.from.toHexString() == ADDRESS_ZERO &&
    event.params.to.toHexString() == pair.id &&
    event.params.value.equals(BigInt.fromI32(1000))
  ) {
    return
  }

  let pairContract = PairContract.bind(event.address)
  let newTotalSupply = pairContract.totalSupply()

  // liquidity token amount being transfered
  let value = convertTokenToDecimal(event.params.value, BI_18)
  let transaction = Transaction.load(transactionHash)

  if (transaction == null) {
    transaction = new Transaction(transactionHash)
    transaction.blockNumber = event.block.number
    transaction.timestamp = event.block.timestamp
    transaction.mints = []
    transaction.swaps = []
    transaction.burns = []
  }

  // load mints from transaction
  let mints = transaction.mints

  // mint
  if (from.toHexString() == ADDRESS_ZERO && to.toHexString() != pair.id) {
    // update total supply
    pair.totalSupply = pair.totalSupply.plus(value)
    pair.save()

    // if (mints.length === 0 || isCompleteMint(mints[mints.length - 1])) {
    let mint = new Mint(
      event.transaction.hash
        .toHexString()
        .concat('-')
        .concat(BigInt.fromI32(mints.length).toString())
    )
    mint.pair = pair.id
    mint.to = to
    mint.liquidity = value
    mint.timestamp = transaction.timestamp
    mint.amount0 = ZERO_BD
    mint.amount1 = ZERO_BD
    mint.save()

    // update mints in transaction
    let newMints = transaction.mints
    newMints.push(mint.id)
    transaction.mints = newMints

    // save entities
    transaction.save()
    factory.save()
    // }
  }

  // case where direct send first on ETH withdrawls
  if (event.params.to.toHexString() == pair.id) {
    let burns = transaction.burns
    let burn = new Burn(
      event.transaction.hash
        .toHexString()
        .concat('-')
        .concat(BigInt.fromI32(burns.length).toString())
    )
    burn.pair = pair.id
    burn.liquidity = value
    burn.timestamp = transaction.timestamp
    burn.to = event.params.to
    burn.sender = event.params.from
    burn.needsComplete = true
    burn.save()
    burns.push(burn.id)
    transaction.burns = burns
    transaction.save()
  }

  // burn
  if (event.params.to.toHexString() == ADDRESS_ZERO) {
    pair.totalSupply = pair.totalSupply.minus(value)
    pair.save()

    // this is a new instance of a logical burn
    let burns = transaction.burns
    let burn: Burn
    if (burns.length > 0) {
      let currentBurn = Burn.load(burns[burns.length - 1])
      if (currentBurn.needsComplete) {
        burn = currentBurn as Burn
      } else {
        burn = new Burn(
          event.transaction.hash
            .toHexString()
            .concat('-')
            .concat(BigInt.fromI32(burns.length).toString())
        )
        burn.pair = pair.id
        burn.liquidity = value
        burn.timestamp = transaction.timestamp
        burn.needsComplete = false
      }
    } else {
      burn = new Burn(
        event.transaction.hash
          .toHexString()
          .concat('-')
          .concat(BigInt.fromI32(burns.length).toString())
      )
      burn.pair = pair.id
      burn.liquidity = value
      burn.timestamp = transaction.timestamp
      burn.needsComplete = false
    }

    // // if this logical burn included a fee mint, account for this
    // if (mints.length !== 0 && !isCompleteMint(mints[mints.length - 1])) {
    //   let mint = Mint.load(mints[mints.length - 1])
    //   burn.feeTo = mint.to
    //   burn.feeLiquidity = mint.liquidity
    //   // remove the logical mint
    //   store.remove('Mint', mints[mints.length - 1])
    //   // update the transaction
    //   mints.pop()
    //   transaction.mints = mints
    //   transaction.save()
    // }

    burn.save()

    // if accessing last one, replace it
    if (burn.needsComplete) {
      burns[burns.length - 1] = burn.id
    }
    // else add new one
    else {
      burns.push(burn.id)
    }
    transaction.burns = burns
    transaction.save()
  }

  if (from.toHexString() != ADDRESS_ZERO && from.toHexString() != pair.id) {
    let fromUserLiquidityPosition = createLiquidityPosition(event.address, from)
    fromUserLiquidityPosition.liquidityTokenBalance = convertTokenToDecimal(pairContract.balanceOf(from), BI_18)
    if (newTotalSupply == BigInt.fromI32(0)) {
      fromUserLiquidityPosition.poolOwnership = BigDecimal.fromString('0.0')
    } else {
      fromUserLiquidityPosition.poolOwnership = fromUserLiquidityPosition.liquidityTokenBalance.div(
        convertTokenToDecimal(newTotalSupply, BI_18)
      )
    }
    fromUserLiquidityPosition.save()
  }

  if (event.params.to.toHexString() != ADDRESS_ZERO && to.toHexString() != pair.id) {
    let toUserLiquidityPosition = createLiquidityPosition(event.address, to)
    toUserLiquidityPosition.liquidityTokenBalance = convertTokenToDecimal(pairContract.balanceOf(to), BI_18)
    if (newTotalSupply == BigInt.fromI32(0)) {
      toUserLiquidityPosition.poolOwnership = BigDecimal.fromString('0.0')
    } else {
      toUserLiquidityPosition.poolOwnership = toUserLiquidityPosition.liquidityTokenBalance.div(
        convertTokenToDecimal(newTotalSupply, BI_18)
      )
    }
    toUserLiquidityPosition.save()
  }
  transaction.save()
}

export function handleMint(event: Deposited): void {
  let transaction = Transaction.load(event.transaction.hash.toHexString())
  let mints = transaction.mints
  let mint = Mint.load(mints[mints.length - 1])

  let pair = Pair.load(event.address.toHex())
  let emiswap = EmiswapFactory.load(FACTORY_ADDRESS)

  let token0 = Token.load(pair.token0)
  let token1 = Token.load(pair.token1)

  let reserves = fetchReserves(pair.id)
  //update token info
  let token0Amount = convertTokenToDecimal(reserves[0], token0.decimals).minus(pair.reserve0)
  let token1Amount = convertTokenToDecimal(reserves[1], token1.decimals).minus(pair.reserve1)

  // update global token info
  token0.totalLiquidity = token0.totalLiquidity.plus(token0Amount)
  token1.totalLiquidity = token1.totalLiquidity.plus(token1Amount)

  // update txn counts
  token0.txCount = token0.txCount.plus(ONE_BI)
  token1.txCount = token1.txCount.plus(ONE_BI)

  // get new amounts of USD and ETH for tracking
  let bundle = Bundle.load('1')
  let amountTotalUSD = token1.derivedETH
    .times(token1Amount)
    .plus(token0.derivedETH.times(token0Amount))
    .times(bundle.ethPrice)

  // update txn counts
  pair.txCount = pair.txCount.plus(ONE_BI)
  emiswap.txCount = emiswap.txCount.plus(ONE_BI)

  // save entities
  token0.save()
  token1.save()
  pair.save()
  emiswap.save()

  /*begin*** debug code*/
  log.info('debug code=====>', [token0Amount.toString(), token1Amount.toString(), amountTotalUSD.toString()])
  /*end***** debug code*/

  mint.sender = event.params.account
  mint.amount0 = token0Amount as BigDecimal
  mint.amount1 = token1Amount as BigDecimal
  mint.logIndex = event.logIndex
  mint.amountUSD = amountTotalUSD as BigDecimal
  mint.save()

  handleSync(Address.fromString(pair.id))
  // update day entities
  updatePairDayData(event)
  updatePairHourData(event)
  updateEmiswapDayData(event)
  updateTokenDayData(token0 as Token, event)
  updateTokenDayData(token1 as Token, event)
}

export function handleBurn(event: Withdrawn): void {
  let transaction = Transaction.load(event.transaction.hash.toHexString())
  let burns = transaction.burns
  let burn = Burn.load(burns[burns.length - 1])

  let pair = Pair.load(event.address.toHex())
  let emiswap = EmiswapFactory.load(FACTORY_ADDRESS)

  let reserves = fetchReserves(pair.id)
  //update token info
  let token0 = Token.load(pair.token0)
  let token1 = Token.load(pair.token1)
  let token0Amount = pair.reserve0.minus(convertTokenToDecimal(reserves[0], token0.decimals))
  let token1Amount = pair.reserve1.minus(convertTokenToDecimal(reserves[1], token1.decimals))

  // update global token info
  token0.totalLiquidity = token0.totalLiquidity.minus(token0Amount)
  token1.totalLiquidity = token1.totalLiquidity.minus(token1Amount)

  // update txn counts
  token0.txCount = token0.txCount.plus(ONE_BI)
  token1.txCount = token1.txCount.plus(ONE_BI)

  // get new amounts of USD and ETH for tracking
  let bundle = Bundle.load('1')
  let amountTotalUSD = token1.derivedETH
    .times(token1Amount)
    .plus(token0.derivedETH.times(token0Amount))
    .times(bundle.ethPrice)

  // update txn counts
  emiswap.txCount = emiswap.txCount.plus(ONE_BI)
  pair.txCount = pair.txCount.plus(ONE_BI)

  // update global counter and save
  token0.save()
  token1.save()
  pair.save()
  emiswap.save()

  // update burn
  // burn.sender = event.params.sender
  burn.amount0 = token0Amount as BigDecimal
  burn.amount1 = token1Amount as BigDecimal
  // burn.to = event.params.to
  burn.logIndex = event.logIndex
  burn.amountUSD = amountTotalUSD as BigDecimal
  burn.save()

  handleSync(Address.fromString(pair.id))
  // update day entities
  updatePairDayData(event)
  updatePairHourData(event)
  updateEmiswapDayData(event)
  updateTokenDayData(token0 as Token, event)
  updateTokenDayData(token1 as Token, event)
}

export function handleSwap(event: Swapped): void {
  let pair = Pair.load(event.address.toHexString())
  let token0 = Token.load(pair.token0)
  let token1 = Token.load(pair.token1)

  let isFirstAmount0 = event.params.src.toHexString() == token0.id
  let amountSrc = convertTokenToDecimal(
    event.params.amount,
    isFirstAmount0 ? token0.decimals : token1.decimals
  )
  let amountDest = convertTokenToDecimal(
    event.params.result,
    isFirstAmount0 ? token1.decimals : token0.decimals
  )
  let amount0 = isFirstAmount0 ? amountSrc : amountDest
  let amount1 = isFirstAmount0 ? amountDest : amountSrc

  // ETH/USD prices
  let bundle = Bundle.load('1')

  // get total amounts of derived USD and ETH for tracking
  let derivedAmountETH = token1.derivedETH
    .times(amount1)
    .plus(token0.derivedETH.times(amount0))
    .div(BigDecimal.fromString('2'))
  let derivedAmountUSD = derivedAmountETH.times(bundle.ethPrice)

  // only accounts for volume through white listed tokens
  let trackedAmountUSD = getTrackedVolumeUSD(amount0, token0 as Token, amount1, token1 as Token)

  let trackedAmountETH: BigDecimal
  if (bundle.ethPrice.equals(ZERO_BD)) {
    trackedAmountETH = ZERO_BD
  } else {
    trackedAmountETH = trackedAmountUSD.div(bundle.ethPrice)
  }

  // update token0 global volume and token liquidity stats
  if (isFirstAmount0) {
    token0.totalLiquidity = token0.totalLiquidity.plus(amountSrc)
    token0.tradeVolume = token0.tradeVolume.plus(amountSrc)
  } else {
    token0.totalLiquidity = token0.totalLiquidity.minus(amountDest)
    token0.tradeVolume = token0.tradeVolume.plus(amountDest)
  }
  token0.tradeVolumeUSD = token0.tradeVolumeUSD.plus(trackedAmountUSD === ZERO_BD ? derivedAmountUSD : trackedAmountUSD)

  // update token1 global volume and token liquidity stats
  if (!isFirstAmount0) {
    token1.totalLiquidity = token1.totalLiquidity.plus(amountSrc)
    token1.tradeVolume = token1.tradeVolume.plus(amountSrc)
  } else {
    token1.totalLiquidity = token1.totalLiquidity.minus(amountDest)
    token1.tradeVolume = token1.tradeVolume.plus(amountDest)
  }
  token1.tradeVolumeUSD = token1.tradeVolumeUSD.plus(trackedAmountUSD === ZERO_BD ? derivedAmountUSD : trackedAmountUSD)

  // update txn counts
  token0.txCount = token0.txCount.plus(ONE_BI)
  token1.txCount = token1.txCount.plus(ONE_BI)

  // update pair volume data, use tracked amount if we have it as its probably more accurate
  pair.volumeUSD = pair.volumeUSD.plus(trackedAmountUSD === ZERO_BD ? derivedAmountUSD : trackedAmountUSD)
  pair.volumeToken0 = pair.volumeToken0.plus(amount0)
  pair.volumeToken1 = pair.volumeToken1.plus(amount1)
  pair.txCount = pair.txCount.plus(ONE_BI)
  pair.save()

  // update global values, only used tracked amounts for volume
  let emiswap = EmiswapFactory.load(FACTORY_ADDRESS)
  emiswap.totalVolumeUSD = emiswap.totalVolumeUSD.plus(trackedAmountUSD)
  emiswap.totalVolumeETH = emiswap.totalVolumeETH.plus(trackedAmountETH)
  emiswap.txCount = emiswap.txCount.plus(ONE_BI)

  let emiswapFee = getEmiswapFee()
  let returnAmountWithoutVirtualBalances = calculateFormula(
    event.params.srcBalance,
    event.params.dstBalance,
    event.params.amount,
    emiswapFee
  )
  let winInFee = returnAmountWithoutVirtualBalances.minus(event.params.result)
  let lpExtraFee = winInFee.isZero()
    ? ZERO_BD
    : convertTokenToDecimal(winInFee, isFirstAmount0 ? token1.decimals : token0.decimals)
  if (isFirstAmount0) {
    pair.lpExtraFeeInToken1 = pair.lpExtraFeeInToken1.plus(lpExtraFee)
  } else {
    pair.lpExtraFeeInToken0 = pair.lpExtraFeeInToken0.plus(lpExtraFee)
  }

  // save entities
  pair.save()
  token0.save()
  token1.save()
  emiswap.save()

  let transaction = Transaction.load(event.transaction.hash.toHexString())
  if (transaction === null) {
    transaction = new Transaction(event.transaction.hash.toHexString())
    transaction.blockNumber = event.block.number
    transaction.timestamp = event.block.timestamp
    transaction.mints = []
    transaction.swaps = []
    transaction.burns = []
    transaction.save()
  }
  let swaps = transaction.swaps
  let swap = new Swap(
    event.transaction.hash
      .toHexString()
      .concat('-')
      .concat(BigInt.fromI32(swaps.length).toString())
  )
  swap.lpExtraFeeInToken0 = ZERO_BD
  swap.lpExtraFeeInToken1 = ZERO_BD

  // update swap event
  if (isFirstAmount0) {
    swap.lpExtraFeeInToken1 = swap.lpExtraFeeInToken1.plus(lpExtraFee)
  } else {
    swap.lpExtraFeeInToken0 = swap.lpExtraFeeInToken0.plus(lpExtraFee)
  }
  swap.pair = pair.id
  swap.timestamp = transaction.timestamp
  swap.sender = event.params.account
  swap.referral = event.params.referral
  swap.srcAmount = amountSrc
  swap.destAmount = amountDest
  swap.src = event.params.src
  swap.dest = event.params.dst
  swap.logIndex = event.logIndex
  // use the tracked amount if we have it
  swap.amountUSD = trackedAmountUSD === ZERO_BD ? derivedAmountUSD : trackedAmountUSD
  swap.referralReward = ZERO_BD

  if (swap.referral.toHexString() != ADDRESS_ZERO) {
    let pairContract = PairContract.bind(event.address)
    let newTotalSupply = pairContract.totalSupply()
    let referral = createLiquidityPosition(event.address, event.params.referral)
    referral.liquidityTokenBalance = convertTokenToDecimal(pairContract.balanceOf(event.params.referral), BI_18)
    if (newTotalSupply == BigInt.fromI32(0)) {
      referral.poolOwnership = BigDecimal.fromString('0.0')
    } else {
      referral.poolOwnership = referral.liquidityTokenBalance.div(
        convertTokenToDecimal(newTotalSupply, BI_18)
      )
    }
    referral.save()

    let mints = transaction.mints
    if (mints.length > 0) {
      let mint = Mint.load(mints[mints.length - 1].toString())
      if (mint.amount0 === ZERO_BD && mint.amount1 === ZERO_BD) {
        swap.referralReward = mint.liquidity
        swap.amountUSD = ZERO_BD
      }
    }
  }

  swap.save()

  // update the transaction
  swaps.push(swap.id)
  transaction.swaps = swaps
  transaction.save()


  handleSync(Address.fromString(pair.id))
  // update day entities
  updatePairDayData(event)
  updatePairHourData(event)
  updateEmiswapDayData(event)
  updateTokenDayData(token0 as Token, event)
  updateTokenDayData(token1 as Token, event)

  // get ids for date related entities
  let timestamp = event.block.timestamp.toI32()
  let dayID = timestamp / 86400
  let dayPairID = event.address
    .toHexString()
    .concat('-')
    .concat(BigInt.fromI32(dayID).toString())

  // swap specific updating
  let emiswapDayData = EmiswapDayData.load(dayID.toString())
  emiswapDayData.dailyVolumeUSD = emiswapDayData.dailyVolumeUSD.plus(trackedAmountUSD)
  emiswapDayData.dailyVolumeETH = emiswapDayData.dailyVolumeETH.plus(trackedAmountETH)
  emiswapDayData.save()

  // swap specific updating for pair
  let pairDayData = PairDayData.load(dayPairID)
  pairDayData.dailyVolumeToken0 = pairDayData.dailyVolumeToken0.plus(amount0)
  pairDayData.dailyVolumeToken1 = pairDayData.dailyVolumeToken1.plus(amount1)
  pairDayData.dailyVolumeUSD = pairDayData.dailyVolumeUSD.plus(trackedAmountUSD)
  pairDayData.save()

  // swap specific updating for token0
  let token0DayID = token0.id
    .toString()
    .concat('-')
    .concat(BigInt.fromI32(dayID).toString())
  let token0DayData = TokenDayData.load(token0DayID)
  token0DayData.dailyVolumeToken = token0DayData.dailyVolumeToken.plus(amount0)
  token0DayData.dailyVolumeETH = token0DayData.dailyVolumeETH.plus(amount0.times(token1.derivedETH as BigDecimal))
  token0DayData.dailyVolumeUSD = token0DayData.dailyVolumeUSD.plus(
    amount0.times(token0.derivedETH as BigDecimal).times(bundle.ethPrice)
  )
  token0DayData.save()

  // swap specific updating
  let token1DayID = token1.id
    .toString()
    .concat('-')
    .concat(BigInt.fromI32(dayID).toString())
  let token1DayData = TokenDayData.load(token1DayID)
  token1DayData = TokenDayData.load(token1DayID)
  token1DayData.dailyVolumeToken = token1DayData.dailyVolumeToken.plus(amount1)
  token1DayData.dailyVolumeETH = token1DayData.dailyVolumeETH.plus(amount1.times(token1.derivedETH as BigDecimal))
  token1DayData.dailyVolumeUSD = token1DayData.dailyVolumeUSD.plus(
    amount1.times(token1.derivedETH as BigDecimal).times(bundle.ethPrice)
  )
  token1DayData.save()
}
