'use strict'

module.exports = (o = {}) => {
  const m = o.side === 'SELL' ? -1 : 1
  const cid = o.clientOrderId.split('-')

  return {
    symbol: o.symbol,
    id: o.orderId,
    cid: +cid[0],
    gid: +cid[1],
    mtsCreate: o.transactTime,
    mtsUpdate: o.transactTime,
    price: +o.price,
    amount: m * (+o.origQty - +o.executedQty),
    amountOrig: m * (+o.origQty),
    status: o.status,
    type: o.type,
  }
}
