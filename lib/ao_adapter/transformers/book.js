'use strict'

const { OrderBook } = require('bfx-api-node-models')

module.exports = (book = {}) => {
  const { bids = [], asks = [] } = book
  const transformedBids = []
  const transformedAsks = []

  for (let i = asks.length - 1; i >= 0; i -= 1) {
    transformedAsks.push([+asks[i].price, 0, -1 * +asks[i].quantity])
  }

  for (let i = 0; i < bids.length; i += 1) {
    transformedBids.push([+bids[i].price, 0, +bids[i].quantity])
  }

  return new OrderBook({
    bids: transformedBids,
    asks: transformedAsks,
  })
}
