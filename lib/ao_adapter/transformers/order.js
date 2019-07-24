'use strict'

module.exports = (o = {}) => {
  const m = o.side === 'SELL' ? -1 : 1

  return {
    symbol: o.symbol,
    id: o.orderId,
    cid: +o.clientOrderId,
    gid: +o.clientOrderId,
    mtsCreate: o.transactTime,
    mtsUpdate: o.transactTime,
    price: +o.price,
    amount: m * (+o.origQty - +o.executedQty),
    amountOrig: m * (+o.origQty),
    status: o.status,
    type: o.type,
  }
}
