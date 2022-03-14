import { Bundle, Pair, Token } from '../types/schema'
import { Address, BigDecimal } from '@graphprotocol/graph-ts/index'
import { ADDRESS_ZERO, factoryContract, ZERO_BD } from './helpers'

export const WETH_ADDRESS = '0xC9BdeEd33CD01541e1eeD10f90519d2C06Fe3feB';
export const ETH_ADDRESS = WETH_ADDRESS;

export const ETH_DAI = '0xccf1d233b294018f514a2df9e781a3a888e338e6';
export const USDT_ETH = '0xfa9b5c93c9c1bc0a3e3b44c984bcf8921cd50244';
export const USDC_ETH = '0x231688d4cae0b09c0a8f3b275980933edbb745ae';

export const DAI_TOKEN = '0xe3520349f477a5f6eb06107066048508498a291b';
export const USDT_TOKEN = '0x4988a896b1227218e4a686fde5eabdcabd91571f';
export const USDC_TOKEN = '0xb12bfca5a55806aaf64e99521918a4bf0fc40802';

export function getEthTokenPrice(pair: Pair): BigDecimal {
  if (pair.token1 === DAI_TOKEN) {
    return pair.token1Price;
  }
  return pair.token0Price;
}

// fetch eth prices for each stablecoin
export function getEthPriceInUSD(): BigDecimal {

  let daiPair = Pair.load(ETH_DAI) // dai is token1
  let usdcPair = Pair.load(USDC_ETH) // usdc is token0
  let usdtPair = Pair.load(USDT_ETH) // usdt is token0

  if (daiPair !== null && usdcPair !== null && usdtPair !== null) {
    let totalLiquidityETH = daiPair.reserve0.plus(usdcPair.reserve0).plus(usdtPair.reserve0)
    let daiWeight = daiPair.reserve0.div(totalLiquidityETH)
    let usdcWeight = usdcPair.reserve0.div(totalLiquidityETH)
    let usdtWeight = usdtPair.reserve0.div(totalLiquidityETH)
    return getEthTokenPrice(daiPair!)
        .times(daiWeight)
        .plus(getEthTokenPrice(usdcPair!).times(usdcWeight))
        .plus(getEthTokenPrice(usdtPair!).times(usdtWeight))
  } else if (daiPair !== null && usdcPair !== null) {
    let totalLiquidityETH = daiPair.reserve0.plus(usdcPair.reserve0)
    let daiWeight = daiPair.reserve0.div(totalLiquidityETH)
    let usdcWeight = usdcPair.reserve0.div(totalLiquidityETH)
    return getEthTokenPrice(daiPair!).times(daiWeight).plus(getEthTokenPrice(usdcPair!).times(usdcWeight))
  } else if (daiPair !== null && usdtPair !== null) {
    let totalLiquidityETH = daiPair.reserve0.plus(usdtPair.reserve0)
    let daiWeight = daiPair.reserve0.div(totalLiquidityETH)
    let usdtWeight = usdtPair.reserve0.div(totalLiquidityETH)
    return getEthTokenPrice(daiPair!).times(daiWeight).plus(getEthTokenPrice(usdtPair!).times(usdtWeight))
  } else if (usdcPair !== null) {
    return getEthTokenPrice(usdcPair!)
  } else if (usdtPair !== null) {
    return getEthTokenPrice(usdtPair!)
  } else {
    return BigDecimal.fromString('2620');
  }
}

/**
 * Search through graph to find derived Eth per token.
 * @todo update to be derived ETH (add stablecoin estimates)
 **/
export function findEthPerToken(token: Token, maxDepthReached: boolean): BigDecimal {
  let tokenEthPair = factoryContract.pools(Address.fromString(token.id), Address.fromString(ETH_ADDRESS))

  if (tokenEthPair.toHexString() != ADDRESS_ZERO) {
    let ethPair = Pair.load(tokenEthPair.toHexString())
    if (ethPair.token0 == token.id) {
      // our token is token 0
      return ethPair.token1Price
    } else {
      // our token is token 1
      return ethPair.token0Price
    }
  } else if (!maxDepthReached) {
    let allPairs = token.allPairs as Array<string>

    // sort pairs by reserves to get best estimate
    let sortedPairs = allPairs.sort((addressA, addressB) => {
      let pairA = Pair.load(addressA)
      let pairB = Pair.load(addressB)
      if (pairA.trackedReserveETH.gt(pairB.trackedReserveETH)) {
        return -1
      } else if (pairA.trackedReserveETH.lt(pairB.trackedReserveETH)) {
        return 1
      } else {
        return 0
      }
    })

    for (let i = 0; i < sortedPairs.length; i++) {
      let currentPair = Pair.load(sortedPairs[i])
      if (currentPair.token0 == token.id) {
        // our token is token 0
        let otherToken = Token.load(currentPair.token1)
        let otherTokenEthPrice = findEthPerToken(otherToken as Token, true)
        if (otherTokenEthPrice != null) {
          return currentPair.token1Price.times(otherTokenEthPrice)
        }
      } else {
        // our token is token 1
        let otherToken = Token.load(currentPair.token0)
        let otherTokenEthPrice = findEthPerToken(otherToken as Token, true)
        if (otherTokenEthPrice != null) {
          return currentPair.token0Price.times(otherTokenEthPrice)
        }
      }
    }
  }

  // let usdtPair = Pair.load(USDT_ETH_PAIR)
  // return getEthTokenPrice(usdtPair!)

  return ZERO_BD
}

// token where amounts should contribute to tracked volume and liquidity
let WHITELIST: string[] = [
  ETH_ADDRESS,
  DAI_TOKEN,
  USDT_TOKEN,
  USDC_TOKEN,
]

let USD_LIST: string[] = [
  DAI_TOKEN,
  USDT_TOKEN,
  USDC_TOKEN,
]

let MINIMUM_USD_THRESHOLD_NEW_PAIRS = BigDecimal.fromString('200000')

export function geUsdPerToken(pair: Pair, token: Token): BigDecimal {
  if (USD_LIST.includes(token.id) && pair.token0 == token.id) {
    return pair.token0Price
  } else if (USD_LIST.includes(token.id) && pair.token1 == token.id) {
    return pair.token1Price
  }

  return ZERO_BD
}

/**
 * Accepts tokens and amounts, return tracked amount based on token whitelist
 * If one token on whitelist, return amount in that token converted to USD.
 * If both are, return average of two amounts
 * If neither is, return 0
 */
export function getTrackedVolumeUsdWithEth(
  tokenAmount0: BigDecimal,
  token0: Token,
  tokenAmount1: BigDecimal,
  token1: Token
): BigDecimal {
  let bundle = Bundle.load('1')
  let price0 = token0.derivedETH.times(bundle.ethPrice)
  let price1 = token1.derivedETH.times(bundle.ethPrice)
  let pairAddress = factoryContract.pools(Address.fromString(token0.id), Address.fromString(token1.id))
  let pair = Pair.load(pairAddress.toHexString())

  // if only 1 LP, require high minimum reserve amount amount or return 0
  if (pair.liquidityPositions.length < 5) {
    let reserve0USD = pair.reserve0.times(price0)
    let reserve1USD = pair.reserve1.times(price1)
    if (WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
      if (reserve0USD.plus(reserve1USD).lt(MINIMUM_USD_THRESHOLD_NEW_PAIRS)) {
        return ZERO_BD
      }
    }
    if (WHITELIST.includes(token0.id) && !WHITELIST.includes(token1.id)) {
      if (reserve0USD.times(BigDecimal.fromString('2')).lt(MINIMUM_USD_THRESHOLD_NEW_PAIRS)) {
        return ZERO_BD
      }
    }
    if (!WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
      if (reserve1USD.times(BigDecimal.fromString('2')).lt(MINIMUM_USD_THRESHOLD_NEW_PAIRS)) {
        return ZERO_BD
      }
    }
  }

  if (WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    // both are whitelist tokens, take average of both amounts
    return tokenAmount0
      .times(price0)
      .plus(tokenAmount1.times(price1))
      .div(BigDecimal.fromString('2'))
  }

  // take full value of the whitelisted token amount
  if (WHITELIST.includes(token0.id) && !WHITELIST.includes(token1.id)) {
    return tokenAmount0.times(price0)
  }

  // take full value of the whitelisted token amount
  if (!WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount1.times(price1)
  }

  // neither token is on white list, tracked volume is 0
  return ZERO_BD
}

/**
 * Accepts tokens and amounts, return tracked amount based on token whitelist
 * If one token on whitelist, return amount in that token converted to USD * 2.
 * If both are, return sum of two amounts
 * If neither is, return 0
 */
export function getTrackedLiquidityUsdWithEth(
  tokenAmount0: BigDecimal,
  token0: Token,
  tokenAmount1: BigDecimal,
  token1: Token
): BigDecimal {
  let bundle = Bundle.load('1')
  let price0 = token0.derivedETH.times(bundle.ethPrice)
  let price1 = token1.derivedETH.times(bundle.ethPrice)

  // both are whitelist tokens, take average of both amounts
  if (WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount0.times(price0).plus(tokenAmount1.times(price1))
  }

  // take double value of the whitelisted token amount
  if (WHITELIST.includes(token0.id) && !WHITELIST.includes(token1.id)) {
    return tokenAmount0.times(price0).times(BigDecimal.fromString('2'))
  }

  // take double value of the whitelisted token amount
  if (!WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount1.times(price1).times(BigDecimal.fromString('2'))
  }

  // neither token is on white list, tracked volume is 0
  return ZERO_BD
}

export function getTrackedVolumeUSD(
    tokenAmount0: BigDecimal,
    token0: Token,
    tokenAmount1: BigDecimal,
    token1: Token
): BigDecimal {
  /*let pairAddress = factoryContract.pools(Address.fromString(token0.id), Address.fromString(token1.id))
  let pair = Pair.load(pairAddress.toHexString())*/

  // if only 1 LP, require high minimum reserve amount amount or return 0
  /*if (pair.liquidityPositions.length < 5) {
    if (USD_LIST.includes(token0.id) && USD_LIST.includes(token1.id)) {
      if (tokenAmount0.lt(MINIMUM_USD_THRESHOLD_NEW_PAIRS)) {
        return ZERO_BD
      }
    }
    if (USD_LIST.includes(token0.id) && !USD_LIST.includes(token1.id)) {
      if (tokenAmount0.lt(MINIMUM_USD_THRESHOLD_NEW_PAIRS)) {
        return ZERO_BD
      }
    }
    if (!USD_LIST.includes(token0.id) && USD_LIST.includes(token1.id)) {
      if (tokenAmount1.lt(MINIMUM_USD_THRESHOLD_NEW_PAIRS)) {
        return ZERO_BD
      }
    }
  }*/

  if (USD_LIST.includes(token0.id) && USD_LIST.includes(token1.id)) {
    // both are whitelist tokens, take average of both amounts
    return tokenAmount0.plus(tokenAmount1)
  }

  // take full value of the whitelisted token amount
  if (USD_LIST.includes(token0.id) && !USD_LIST.includes(token1.id)) {
    return tokenAmount0.times(BigDecimal.fromString('2'))
  }

  // take full value of the whitelisted token amount
  if (!USD_LIST.includes(token0.id) && USD_LIST.includes(token1.id)) {
    return tokenAmount1.times(BigDecimal.fromString('2'))
  }

  // neither token is on white list, tracked volume is 0
  return ZERO_BD
}

export function getTrackedLiquidityUSD(
    tokenAmount0: BigDecimal,
    token0: Token,
    tokenAmount1: BigDecimal,
    token1: Token
): BigDecimal {

  if (USD_LIST.includes(token0.id) && USD_LIST.includes(token1.id)) {
    return tokenAmount0.plus(tokenAmount1)
  }

  if (USD_LIST.includes(token0.id) && !USD_LIST.includes(token1.id)) {
    return tokenAmount0.times(BigDecimal.fromString('2'))
  }

  if (!USD_LIST.includes(token0.id) && USD_LIST.includes(token1.id)) {
    return tokenAmount1.times(BigDecimal.fromString('2'))
  }

  return ZERO_BD
}
