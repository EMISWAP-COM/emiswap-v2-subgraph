/* eslint-disable prefer-const */
import { Bundle, Pair, Token } from '../types/schema'
import {Address, BigDecimal, log, Value} from '@graphprotocol/graph-ts/index'
import { ADDRESS_ZERO, factoryContract, ZERO_BD } from './helpers'

export const KCS_ADDRESS = '0x4446fc4eb47f2f6586f9faab68b3498f86c07521'; // WKCS
export const ETH_ADDRESS = KCS_ADDRESS; // '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'; // (WETH)

export const DAI_ETH_PAIR = '0xc9baa8cfdde8e328787e29b4b078abf2dadc2055' // '0xe2b150625e57ed27fbae3d27857953b3e1bd6eac'
export const USDT_ETH_PAIR = '0xaca93dc131fd962e82b09aa7a66d193b8ccbb860' // '0xc02aee6e383b53b4b04dfbb9c5c76ebc2751522a'
export const USDC_ETH_PAIR =  '0x980a5afef3d17ad98635f6c5aebcbaeded3c3430' // '0x61bb2fda13600c497272a8dd029313afdb125fd3'

export function getEthTokenPrice(pair: Pair): BigDecimal {
  return pair.token1Price.gt(pair.token0Price)
    ? pair.token1Price
    : pair.token0Price;
}

// fetch eth prices for each stablecoin
export function getEthPriceInUSD(): BigDecimal {

  let daiPair = Pair.load(DAI_ETH_PAIR) // dai is token1
  let usdcPair = Pair.load(USDC_ETH_PAIR) // usdc is token1
  let usdtPair = Pair.load(USDT_ETH_PAIR) // usdt is token1

  /*log.debug('getEthPriceInUSD pairs: daiPair {}, usdcPair {}, usdtPair {}', [
    daiPair !== null ? 'true' : 'false',
    usdcPair !== null ? 'true' : 'false',
    usdtPair !== null ? 'true' : 'false'
  ]);*/

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
    return ZERO_BD
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

  let usdtPair = Pair.load(USDT_ETH_PAIR)
  return getEthTokenPrice(usdtPair!)

  // return ZERO_BD
}

// token where amounts should contribute to tracked volume and liquidity
let WHITELIST: string[] = [
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', // WETH
   ETH_ADDRESS, // ETH
  '0x4446fc4eb47f2f6586f9faab68b3498f86c07521', // WKCS
  '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599', // WBTC
  '0x0000000000004946c0e9f43f4dee607b0ef1fa1c', // CHI
  '0x6b175474e89094c44da98b954eedeac495271d0f', // DAI
  '0x980a5afef3d17ad98635f6c5aebcbaeded3c3430', // '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC
  '0x0039f574ee5cc39bdd162e9a88e3eb1f111baf48', // '0xdac17f958d2ee523a2206206994597c13d831ec7', // USDT
  '0x0000000000085d4780b73119b644ae5ecd22b376', // TUSD
  '0x5d3a536e4d6dbd6114cc1ead35777bab948e3643', // cDAI
  '0x39aa39c021dfbae8fac545936693ac917d5e7563', // cUSDC
  '0x86fadb80d8d2cff3c3680819e4da99c10232ba0f', // EBASE
  '0x57ab1ec28d129707052df4df418d58a2d46d5f51', // sUSD
  '0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2', // MKR
  '0xc00e94cb662c3520282e6f5717214004a7f26888', // COMP
  '0xfc56a7e70f6c970538020cc39939929b4d393f1f', // KUST
  '0xc0ffee0000921eb8dd7d506d4de8d5b79b856157', // Koffee
  '0xfc56a7e70f6c970538020cc39939929b4d393f1f', // KUST
]

let USD_LIST: string[] = [
  '0x6b175474e89094c44da98b954eedeac495271d0f', // DAI
  '0x980a5afef3d17ad98635f6c5aebcbaeded3c3430', // '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC
  '0x0039f574ee5cc39bdd162e9a88e3eb1f111baf48', // '0xdac17f958d2ee523a2206206994597c13d831ec7', // USDT
];

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
