(async () => {
  require('dotenv').config()
  const Socket = require('./src/classes/SocketManager')

  const manager = await Socket.build(process.env.DISCORD_TOKEN)

  setInterval(() => {
    console.log(manager.status)
  }, 2000)
})()
