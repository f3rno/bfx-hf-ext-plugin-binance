'use strict'

const Promise = require('bluebird')
const { EventEmitter } = require('events')
const PI = require('p-iteration')
const _flatten = require('lodash/flatten')
const _reverse = require('lodash/reverse')
const Binance = require('binance-api-node').default
const { Order } = require('bfx-api-node-models')
const debug = require('debug')('bfx:hf:ext-plugin-binance:ao-adapter')
const PromiseThrottle = require('promise-throttle')

const candleWidth = require('./candle_width')
const chanDataToKey = require('./chan_data_to_key')
const bookTransformer = require('./transformers/book')
const tickerTransformer = require('./transformers/ticker')
const tradeTransformer = require('./transformers/trade')
const candleTransformer = require('./transformers/candle')
const orderTransformer = require('./transformers/order')
const clientOrderTransformer = require('./transformers/client_order')

const orderThrottler = new PromiseThrottle({
  requestsPerSecond: 10,
  promiseImplementation: Promise
})

module.exports = class AOAdapter extends EventEmitter {
  constructor ({ apiKey, apiSecret }) {
    super()

    this._apiKey = apiKey
    this._apiSecret = apiSecret
    this._client = null
    this._subs = {} // [chanKey]: unsub
    this._lastFinalCandleForChannel = {}
    this._managedCandles = {}
  }

  connect () {
    if (!this._client) {
      this._client = Binance({
        apiKey: this._apiKey,
        apiSecret: this._apiSecret,
      })

      this._client.ws.user((msg) => {
        const { eventType } = msg

        if (eventType !== 'executionReport') {
          return
        }

        const cid = msg.clientOrderId
          ? msg.clientOrderId.split('-')
          : msg.originalClientOrderId === 'null'
            ? msg.newClientOrderId.split('-')
            : msg.originalClientOrderId.split('-')

        const order = new Order({
          amount: (+msg.quantity - +msg.totalTradeQuantity) * (msg.side === 'SELL' ? -1 : 1),
          price: +msg.price,
          symbol: msg.symbol,
          type: msg.orderType,
          cid: +cid[0],
          gid: +cid[1],
          id: msg.orderId,
          status: msg.orderStatus,
        })

        if (msg.orderStatus === 'FILLED' || msg.orderStatus === 'CANCELED') {
          this.emit('order:close', order)
        } else if (msg.orderStatus === 'PARTIALLY_FILLED') {
          this.emit('order:update', order)
        } else if (msg.orderStatus === 'NEW') {
          this.emit('order:new', order)
        } else if (msg.orderStatus === 'REJECTED') {
          this.emit('order:error', order)
        }
      })

      this.emit('open')
      this.emit('auth:success')
      this.requestOrderSnapshot()
    }

    return this._client
  }

  disconnect () {
    Object.values(this._subs).forEach(unsub => unsub())
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
    const trade = tradeTransformer(data)

    this.emit('data:trade', trade, {
      chanFilter: { symbol }
    })

    this.emit('data:trades', [trade], {
      chanFilter: { symbol }
    })
  }

  onCandleData (chanKey, symbol, tf, data) {
    const { isFinal } = data
    const last = this._lastFinalCandleForChannel[chanKey]

    if (!isFinal && !last) {
      return // we need at least 1 final candle to get mts
    }

    const mts = isFinal
      ? data.eventTime
      : last.eventTime + candleWidth(tf)

    const candle = candleTransformer(mts, data)
    const key = `trade:${tf}:${symbol}`

    if (!this._managedCandles[key]) {
      this._managedCandles[key] = [candle]
    } else {
      this._managedCandles[key] = [ candle, ...this._managedCandles[key] ]
    }

    this.emit('data:candle', candle, {
      chanFilter: { key }
    })

    this.emit('data:managed:candles', this._managedCandles[key], {
      chanFilter: { key }
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

    this.emit('data:managed:book', book, {
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

        c.candles({
          symbol,
          interval: tf,
        }).then((candleData) => {
          const candles = candleData.map(c => candleTransformer(+c.openTime, c))
          const key = `trade:${tf}:${symbol}`

          if (!this._managedCandles[key]) {
            this._managedCandles[key] = []
          }

          this._managedCandles[key] = [
            ..._reverse(candles),
            ...this._managedCandles[key],
          ]

          this.emit('data:candles', candles, {
            chanFilter: { key }
          })

          this.emit('data:managed:candles', this._managedCandles[key], {
            chanFilter: { key }
          })
        }).catch((err) => {
          debug('failed to fetch candles: %s', err.message)
        })

        break
      }

      case 'book': {
        const { symbol, prec, len } = filter
        this._subs[key] = c.ws.partialDepth({
          symbol,
          level: 20,
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
        orderThrottler.add(c.order.bind(c, {
          ...clientOrderTransformer(order),
          useServerTime: true,
        }))
        .then(() => {
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
            origClientOrderId: `${order.cid}-${order.gid}`,
            useServerTime: true,
          })
          .then(() => resolve())
          .catch(reject)
      }, delay)
    })
  }

  notify (client, level, message) {

  }

  getExchangeInfo () {
    return this._client.exchangeInfo()
  }
}
