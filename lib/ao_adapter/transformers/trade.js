'use strict'

module.exports = (u = {}) => ({
  price: +u.price,
  amount: +u.quantity,
  mts: u.eventTime,
})
