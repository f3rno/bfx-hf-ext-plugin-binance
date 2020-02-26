'use strict'

module.exports = (mts, u = {}) => ({
  open: +u.open,
  high: +u.high,
  low: +u.low,
  close: +u.close,
  volume: +u.volume,
  mts
})
