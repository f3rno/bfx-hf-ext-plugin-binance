'use strict'

const TIME_FRAMES = {
  '1m': 60 * 1000,
  '5m': 5 * 60 * 1000,
  '15m': 15 * 60 * 1000,
  '30m': 30 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '3h': 3 * 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '12h': 12 * 60 * 60 * 1000,
  '1D': 24 * 60 * 60 * 1000,
  '7D': 7 * 24 * 60 * 60 * 1000,
  '14D': 14 * 24 * 60 * 60 * 1000,
  '1M': 30 * 24 * 60 * 60 * 1000
}

module.exports = tf => TIME_FRAMES[tf]
