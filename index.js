(async () => {
  require('dotenv').config()
  const SocketManager = require('./src/classes/SocketManager')
  const AMPQChannel = require('./src/classes/AMQPManager')

  const manager = await SocketManager.build(process.env.DISCORD_TOKEN)
  const channel = await AMPQChannel.build(process.env.AMQP_URI, process.env.AMQP_QUEUE || 'wildbeast')

  manager.on('all-data', x => channel.send(x))
})()
