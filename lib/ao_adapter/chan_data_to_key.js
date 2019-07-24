'use strict'

module.exports = (channel, filter) => {
  const compiledChannelData =  { ...filter }

  compiledChannelData.type = channel

  const keys = Object.keys(compiledChannelData)
  return keys.map(k => `${k}-${compiledChannelData[k]}`).join('|')
}
