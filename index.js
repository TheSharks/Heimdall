require('dotenv').config()

const Socket = require('./src/classes/DiscordWebsocket')

const test = new Socket(process.env.DISCORD_TOKEN)
test.connect()
