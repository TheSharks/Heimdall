const amqp = require('amqplib')

module.exports = class AMPQChannel {
  constructor (connection, channel, queue) {
    this._conn = connection
    this._chann = channel
    this._queue = queue
    process.on('exit', () => this._conn.close())
  }

  static async build (uri, queue) {
    const connection = await amqp.connect(uri)
    const channel = await connection.createChannel()
    channel.assertQueue(queue, {
      durable: true
    })
    return new this(connection, channel, queue)
  }

  send (data) {
    data = JSON.stringify(data)
    this._chann.sendToQueue(this._queue, Buffer.from(data), {
      persistent: true
    })
  }
}
