require('dotenv').config();
const tmi = require('tmi.js');
const axios = require('axios');
const fs = require('fs');

// 🔒 Crear carpeta y archivo de estado si no existen
if (!fs.existsSync('storage')) fs.mkdirSync('storage');
if (!fs.existsSync('storage/lastVideo.json')) fs.writeFileSync('storage/lastVideo.json', '{}');

// Configuración del bot
const config = {
  twitch: {
    clientId: process.env.TWITCH_CLIENT_ID,
    clientSecret: process.env.TWITCH_CLIENT_SECRET,
    token: process.env.TWITCH_TOKEN,
    channel: process.env.TWITCH_CHANNEL,
  },
};

// Cooldowns
const COOLDOWN_SECONDS = 30;
let lastClipTime = 0;
const RANK_COOLDOWN_SECONDS = 15;
let lastRankTime = 0;
const POT_COOLDOWN_SECONDS = 30;
let lastPotTime = 0;

// PUUID y API Key
let valorantPUUID = '566844b6-f15b-558a-8617-575b5f7b04a4';
const VALORANT_API_KEY = 'HDEV-98c32dd6-7401-498c-80ed-f6220a8a4e39';

// Cache para deduplicación
const processedMessages = new Map();
const MESSAGE_CACHE_DURATION = 10000;

// Twitch Client
const client = new tmi.Client({
  options: { debug: true },
  connection: { secure: true, reconnect: true },
  identity: {
    username: process.env.BOT_USERNAME,
    password: process.env.TWITCH_OAUTH,
  },
  channels: [config.twitch.channel],
});

client.on('connected', (address, port) => console.log(`Bot conectado a ${address}:${port}`));
client.on('reconnect', () => console.log('Reconectando al chat...'));
client.connect().catch(console.error);

// Limpiar cache de mensajes
setInterval(() => {
  const now = Date.now();
  for (const [messageId, timestamp] of processedMessages) {
    if (now - timestamp > MESSAGE_CACHE_DURATION) processedMessages.delete(messageId);
  }
}, MESSAGE_CACHE_DURATION);

// Comandos
client.on('message', async (channel, tags, message, self) => {
  if (self) return;
  const messageId = tags.id;
  if (!messageId || processedMessages.has(messageId)) return;
  processedMessages.set(messageId, Date.now());
  const username = tags.username;
  const isMod = tags.mod || (tags.badges && tags.badges.moderator);
  const isBroadcaster = tags.badges && tags.badges.broadcaster;

  // !clip
  if (message.toLowerCase() === '!clip') {
    const isAutorizado = ['goaleex', 'suiiigfx'].includes(username.toLowerCase()) || isMod || isBroadcaster;
    if (!isAutorizado) {
      client.say(channel, 'Solo moderadores, goaleex o suiiigfx pueden usar este comando');
      return;
    }
    const now = Date.now();
    if ((now - lastClipTime) / 1000 < COOLDOWN_SECONDS) {
      client.say(channel, `Espera ${Math.ceil(COOLDOWN_SECONDS - (now - lastClipTime) / 1000)} segundos`);
      return;
    }
    const broadcasterId = await getBroadcasterId(config.twitch.channel);
    if (!broadcasterId) {
      client.say(channel, 'Error al obtener ID del canal');
      return;
    }
    const clipUrl = await createClip(broadcasterId);
    client.say(channel, clipUrl ? `¡Clip creado! ${clipUrl}` : 'No pude crear el clip, ¿estás en vivo?');
    lastClipTime = now;
    return;
  }

  // !rank / !rango
  if (['!rank', '!rango'].includes(message.toLowerCase())) {
    const now = Date.now();
    if ((now - lastRankTime) / 1000 < RANK_COOLDOWN_SECONDS) {
      client.say(channel, `Espera ${Math.ceil(RANK_COOLDOWN_SECONDS - (now - lastRankTime) / 1000)} segundos`);
      return;
    }
    const rankData = await getValorantRank(valorantPUUID);
    if (rankData) {
      client.say(channel, `${username}, b0rja está en pointLeft ${rankData.rank}, [${rankData.rr} RR] pointRight`);
      lastRankTime = now;
    } else {
      client.say(channel, 'No se pudo obtener el rango');
    }
    return;
  }

  // !setpuuid
  if (message.toLowerCase().startsWith('!setpuuid') && (isMod || isBroadcaster)) {
    const match = message.match(/!setpuuid\s+([0-9a-fA-F-]+)/);
    if (!match) return client.say(channel, 'Usa: !setpuuid <PUUID>');
    const newPUUID = match[1];
    if (!/^[0-9a-fA-F-]{36}$/.test(newPUUID)) return client.say(channel, 'PUUID inválido');
    valorantPUUID = newPUUID;
    client.say(channel, `PUUID actualizado a ${newPUUID}`);
    return;
  }

  // !pot
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
    return;
  }
});

// Funciones auxiliares
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
    return {
      rank: data.currenttierpatched || 'Desconocido',
      rr: data.ranking_in_tier || 0,
    };
  } catch (err) {
    console.error('Error al obtener rango:', err.message);
    return null;
  }
}

// 🔔 MONITOREO YOUTUBE — cada 15 minutos
async function fetchLatestVideo() {
  const key = process.env.YOUTUBE_API_KEY;
  const channelId = process.env.YOUTUBE_CHANNEL_ID;

  const channelResp = await axios.get('https://www.googleapis.com/youtube/v3/channels', {
    params: { part: 'contentDetails', id: channelId, key },
  });

  const uploadsId = channelResp.data.items[0].contentDetails.relatedPlaylists.uploads;

  const videosResp = await axios.get('https://www.googleapis.com/youtube/v3/playlistItems', {
    params: { part: 'snippet', playlistId: uploadsId, maxResults: 1, key },
  });

  const item = videosResp.data.items[0];
  return {
    id: item.snippet.resourceId.videoId,
    title: item.snippet.title,
    url: `https://www.youtube.com/watch?v=${item.snippet.resourceId.videoId}`,
    publishedAt: item.snippet.publishedAt,
  };
}

async function checkForNewVideo() {
  try {
    const latestVideo = await fetchLatestVideo();
    const path = 'storage/lastVideo.json';

    let lastVideo = {};
    if (fs.existsSync(path)) {
      lastVideo = JSON.parse(fs.readFileSync(path));
    }

    if (lastVideo.id !== latestVideo.id) {
      fs.writeFileSync(path, JSON.stringify(latestVideo, null, 2));
      const msg = `!editcom !youtube Nuevo video: ${latestVideo.url}`;
      console.log(`[✓] Nuevo video detectado: ${latestVideo.title}`);
      client.say(`#${config.twitch.channel}`, msg);
    } else {
      console.log('[·] Sin nuevos videos.');
    }
  } catch (err) {
    console.error('[✗] Error verificando YouTube:', err.message);
  }
}

// Ejecutar al iniciar y cada 15 minutos
checkForNewVideo();
setInterval(checkForNewVideo, 15 * 60 * 1000);

console.log(`Bot iniciado para ${config.twitch.channel} con ${process.env.BOT_USERNAME}`);
