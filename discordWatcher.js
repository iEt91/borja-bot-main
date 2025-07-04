require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const tmi = require('tmi.js');

// Twitch config
const twitchClient = new tmi.Client({
  options: { debug: false },
  connection: { secure: true, reconnect: true },
  identity: {
    username: process.env.BOT_USERNAME,
    password: process.env.TWITCH_OAUTH,
  },
  channels: [process.env.TWITCH_CHANNEL],
});

twitchClient.connect();

// Discord bot
const discordClient = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

discordClient.once('ready', () => {
  console.log(`🟢 Bot de Discord conectado como ${discordClient.user.tag}`);
});

discordClient.on('messageCreate', async (message) => {
  if (
    message.channel.id !== process.env.DISCORD_CHANNEL_ID ||
    message.author.bot
  )
    return;

  const ytMatch = message.content.match(/https?:\/\/(www\.)?(youtube\.com|youtu\.be)\/\S+/);
  if (ytMatch) {
    const title = message.content.split('\n')[0].trim();
    const command = `!editcom !video 🎬Nuevo Video: ${title}`;
    twitchClient.say(`#${process.env.TWITCH_CHANNEL}`, command);
    console.log(`📤 Comando enviado a Twitch: ${command}`);
  }
});

discordClient.login(process.env.DISCORD_TOKEN);
