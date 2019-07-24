'use strict'

const Promise = require('bluebird')
const { EventEmitter } = require('events')
const PI = require('p-iteration')
const _flatten = require('lodash/flatten')
const Binance = require('binance-api-node').default
const debug = require('debug')('bfx:hf:ext-plugin-binance:ao-adapter')

const candleWidth = require('./candle_width')
const chanDataToKey = require('./chan_data_to_key')
const bookTransformer = require('./transformers/book')
const tickerTransformer = require('./transformers/ticker')
const tradeTransformer = require('./transformers/trade')
const candleTransformer = require('./transformers/candle')
const orderTransformer = require('./transformers/order')
const clientOrderTransformer = require('./transformers/client_order')

module.exports = class AOAdapter extends EventEmitter {
  constructor ({ apiKey, apiSecret }) {
    super()

    this._apiKey = apiKey
    this._apiSecret = apiSecret
    this._client = null
    this._subs = {} // [chanKey]: unsub
    this._lastFinalCandleForChannel = {}
  }

  connect () {
    if (!this._client) {
      this._client = Binance({
        apiKey: this._apiKey,
        apiSecret: this._apiSecret,
      })

      this.emit('open')
      this.emit('auth:success')
      this.requestOrderSnapshot()
    }

    return this._client
  }

  disconnect () {
    this._client.close()
    this._client = null
  }

  getConnection () {
    return {
      id: 0,
      c: this._client,
    }
  }

  orderEventsValid () {
    return true
  }

  async requestOrderSnapshot () {
    const symbols = this.getExchangeInfo().then((res = {}) => {
      const { symbols = [] } = res
      return symbols.map(s => s.symbol)
    })

    const allOrders = await PI.map(symbols, async (symbol) => {
      const orders = await this._client.openOrders({ symbol })
      return orders.map(orderTransformer)
    })

    const orders = _flatten(allOrders)

    this.emit('order:snapshot', orders)
  }

  onTickerData (symbol, data) {
    const ticker = tickerTransformer(symbol, data)

    this.emit('data:ticker', ticker, {
      chanFilter: { symbol }
    })
  }

  onTradeData (symbol, data) {
    const trade = tradeTransformer(symbol, data)

    this.emit('data:trade', trade, {
      chanFilter: { symbol }
    })

    this.emit('trades', [trade])
  }

  onCandleData (chanKey, symbol, tf, data) {
    const { isFinal } = data
    const last = this._lastFinalCandleForChannel[chanKey]

    if (!isFinal && !last) {
      return // we need at least 1 final candle to get mts
    }

    const mts = isFinal
      ? candle.eventTime
      : last.eventTime + candleWidth(tf)

    const candle = candleTransformer(mts, data)

    this.emit('data:candle', candle, {
      chanFilter: { key: `trade:${tf}:${symbol}` }
    })

    if (isFinal) {
      this._lastFinalCandleForChannel[chanKey] = candle
    }
  }

  onBookData (symbol, prec, len, data) {
    const book = bookTransformer(data)

    this.emit('data:book', book, {
      chanFilter: { symbol, prec, len }
    })

    this.emit('managed:book', book, {
      chanFilter: { symbol, prec, len }
    })
  }

  subscribe (connection, channel, filter) {
    const { c } = connection
    const key = chanDataToKey(channel, filter)

    switch (channel) {
      case 'ticker': {
        const { symbol } = filter
        this._subs[key] = c.ws.ticker(symbol, this.onTickerData.bind(this, symbol))
        break
      }

      case 'trades': {
        const { symbol } = filter
        this._subs[key] = c.ws.trades(symbol, this.onTradeData.bind(this, symbol))
        break
      }

      case 'candles': {
        const { key } = filter
        const keyTokens = key.split(':')
        const [, tf, symbol] = keyTokens
        this._subs[key] = c.ws.candles(symbol, tf, this.onCandleData.bind(this, key, symbol, tf))
        break
      }

      case 'book': {
        const { symbol, prec, len } = filter
        this._subs[key] = c.ws.partialDepth({
          symbol,
          level: len
        }, this.onBookData.bind(this, symbol, prec, len))
        break
      }

      default: {
        debug('recv subscribe for unknown channel type: %s', channel)
      }
    }
  }

  unsubscribe (connection, channel, filter) {
    const key = chanDataToKey(channel, filter)

    if (!this._subs[key]) {
      return debug('recv unsubscribe for unknown channel %s %j', channel, filter)
    }

    this._subs[key]()
    delete this._subs[key]
  }

  async submitOrderWithDelay (connection, delay, order) {
    const { c } = connection

    return new Promise((resolve, reject) => {
      setTimeout(() => {
        c
          .order(clientOrderTransformer(order))
          .then((o) => {
            const order = orderTransformer(o)

            this.emit('order:new', order)

            resolve(order)
          })
          .catch(reject)
      }, delay)
    })
  }

  async cancelOrderWithDelay (connection, delay, order) {
    const { c } = connection

    return new Promise((resolve, reject) => {
      setTimeout(() => {
        c
          .cancelOrder({
            symbol: order.symbol,
            orderId: order.id,
          })
          .then(() => {
            this.emit('order:close', order)
          })
          .catch(reject)
      }, delay)
    })
  }

  notify (client, level, message) {

  }
}
