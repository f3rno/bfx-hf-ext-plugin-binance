'use strict'

module.exports = (o = {}) => {
  let type

  switch (o.type) {
    case 'LIMIT':
    case 'EXCHANGE LIMIT': {
      type = 'LIMIT'
      break
    }

    case 'MARKET':
    case 'EXCHANGE MARKET': {
      type = 'MARKET'
      break
    }

    default: {
      throw new Error(`unsupported order type: ${type}`)
    }
  }

  return {
    type,
    symbol: o.symbol,
    newClientOrderId: `${o.cid}-${o.gid}`,
    price: o.price,
    quantity: Math.abs(o.amount),
    side: o.amount < 0 ? 'SELL' : 'BUY',
  }
}
