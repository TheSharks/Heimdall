const DiscordWebsocket = require('./DiscordWebsocket')
const { EventEmitter } = require('events')
const SA = require('superagent')

module.exports = class SocketManager extends EventEmitter {
  constructor (token, gatewayUrl, shardsMax, backoffData) {
    super()
    this._store = new Map()
    for (let x = 0; x < shardsMax; x++) {
      const socket = new DiscordWebsocket(token, gatewayUrl, [x, shardsMax])
      socket.on('data', d => {
        super.emit(`shard${x}-data`, d)
        super.emit('all-data', d)
      })
      socket.on('debug', console.log)
      socket.on('warn', console.log)
      socket.on('error', console.error)
      this._store.set(x, socket)
      if ((backoffData.remaining - 1) < 1) {
        socket.state = 'identify-stalled'
        setTimeout(() => socket.connect(), backoffData.reset_after)
      } else {
        backoffData.remaining--
        socket.connect()
      }
    }
  }

  static async build (token) {
    const data = await SA.get('https://discordapp.com/api/gateway/bot')
      .set('Authorization', `Bot ${token}`)
    return new this(token, data.body.url, data.body.shards, data.body.session_start_limit)
  }

  getShard (id) {
    if (!this._store.has(id)) return undefined
    else return this._store.get(id)
  }

  get status () {
    const v = {}
    this._store.forEach(x => {
      v[x.id] = x.state
    })
    return v
  }
}
