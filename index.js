const syncTradesRange = require('./lib/models/trade/sync_range')
const syncCandlesRange = require('./lib/models/candle/sync_range')
const auditCandleGaps = require('./lib/models/candle/audit_gaps')
const AOAdapter = require('./lib/ao_adapter')

module.exports = {
  AOAdapter,

  schema: {
    Trade: {
      schemaExchangeData: {
        id: Number,
      },

      methods: {
        syncRange: syncTradesRange,
      },
    },

    Candle: {
      schemaExchangeData: {
        type: String,
      },

      methods: {
        syncRange: syncCandlesRange,
        auditGaps: auditCandleGaps,
      }
    }
  },
}
