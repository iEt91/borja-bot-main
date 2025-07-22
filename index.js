require('dotenv').config();
const tmi = require('tmi.js');
const axios = require('axios');
const { Client, GatewayIntentBits } = require('discord.js');

// --- Configuración ---
const config = {
  twitch: {
    clientId: process.env.TWITCH_CLIENT_ID,
    clientSecret: process.env.TWITCH_CLIENT_SECRET,
    token: process.env.TWITCH_TOKEN,
    channel: process.env.TWITCH_CHANNEL,
  },
  youtube: {
    apiKey: process.env.YOUTUBE_API_KEY,
  },
};

const COOLDOWN_SECONDS = 30;
let lastClipTime = 0;
const RANK_COOLDOWN_SECONDS = 15;
let lastRankTime = 0;
const POT_COOLDOWN_SECONDS = 30;
let lastPotTime = 0;

let valorantPUUID = '566844b6-f15b-558a-8617-575b5f7b04a4';
const VALORANT_API_KEY = 'HDEV-98c32dd6-7401-498c-80ed-f6220a8a4e39';
const processedMessages = new Map();
const MESSAGE_CACHE_DURATION = 10000;

// --- Twitch Client ---
const client = new tmi.Client({
  options: { debug: false },
  connection: { secure: true, reconnect: true },
  identity: {
    username: process.env.BOT_USERNAME,
    password: process.env.TWITCH_OAUTH,
  },
  channels: [config.twitch.channel],
});

// --- Discord Client ---
const discordClient = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

// --- Funciones auxiliares ---
async function getBroadcasterId(channelName) {
  try {
    const res = await axios.get(`https://api.twitch.tv/helix/users?login=${channelName}`, {
      headers: {
        'Client-ID': config.twitch.clientId,
        'Authorization': `Bearer ${config.twitch.token}`,
      },
    });
    return res.data.data[0]?.id || null;
  } catch (err) {
    console.error('Error al obtener broadcaster_id:', err.message);
    return null;
  }
}

async function createClip(broadcasterId) {
  try {
    const res = await axios.post(
      `https://api.twitch.tv/helix/clips?broadcaster_id=${broadcasterId}`,
      {},
      {
        headers: {
          'Client-ID': config.twitch.clientId,
          'Authorization': `Bearer ${config.twitch.token}`,
          'Content-Type': 'application/json',
        },
      }
    );
    return `https://clips.twitch.tv/${res.data.data[0].id}`;
  } catch (err) {
    console.error('Error al crear clip:', err.message);
    return null;
  }
}

async function getValorantRank(puuid) {
  try {
    const res = await axios.get(`https://api.henrikdev.xyz/valorant/v2/by-puuid/mmr/eu/${puuid}`, {
      headers: { Authorization: VALORANT_API_KEY },
    });
    const data = res.data.data.current_data;
    return { rank: data.currenttierpatched || 'Desconocido', rr: data.ranking_in_tier || 0 };
  } catch (err) {
    console.error('Error al obtener rango:', err.message);
    return null;
  }
}

async function getYoutubeVideoTitle(videoId) {
  try {
    const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=${config.youtube.apiKey}`;
    const res = await axios.get(url);
    return res.data.items[0]?.snippet?.title || null;
  } catch (err) {
    console.error('Error al obtener título del video:', err.message);
    return null;
  }
}

// --- Eventos de Twitch ---
client.on('connected', (addr, port) => console.log(`Bot conectado a ${addr}:${port}`));
client.on('reconnect', () => console.log('Reconectando al chat...'));

client.on('message', async (channel, tags, message, self) => {
  if (self || !tags.id || processedMessages.has(tags.id)) return;
  processedMessages.set(tags.id, Date.now());
  const username = tags.username;
  const isMod = tags.mod || (tags.badges && tags.badges.moderator);
  const isBroadcaster = tags.badges && tags.badges.broadcaster;

  // --- !clip ---
  if (message.toLowerCase() === '!clip') {
    if (!isMod && !isBroadcaster && !['goaleex', 'suiiigfx', 'paula2415'].includes(username.toLowerCase())) {
      client.say(channel, 'No tienes permisos para crear clips.');
      return;
    }
    const now = Date.now();
    if ((now - lastClipTime) / 1000 < COOLDOWN_SECONDS) {
      client.say(channel, `Espera ${Math.ceil(COOLDOWN_SECONDS - (now - lastClipTime) / 1000)} segundos`);
      return;
    }
    const broadcasterId = await getBroadcasterId(config.twitch.channel);
    if (!broadcasterId) return client.say(channel, 'Error al obtener ID del canal');
    const clipUrl = await createClip(broadcasterId);
    client.say(channel, clipUrl ? `¡Clip creado! ${clipUrl}` : 'No pude crear el clip, ¿estás en vivo?');
    lastClipTime = now;
  }

  // --- !rank / !rango ---
  if (['!rank', '!rango'].includes(message.toLowerCase())) {
    const now = Date.now();
    if ((now - lastRankTime) / 1000 < RANK_COOLDOWN_SECONDS) {
      client.say(channel, `Espera ${Math.ceil(RANK_COOLDOWN_SECONDS - (now - lastRankTime) / 1000)} segundos`);
      return;
    }
    const rank = await getValorantRank(valorantPUUID);
    rank
      ? client.say(channel, `${username}, b0rja está en pointLeft ${rank.rank}, [${rank.rr} RR] pointRight`)
      : client.say(channel, 'No se pudo obtener el rango');
    lastRankTime = now;
  }

  // --- !setpuuid ---
  if (message.toLowerCase().startsWith('!setpuuid') && (isMod || isBroadcaster)) {
    const match = message.match(/!setpuuid\s+([0-9a-fA-F-]+)/);
    if (!match) return client.say(channel, 'Usa: !setpuuid <PUUID>');
    const newPUUID = match[1];
    if (!/^[0-9a-fA-F-]{36}$/.test(newPUUID)) return client.say(channel, 'PUUID inválido');
    valorantPUUID = newPUUID;
    client.say(channel, `PUUID actualizado a ${newPUUID}`);
  }

  // --- !pot ---
  if (message.toLowerCase() === '!pot' && (isMod || isBroadcaster)) {
    const now = Date.now();
    if ((now - lastPotTime) / 1000 < POT_COOLDOWN_SECONDS) {
      client.say(channel, `Espera ${Math.ceil(POT_COOLDOWN_SECONDS - (now - lastPotTime) / 1000)} segundos`);
      return;
    }
    for (let i = 0; i < 5; i++) {
      const start = i * 5 + 1;
      client.say(channel, `pot${start} pot${start + 1} pot${start + 2} pot${start + 3} pot${start + 4}`);
    }
    lastPotTime = now;
  }
});

// --- Limpiar cache de mensajes procesados ---
setInterval(() => {
  const now = Date.now();
  for (const [id, time] of processedMessages) {
    if (now - time > MESSAGE_CACHE_DURATION) processedMessages.delete(id);
  }
}, MESSAGE_CACHE_DURATION);

// --- Discord: Detectar nuevo video ---
discordClient.on('messageCreate', async message => {
  if (message.author.id !== '282286160494067712') return; // Solo Pingcord
  const urlMatch = message.content.match(/https:\/\/(?:www\.)?youtube\.com\/watch\?v=([\w-]{11})/);
  if (!urlMatch) return;
  const videoId = urlMatch[1];
  const title = await getYoutubeVideoTitle(videoId);
  if (title) {
    const videoUrl = `https://youtu.be/${videoId}`;
    client.say(`#${config.twitch.channel}`, `!editcom !video 🎬Nuevo Video: ${title} | ${videoUrl}`);
    console.log(`Nuevo video detectado: ${title}`);
  }
});

// --- Iniciar bots ---
client.connect().catch(err => console.error('Error al conectar a Twitch:', err));
discordClient.login(process.env.DISCORD_BOT_TOKEN).catch(err => console.error('Error al conectar a Discord:', err));

