'use strict'

const debug = require('debug')('bfx:hf:ext-plugin:binance:models:candle:sync-range')
const PI = require('p-iteration')
const Promise = require('bluebird')
const _last = require('lodash/last')
const Binance = require('binance-api-node').default
const PromiseThrottle = require('promise-throttle')
const candleWidth = require('../../util/candle_width')

const FETCH_LIMIT = 1000
const client = Binance()
const pt = new PromiseThrottle({
  requestsPerSecond: 10, // taken from docs
  promiseImplementation: Promise
})

/**
 * Syncs a range of candles for the specified market. Only syncs candles that
 * are missing from the DB, and consolidates ranges for optimal data retrieval.
 *
 * @param {Candle} candleModel
 * @param {Object} candleMarket
 * @param {string} candleMarket.exchange
 * @param {string} candleMarket.type
 * @param {string} candleMarket.symbol
 * @param {string} candleMarket.tf
 * @param {Object} range
 * @param {number} range.start
 * @param {number} range.end
 * @param {Function?} onSyncStart - called with sync ranges before REST queries
 * @param {Function?} onSyncEnd - called with sync ranges after REST queries
 */
module.exports = async (candleModel, {
  exchange, type, symbol, tf
} = {}, {
    start,
    end
  }, onSyncStart = () => {}, onSyncEnd = () => {}) => {
  const { getInRange, auditGaps, upsert } = candleModel
  const width = candleWidth(tf)
  const existingCandles = await getInRange([
    ['exchange', '=', exchange],
    ['symbol', '=', symbol],
    ['tf', '=', tf]
  ], {
    key: 'mts',
    start,
    end
  }, {
    orderBy: 'mts',
    orderDirection: 'desc'
  })

  const boundsToSync = []

  // sync entire range
  if (existingCandles.length === 0) {
    boundsToSync.push({ start, end })
  } else if (existingCandles.length >= 2 && (
    existingCandles[0].mts === end && _last(existingCandles).mts === start
  )) {
    debug(
      'all candles present (%s -> %s)',
      new Date(start).toLocaleString(),
      new Date(end).toLocaleString()
    )

    onSyncEnd()
    return Promise.resolve()
  } else { // sync to fill gaps
    // cover start cap
    if (_last(existingCandles).mts - start > width) {
      boundsToSync.push({ start, end: _last(existingCandles).mts })
    }

    const gapData = await auditGaps({
      exchange,
      type,
      symbol,
      tf
    }, {
      start,
      end
    })

    // fill in gaps
    const { gaps } = gapData

    gaps.forEach(gapIndex => (
      boundsToSync.push({ // note candles are descending by mts
        // add half/take-away half of the candle width to make sure we don't
        // download the start/end candle that we already have locally

        // also to download a single candle you can't have the same start/end
        // time; otherwise we get a 400 error
        start: gapData.candles[gapIndex + 1].mts + (width / 2),
        end: gapData.candles[gapIndex].mts - (width / 2)
      })
    ))

    // cover end cap
    if (end - existingCandles[0].mts > width) {
      boundsToSync.push({ start: existingCandles[0].mts, end })
    }
  }

  if (boundsToSync.length === 0) {
    debug(
      'all candles present (%s -> %s)',
      new Date(start).toLocaleString(),
      new Date(end).toLocaleString()
    )

    onSyncEnd()
    return Promise.resolve()
  }

  const consolidatedBounds = []
  let currentStart = boundsToSync[0].start
  let nextBoundIsLeftover = false

  for (let i = 0; i < boundsToSync.length; i += 1) {
    const { end } = boundsToSync[i]

    if (end - currentStart > (width * FETCH_LIMIT)) {
      consolidatedBounds.push({
        start: currentStart,
        end: currentStart + (width * FETCH_LIMIT)
      })

      nextBoundIsLeftover = true
      boundsToSync.splice(i + 1, 0, {
        start: currentStart + (width * FETCH_LIMIT),
        end
      })

      currentStart = boundsToSync[i + 1].start
    } else if (nextBoundIsLeftover && i === boundsToSync.length - 1) {
      consolidatedBounds.push(boundsToSync[i])
    } else {
      nextBoundIsLeftover = false
    }
  }

  if (consolidatedBounds.length === 0) {
    consolidatedBounds.push({
      start: currentStart,
      end: _last(boundsToSync).end
    })
  }

  // NOTE: There is a bug in the logic above resulting in bounds w/ start after
  //       end. This is a temporary workaround
  //
  // TODO: Fix bug
  consolidatedBounds.forEach((bounds) => {
    if (bounds.start > bounds.end) {
      const { start } = bounds
      bounds.start = bounds.end
      bounds.end = start
    }
  })

  debug('-- syncing ranges')
  debug(
    consolidatedBounds
      .map(({ start, end }) => `${start}-${end} [${(end - start) / width} candles]`)
      .join('\n')
  )
  debug('--')

  onSyncStart(consolidatedBounds)

  return PI.mapSeries(consolidatedBounds, async ({ start, end }) => (
    pt.add(
      client.candles.bind(client, {
        interval: tf,
        symbol,
        limit: FETCH_LIMIT,
        startTime: start,
        endTime: end
      })
    )
  )).then(candleSets => {
    debug('fetched data, processing & saving...')

    return PI.forEachSeries(candleSets, async (candles) => {
      debug('saving %d candles', candles.length)

      return PI.forEachSeries(candles, c => {
        return upsert({
          open: +c.open,
          high: +c.high,
          low: +c.low,
          close: +c.close,
          volume: +c.volume,
          mts: c.openTime,

          key: `${exchange}-${symbol}-${tf}-${c.openTime}`,
          exchange,
          symbol,
          tf
        })
      })
    })
  }).then(() => {
    onSyncEnd(consolidatedBounds)
  }).catch((e) => {
    debug('error syncing candles: %s', e.stack)
    onSyncEnd(consolidatedBounds)
  })
}
