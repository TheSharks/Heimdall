const WebSocket = require('ws')
const { EventEmitter } = require('events')
const { OPCodes, SocketTimeout } = require('../constants')
const Erlpack = require('erlpack')
const ZlibSync = require('zlib-sync')

class DiscordWebsocket extends EventEmitter {
  constructor (token, url, shardTuple) {
    super()
    this._gateway = url || 'wss://gateway.discord.gg'
    this._token = token
    this._socket = null
    this._cache = {
      session_id: null,
      seq: null,
      get token () { return this._token }
    }
  }

  send (op, d) {
    if (this._socket.readyState !== WebSocket.OPEN) return
    console.log('S:', JSON.stringify({ op: op, d: d }))
    return this._socket.send(Erlpack.pack({ op: op, d: d }))
  }

  identify () {
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
        compress: true
      }
      this.send(OPCodes.IDENTIFY, payload)
    }
  }

  onMessage (msg) {
    let packet
    try {
      if (msg.data.length >= 4 && msg.data.readUInt32BE(msg.data.length - 4) === 0xFFFF) this._zlibSync.push(msg.data, ZlibSync.Z_SYNC_FLUSH)
      if (this._zlibSync.err) {
        super.emit('error', new Error(`ZLib error: ${this._zlibSync.err}: ${this._zlibSync.msg}`))
        return
      }
      packet = Buffer.from(this._zlibSync.result)
      packet = Erlpack.unpack(packet)
    } catch (e) {
      console.error(e)
      return
    }
    console.log('R:', JSON.stringify(packet))
    if (packet.s > this._cache.seq) this._cache.seq = packet.s
    return this.onWSMessage(packet)
  }

  onWSMessage (data) {
    switch (data.op) {
      case OPCodes.EVENT: {
        if (data.t === 'READY' || data.t === 'RESUMED') {
          clearTimeout(this._connectTimeout)
          this.ready = true
        }
        super.emit('data', data)
        break
      }
      case OPCodes.HELLO: {
        this._gatewayTrace = data.d._trace
        this.identify()
        this._heartbeat = setInterval(() => {
          if (this._lastHeartbeatAcknowledged === false) super.emit('warn', 'Last heartbeat was not acknowledged, the socket might be dead')
          this._lastHeartbeatSent = Date.now()
          this._lastHeartbeatAcknowledged = false
          this.send(OPCodes.HEARTBEAT, this._cache.seq)
        }, data.d.heartbeat_interval)
        break
      }
      case OPCodes.RECONNECT: {
        this.reset()
        this.connect()
        break
      }
      case OPCodes.INVALID_SESSION: {
        if (data.d === true) {
          this.identify()
        } else {
          this.softReset()
          setTimeout(() => this.identify(), SocketTimeout)
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

  onClose () {

  }

  get latency () {
    if (this._lastHeartbeatReceived && this._lastHeartbeatSent) return this._lastHeartbeatReceived - this._lastHeartbeatSent
    else return 0
  }

  reset () {
    if (this._socket) this._socket.close()
    if (this._heartbeat) clearInterval(this._heartbeat)
    this._socket = null
    this._cache = {
      session_id: null,
      seq: null,
      get token () { return this._token }
    }
  }

  softReset () {
    this._cache = {
      session_id: null,
      seq: null,
      get token () { return this._token }
    }
  }

  connect () {
    this.ready = false
    const ws = this._socket = new WebSocket(`${this._gateway}/?v=6&encoding=etf&compress=zlib-stream`)
    ws.onmessage = this.onMessage.bind(this)
    ws.onclose = this.onClose.bind(this)
    this._connectTimeout = setTimeout(() => {
      this._socket.close()
      this.connect()
    }, SocketTimeout)
    this._zlibSync = new ZlibSync.Inflate({
      chunkSize: 128 * 1024
    })
  }
}

module.exports = DiscordWebsocket
