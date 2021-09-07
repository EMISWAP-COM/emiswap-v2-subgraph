/* eslint-disable prefer-const */
import { Address, BigDecimal, BigInt, log } from '@graphprotocol/graph-ts'
import { ERC20 } from '../types/Factory/ERC20'
import { ERC20 as ERC20Telmplate } from '../types/templates/Pair/ERC20'
import { ERC20SymbolBytes } from '../types/Factory/ERC20SymbolBytes'
import { ERC20NameBytes } from '../types/Factory/ERC20NameBytes'
import { Bundle, EmiswapFactory, LiquidityPosition, Pair, Token, User } from '../types/schema'
import { Factory as FactoryContract } from '../types/templates/Pair/Factory'
import {
  findEthPerToken,
  getEthPriceInUSD,
  getTrackedLiquidityUSD,
  getTrackedLiquidityUsdWithEth,
  geUsdPerToken
} from './pricing'

export const ADDRESS_ZERO = '0x0000000000000000000000000000000000000000'
export let ETH_ADDRESS = ADDRESS_ZERO
export const FACTORY_ADDRESS = '0x945316F2964ef5C6C84921b435a528DD1790E93a' // '0x1771dff85160768255F0a44D20965665806cBf48'
export const ETH_BALANCE_CONTRACT = '0xa92462214637371cb3d6e0d5a8180e656157c845' // '0x42f527F50F16A103b6ccAb48BcCca214500c1021'

export let ZERO_BI = BigInt.fromI32(0)
export let ONE_BI = BigInt.fromI32(1)
export let ZERO_BD = BigDecimal.fromString('0')
export let ONE_BD = BigDecimal.fromString('1')
export let BI_18 = BigInt.fromI32(18)
export let EXP_18 = BigInt.fromI32(10).pow(18)
export let uniswapFee = (BigInt.fromI32(10).pow(15)).times(BigInt.fromI32(3))

export let factoryContract = FactoryContract.bind(Address.fromString(FACTORY_ADDRESS))

export function exponentToBigDecimal(decimals: BigInt): BigDecimal {
  let bd = BigDecimal.fromString('1')
  for (let i = ZERO_BI; i.lt(decimals as BigInt); i = i.plus(ONE_BI)) {
    bd = bd.times(BigDecimal.fromString('10'))
  }
  return bd
}

export function bigDecimalExp18(): BigDecimal {
  return BigDecimal.fromString('1000000000000000000')
}

export function convertEthToDecimal(eth: BigInt): BigDecimal {
  return eth.toBigDecimal().div(exponentToBigDecimal(18))
}

export function convertTokenToDecimal(tokenAmount: BigInt, exchangeDecimals: BigInt): BigDecimal {
  if (exchangeDecimals == ZERO_BI) {
    return tokenAmount.toBigDecimal()
  }
  return tokenAmount.toBigDecimal().div(exponentToBigDecimal(exchangeDecimals))
}

export function equalToZero(value: BigDecimal): boolean {
  const formattedVal = parseFloat(value.toString())
  const zero = parseFloat(ZERO_BD.toString())
  if (zero == formattedVal) {
    return true
  }
  return false
}

export function isNullEthValue(value: string): boolean {
  return value == '0x0000000000000000000000000000000000000000000000000000000000000001'
}

export class TokensMap {
  tokenETH: Token
  tokenStable: Token
}

export function getTokensMap(pair: Pair | null): TokensMap {
  if (true || pair.token0 === ETH_ADDRESS) {
    return {
      tokenETH: Token.load(pair.token0) as Token,
      tokenStable: Token.load(pair.token1) as Token
    }
  } else {
    return {
      tokenETH: Token.load(pair.token1) as Token,
      tokenStable: Token.load(pair.token0) as Token
    }
  }
}

export class ReservesMap {
  reserveETH: BigDecimal
  reserveStable: BigDecimal
}

export function getReservesMap(pair: Pair | null): ReservesMap {
  if (pair.reserve1.gt(pair.reserve0)) {
    return {
      reserveETH: pair.reserve0,
      reserveStable: pair.reserve1
    }
  } else {
    return {
      reserveETH: pair.reserve1,
      reserveStable: pair.reserve0
    }
  }
}

export function fetchTokenSymbol(tokenAddress: Address): string {
  // hard coded override
  if (tokenAddress.toHexString() == ETH_ADDRESS) {
    return 'ETH'
  }
  if (tokenAddress.toHexString() == '0xe0b7927c4af23765cb51314a0e0521a9645f0e2a') {
    return 'DGD'
  }

  let contract = ERC20.bind(tokenAddress)
  let contractSymbolBytes = ERC20SymbolBytes.bind(tokenAddress)

  // try types string and bytes32 for symbol
  let symbolValue = 'unknown'
  let symbolResult = contract.try_symbol()
  if (symbolResult.reverted) {
    let symbolResultBytes = contractSymbolBytes.try_symbol()
    if (!symbolResultBytes.reverted) {
      // for broken pairs that have no symbol function exposed
      if (!isNullEthValue(symbolResultBytes.value.toHexString())) {
        symbolValue = symbolResultBytes.value.toString()
      }
    }
  } else {
    symbolValue = symbolResult.value
  }

  return symbolValue
}

export function fetchTokenName(tokenAddress: Address): string {
  // hard coded override
  if (tokenAddress.toHexString() == ETH_ADDRESS) {
    return 'Ethereum'
  }
  if (tokenAddress.toHexString() == '0xe0b7927c4af23765cb51314a0e0521a9645f0e2a') {
    return 'DGD'
  }

  let contract = ERC20.bind(tokenAddress)
  let contractNameBytes = ERC20NameBytes.bind(tokenAddress)

  // try types string and bytes32 for name
  let nameValue = 'unknown'
  let nameResult = contract.try_name()
  if (nameResult.reverted) {
    let nameResultBytes = contractNameBytes.try_name()
    if (!nameResultBytes.reverted) {
      // for broken exchanges that have no name function exposed
      if (!isNullEthValue(nameResultBytes.value.toHexString())) {
        nameValue = nameResultBytes.value.toString()
      }
    }
  } else {
    nameValue = nameResult.value
  }

  return nameValue
}

export function fetchTokenTotalSupply(tokenAddress: Address): BigInt {
  let contract = ERC20.bind(tokenAddress)
  let totalSupplyValue = null
  let totalSupplyResult = contract.try_totalSupply()
  if (!totalSupplyResult.reverted) {
    totalSupplyValue = totalSupplyResult as i32
  }
  return BigInt.fromI32(totalSupplyValue as i32)
}

export function fetchTokenDecimals(tokenAddress: Address): BigInt {
  if (tokenAddress.toHexString() == ETH_ADDRESS) {
    return BigInt.fromI32(18)
  }
  let contract = ERC20.bind(tokenAddress)
  // try types uint8 for decimals
  let decimalValue = null
  let decimalResult = contract.try_decimals()
  if (!decimalResult.reverted) {
    decimalValue = decimalResult.value
  }
  return BigInt.fromI32(decimalValue as i32)
}

export function createLiquidityPosition(exchange: Address, user: Address): LiquidityPosition {
  let id = exchange
    .toHexString()
    .concat('-')
    .concat(user.toHexString())
  let liquidityTokenBalance = LiquidityPosition.load(id)
  if (liquidityTokenBalance === null) {
    liquidityTokenBalance = new LiquidityPosition(id)
    liquidityTokenBalance.liquidityTokenBalance = ZERO_BD
    liquidityTokenBalance.pair = exchange.toHexString()
    liquidityTokenBalance.user = user.toHexString()
    liquidityTokenBalance.save()
  }
  if (liquidityTokenBalance == null) {
    log.error('LiquidityTokenBalance is null', [id])
  }
  return liquidityTokenBalance as LiquidityPosition
}

export function createUser(address: Address): void {
  let user = User.load(address.toHexString())
  if (user === null) {
    user = new User(address.toHexString())
    user.usdSwapped = ZERO_BD
    user.save()
  }
}

export function fetchReserves(pairAddress: string): Array<BigInt> {
  let pair = Pair.load(pairAddress)
  let token0 = pair.token0 == ETH_ADDRESS ? Address.fromString(ETH_BALANCE_CONTRACT) : Address.fromString(pair.token0)
  let token1 = pair.token1 == ETH_ADDRESS ? Address.fromString(ETH_BALANCE_CONTRACT) : Address.fromString(pair.token1)
  let contract0 = ERC20Telmplate.bind(token0)
  let contract1 = ERC20Telmplate.bind(token1)
  let reserve0 = contract0.try_balanceOf(Address.fromString(pair.id))
  let reserve1 = contract1.try_balanceOf(Address.fromString(pair.id))
  return [reserve0.value, reserve1.value]
}

// export function fetchVirtualReserves(pairAddress: string, srcToken: string, dstToken: string): Array<BigInt> {
//   let contract = PairContract.bind(Address.fromString(pairAddress))
//   let srcAddition = contract.try_getBalanceForAddition(Address.fromString(srcToken))
//   let destRemoval = contract.try_getBalanceForAddition(Address.fromString(dstToken))
//   return [srcAddition.value, destRemoval.value]
// }

export function handleSync(pairAddress: Address): void {
  let pair = Pair.load(pairAddress.toHex())
  let token0 = Token.load(pair.token0)
  let token1 = Token.load(pair.token1)
  let emiswap = EmiswapFactory.load(FACTORY_ADDRESS)
  let reserves = fetchReserves(pair.id)

  // reset factory liquidity by subtracting only tracked liquidity
  emiswap.totalLiquidityETH = emiswap.totalLiquidityETH.minus(pair.trackedReserveETH as BigDecimal)

  pair.reserve0 = convertTokenToDecimal(reserves[0], token0.decimals)
  pair.reserve1 = convertTokenToDecimal(reserves[1], token1.decimals)
  pair.token0Price = pair.reserve0.div(pair.reserve1)
  pair.token1Price = pair.reserve1.div(pair.reserve0)
  pair.save()

  // update ETH price now that reserves could have changed
  let bundle = Bundle.load('1')
  bundle.ethPrice = getEthPriceInUSD()
  bundle.save()

  // log.debug('bundle.ethPrice: {}', [bundle.ethPrice.toString()])

  token0.derivedETH = findEthPerToken(token0 as Token, false)
  token1.derivedETH = findEthPerToken(token1 as Token, false)
  token0.derivedUSD = geUsdPerToken(pair as Pair, token0 as Token)
  token1.derivedUSD = geUsdPerToken(pair as Pair, token1 as Token)
  token0.save()
  token1.save()

  // get tracked liquidity - will be 0 if neither is in whitelist
  let trackedLiquidityETH: BigDecimal
  let trackedLiquidityUSD: BigDecimal

  // let tokensMap = getTokensMap(pair);
  let tokenETH = token0 as Token; // tokensMap.tokenETH;
  let tokenStable = token1 as Token; // tokensMap.tokenStable;

  // let reservesMap = getReservesMap(pair);
  let reserveETH = pair.reserve0; // reservesMap.reserveETH;
  let reserveStable = pair.reserve1; // reservesMap.reserveStable;

  trackedLiquidityUSD = getTrackedLiquidityUSD(pair.reserve0, token0 as Token, pair.reserve1, token1 as Token)

  if (bundle.ethPrice.notEqual(ZERO_BD)) {
    trackedLiquidityUSD = getTrackedLiquidityUsdWithEth(reserveETH, tokenETH, reserveStable, tokenStable)
    trackedLiquidityETH = trackedLiquidityUSD.div(bundle.ethPrice)
  } else {
    trackedLiquidityETH = ZERO_BD
  }

  let deltaLiquidityETH = trackedLiquidityETH.notEqual(ZERO_BD)
    ? trackedLiquidityETH.minus(pair.reserveETH.times(bundle.ethPrice))
    : ZERO_BD 

  let deltaLiquidityUSD = trackedLiquidityUSD.notEqual(ZERO_BD)
    ? trackedLiquidityUSD.minus(pair.reserveUSD)
    : ZERO_BD

  // use derived amounts within pair
  pair.trackedReserveETH = trackedLiquidityETH
  pair.reserveETH = reserveETH
    .times(tokenETH.derivedETH as BigDecimal)
    .plus(reserveStable.times(tokenStable.derivedETH as BigDecimal))

  if (trackedLiquidityUSD.notEqual(ZERO_BD)) {
    pair.reserveUSD = trackedLiquidityUSD
  } else {
    pair.reserveUSD = pair.reserveETH.times(bundle.ethPrice)
  }

  // use tracked amounts globally
  emiswap.totalLiquidityETH = emiswap.totalLiquidityETH.plus(deltaLiquidityETH)
  emiswap.totalLiquidityUSD = emiswap.totalLiquidityUSD.plus(deltaLiquidityUSD)

  // save entities
  pair.save()
  emiswap.save()
}

export function getEmiswapFee(): BigInt {
  let contract = FactoryContract.bind(Address.fromString(FACTORY_ADDRESS))
  return contract.fee()
}

export function calculateFormula(balA: BigInt, balB: BigInt, amount: BigInt, fee: BigInt): BigInt {
  let taxedAmount = amount.minus(amount.times(fee).div(EXP_18))
  return taxedAmount.times(balB).div(balA.plus(taxedAmount))
}
