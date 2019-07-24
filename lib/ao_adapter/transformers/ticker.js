'use strict'

module.exports = (symbol, u = {}) => ({
  symbol,
  bid: +u.bestBid,
  ask: +u.bestAsk,
  dailyChange: +u.priceChange,
  dailyChangePerc: +u.priceChangePercent / 100,
  lastPrice: +u.curDayaClose,
  volume: +u.volume,
  high: +u.high,
  low: +u.low,
})
