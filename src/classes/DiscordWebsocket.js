const WebSocket = require('ws')
const { EventEmitter } = require('events')
const { OPCodes, SocketTimeout } = require('../constants')
const Erlpack = require('erlpack')
// const ZlibSync = require('zlib-sync')

class DiscordWebsocket extends EventEmitter {
  constructor (token, url, shardTuple) {
    super()
    this._gateway = url || 'wss://gateway.discord.gg'
    this._token = token
    this._socket = null
    this._shardConfig = shardTuple
    this.id = shardTuple[0]
    this.state = 'idle'
    this._cache = {
      session_id: null,
      seq: null,
      get token () { return this._token }
    }
  }

  send (op, d) {
    if (this._socket.readyState !== WebSocket.OPEN) return
    console.log(this._shardConfig, 'S:', JSON.stringify({ op: op, d: d }))
    return this._socket.send(Erlpack.pack({ op: op, d: d }))
  }

  identify () {
    this.state = 'identifying'
    this._connectTimeout = setTimeout(() => {
      super.emit('warn', 'Identify timeout')
      this.reset()
    }, SocketTimeout)
    if (this._cache.session_id) {
      // attempt to resume
      this.send(OPCodes.RESUME, this._cache)
    } else {
      const { version } = require('../../package')
      const libID = `Heimdall/${version}`
      const payload = {
        token: this._token,
        properties: {
          $os: process.platform,
          $browser: libID,
          $device: libID
        },
        guild_subscriptions: false,
        compress: true,
        shard: this._shardConfig
      }
      this.send(OPCodes.IDENTIFY, payload)
    }
  }

  onMessage (msg) {
    let packet
    try {
      // if (msg.data.length >= 4 && msg.data.readUInt32BE(msg.data.length - 4) === 0xFFFF) this._zlibSync.push(msg.data, ZlibSync.Z_SYNC_FLUSH)
      // if (this._zlibSync.err) {
      //   super.emit('error', new Error(`ZLib error: ${this._zlibSync.err}: ${this._zlibSync.msg}`))
      //   return
      // }
      // packet = Buffer.from(this._zlibSync.result)
      packet = Erlpack.unpack(msg.data)
    } catch (e) {
      super.emit('error', e)
      return
    }
    console.log(this._shardConfig, 'R:', JSON.stringify(packet))
    if (packet.s > this._cache.seq) this._cache.seq = packet.s
    return this.onWSMessage(packet)
  }

  onWSMessage (data) {
    switch (data.op) {
      case OPCodes.EVENT: {
        if (data.t === 'READY' || data.t === 'RESUMED') {
          clearTimeout(this._connectTimeout)
          this.ready = true
          this.state = 'ready'
        }
        super.emit('data', data)
        break
      }
      case OPCodes.HELLO: {
        clearTimeout(this._connectTimeout)
        this._gatewayTrace = data.d._trace
        this.identify()
        this._heartbeat = setInterval(() => {
          if (this._lastHeartbeatAcknowledged === false) {
            super.emit('warn', 'Last heartbeat was not acknowledged, reidentifying')
            this.close()
          }
          this._lastHeartbeatSent = Date.now()
          this._lastHeartbeatAcknowledged = false
          this.send(OPCodes.HEARTBEAT, this._cache.seq)
        }, data.d.heartbeat_interval)
        break
      }
      case OPCodes.RECONNECT: {
        this.reset()
        break
      }
      case OPCodes.INVALID_SESSION: {
        if (data.d === true) {
          this.identify()
        } else {
          if (this._connectTimeout) clearTimeout(this._connectTimeout)
          this.softReset()
          setTimeout(() => this.identify(), 2500)
        }
        break
      }
      case OPCodes.HEARTBEAT_ACK: {
        this._lastHeartbeatReceived = Date.now()
        this._lastHeartbeatAcknowledged = true
        break
      }
    }
  }

  onClose (ctx) {
    this.state = 'disconnected'
    super.emit('close', ctx)
    switch (ctx.code) {
      case 4001:
      case 4002:
      case 4003:
      case 4005:
      case 4006:
      case 4007:
      case 4008:
      case 1006:
        this.reset()
        this.connect()
        break
      case 4010:
      case 4011:
        this.state = 'reconnection-impossible'
        super.emit('error', new Error(`Close code ${ctx.code} is preventing a reconnect`))
        break
      default:
        if (!ctx.wasClean) super.emit('debug', 'Closed with a unknown close code:', ctx.code)
        this.reset()
        this.connect()
        break
    }
  }

  get latency () {
    if (this._lastHeartbeatReceived && this._lastHeartbeatSent) return this._lastHeartbeatReceived - this._lastHeartbeatSent
    else return 0
  }

  close () {
    this.state = 'disconnected'
    if (this._socket) this._socket.close()
    if (this._heartbeat) clearInterval(this._heartbeat)
  }

  reset () {
    this.state = 'disconnected'
    if (this._socket && this._socket.readyState === WebSocket.OPEN) this._socket.close()
    if (this._heartbeat) clearInterval(this._heartbeat)
    if (this._connectTimeout) clearTimeout(this._connectTimeout)
    delete this._connectTimeout
    delete this._heartbeat
    delete this._socket
    this._cache = {
      session_id: null,
      seq: null,
      get token () { return this._token }
    }
  }

  softReset () {
    this.state = 'reset'
    this._cache = {
      session_id: null,
      seq: null,
      get token () { return this._token }
    }
  }

  connect () {
    this.state = 'connecting'
    this.ready = false
    const ws = this._socket = new WebSocket(`${this._gateway}/?v=6&encoding=etf`)
    ws.onmessage = this.onMessage.bind(this)
    ws.onclose = this.onClose.bind(this)
    this._connectTimeout = setTimeout(() => {
      super.emit('warn', 'Connection timeout')
      this.reset()
    }, SocketTimeout)
    // this._zlibSync = new ZlibSync.Inflate({
    //   chunkSize: 128 * 1024
    // })
  }
}

module.exports = DiscordWebsocket
