import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { Pool } from 'pg';
import { createClient } from 'redis';

const app = express();

app.use(cors({ origin: process.env.CLIENT_URL ?? '*' }));
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgresql://typerace:typerace@localhost:5432/typerace',
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS race_results (
      id SERIAL PRIMARY KEY,
      player_name TEXT NOT NULL,
      wpm INTEGER NOT NULL,
      accuracy INTEGER NOT NULL,
      room_id TEXT NOT NULL,
      placement INTEGER NOT NULL,
      finished_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  console.log('DB ready');
}

// roomId -> (socketId -> playerName)
const rooms = new Map<string, Map<string, string>>();

const redis = createClient({ url: process.env.REDIS_URL ?? 'redis://localhost:6379' });
redis.connect().then(() => console.log('Redis connected')).catch(console.error);

async function restoreRoomsFromRedis() {
  const keys = await redis.keys('room:*');
  for (const key of keys) {
    const roomId = key.replace('room:', '');
    const players = await redis.hGetAll(key);
    if (Object.keys(players).length > 0) {
      rooms.set(roomId, new Map(Object.entries(players)));
      console.log(`Restored room ${roomId} with ${Object.keys(players).length} players`);
    }
  }
}

initDb()
  .then(() => restoreRoomsFromRedis())
  .catch(console.error);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/leaderboard', async (_req, res) => {
  const top10 = await redis.zRangeWithScores('leaderboard:best', 0, 9, { REV: true });
  res.json(top10.map((e, i) => ({ player_name: e.value, best_wpm: e.score, rank: i + 1 })));
});

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL ?? '*',
  },
});

const passages = [
  "The human brain is an extraordinary organ, capable of processing vast amounts of information every second. It stores memories, generates emotions, and allows us to experience the world in rich and complex ways. Scientists have spent centuries trying to understand how it works, yet many mysteries remain. From the firing of individual neurons to the emergence of consciousness itself, the brain continues to inspire wonder and curiosity in all who study it. Every thought you have, every word you read, every feeling you experience is the result of billions of tiny electrical signals traveling through an intricate web of connections that took a lifetime to form.",

  "Space exploration has captured the imagination of humanity for generations. When the first astronauts landed on the moon, it represented not just a scientific achievement but a triumph of human ambition and cooperation. Today, scientists are looking further than ever before, planning missions to Mars and beyond. Private companies have joined governments in the race to explore the cosmos, bringing new energy and innovation to the field. The universe is vast beyond comprehension, filled with galaxies, stars, and planets waiting to be discovered. What we find out there may forever change how we understand our place in the cosmos and what it means to be alive.",

  "The history of music is as old as humanity itself. From the earliest drumbeats echoing through ancient caves to the complex symphonies of the classical era and the electric energy of modern rock and pop, music has always been a fundamental part of human culture. It brings people together, expresses what words cannot, and has the power to evoke deep emotions with just a few notes. Every culture on earth has developed its own musical traditions, instruments, and styles, yet music remains a universal language that transcends borders and speaks directly to the human heart in ways that nothing else can.",

  "Cooking is one of the oldest and most deeply human activities. Long before restaurants and recipe books, people gathered around fires to share food and stories. The transformation of raw ingredients into a nourishing meal is both a science and an art. Great chefs understand the chemistry of heat and flavor, the importance of texture and color, and the way that a single dish can carry the memory of an entire culture. From the humblest bowl of rice to the most elaborate tasting menu, food connects us to our past, brings us together in the present, and nourishes us for whatever comes next.",

  "The ocean covers more than seventy percent of the Earth's surface, yet much of it remains unexplored. Its depths hide entire ecosystems that science is only beginning to understand. Strange creatures drift through the darkness of the deep sea, surviving in conditions that would be lethal to most life on the surface. Ocean currents regulate the climate of the entire planet, and the sea provides food and livelihoods for billions of people. Yet human activity is changing the ocean in dramatic ways. Warming temperatures, rising acidity, and plastic pollution threaten marine life on a massive scale, making ocean conservation one of the most urgent challenges of our time.",

  "Reading is one of the most powerful habits a person can develop. Books open doors to worlds that would otherwise be inaccessible, letting readers experience lives and perspectives far removed from their own. A well-written novel can build empathy, expand vocabulary, and develop critical thinking skills in ways that few other activities can match. Throughout history, books have been the primary vehicle for the transmission of knowledge and culture across generations. In a world increasingly dominated by short-form content and rapid distraction, the ability to sit with a long text and follow complex ideas remains an invaluable skill worth cultivating.",

  "Mountains have always inspired a sense of awe and reverence in those who behold them. Their sheer scale dwarfs human ambition, yet people have always been drawn to climb them, whether out of curiosity, spiritual longing, or the simple desire to see what lies beyond the next ridge. The world's great mountain ranges are also critical ecosystems, supplying freshwater to billions through rivers and glaciers. They are home to unique plants and animals found nowhere else on earth. As climate change causes glaciers to retreat at alarming rates, the mountains are sending us a warning that we can no longer afford to ignore.",

  "The invention of the internet transformed human civilization in ways that are still difficult to fully comprehend. Within a few decades, it connected billions of people across the globe, democratized access to information, and created entirely new forms of commerce, communication, and culture. It gave ordinary people the ability to publish their ideas, start businesses, and reach audiences that would have been unimaginable just a generation earlier. But it also brought new challenges, from the spread of misinformation to questions of privacy and the concentration of power in the hands of a small number of technology companies whose decisions affect the lives of nearly everyone on the planet.",

  "Architecture is the art of shaping the spaces in which we live, work, and gather. A great building does more than provide shelter. It tells a story, expresses values, and shapes the way its occupants experience time and light and movement. From the ancient temples of Greece to the soaring skyscrapers of modern cities, every era has developed its own architectural language to express what it believes about beauty, power, and the human condition. Good architecture improves the quality of life for everyone who encounters it, while poor design can make people feel isolated, confused, or diminished. The spaces we build reflect and shape who we are.",

  "Language is the foundation of human society. Without the ability to communicate complex ideas, cooperate on shared goals, and pass knowledge from one generation to the next, civilization as we know it would be impossible. Linguists estimate that there are around seven thousand languages spoken in the world today, each one a unique window into a particular way of understanding reality. When a language dies, it takes with it an irreplaceable body of knowledge, poetry, and wisdom. At the same time, language is always changing, growing richer and more expressive as people find new ways to describe their experiences and connect with one another across cultures and centuries.",
];

function getRandomPassage(): string {
  return passages[Math.floor(Math.random() * passages.length)];
}

type FinishEntry = { socketId: string; name: string; wpm: number; accuracy: number; placement: number };
// roomId -> ordered list of finishers
const roomFinishOrder = new Map<string, FinishEntry[]>();
// roomId -> active race state (set when race starts, cleared when race ends)
const roomRaceState = new Map<string, { text: string; duration: number; startedAt: number }>();

function broadcastPlayerList(roomId: string) {
  const playerMap = rooms.get(roomId);
  if (!playerMap) return;
  const players = Array.from(playerMap.entries()).map(([id, name]) => ({ id, name }));
  io.to(roomId).emit('room_players', players);
}

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Join room
  socket.on('join_room', async ({ roomId, playerName }: { roomId: string; playerName: string }) => {
    const nameTaken = Array.from(rooms.get(roomId)?.values() ?? []).includes(playerName);
    if (nameTaken) {
      socket.emit('join_error', { message: 'Name already taken in this room' });
      return;
    }
    socket.join(roomId);
    if (!rooms.has(roomId)) rooms.set(roomId, new Map());
    rooms.get(roomId)!.set(socket.id, playerName || 'Anonymous');
    await redis.hSet(`room:${roomId}`, socket.id, playerName || 'Anonymous');
    console.log(`User ${socket.id} (${playerName}) joined room ${roomId}`);
    broadcastPlayerList(roomId);

    const raceState = roomRaceState.get(roomId);
    if (raceState) {
      const elapsed = Math.floor((Date.now() - raceState.startedAt) / 1000);
      const timeLeft = Math.max(raceState.duration - elapsed, 0);
      socket.emit('race_config', { text: raceState.text, duration: raceState.duration, timeLeft });
      socket.emit('race_start');
    }
  });

  // Send message to room
  socket.on('progress_update', (data) => {
    console.log('Received progress from client:', data);
    const { roomId, cursor, wpm, accuracy } = data;

    socket.to(roomId).emit('progress_update', {
      userId: socket.id,
      cursor,
      wpm,
      accuracy,
    });
  });

  socket.on('player_reset', ({ roomId }) => {
    socket.to(roomId).emit('player_reset', {
      userId: socket.id,
      cursor: 0,
      wpm: 0,
      accuracy: 100,
    });
  });

  socket.on('start_race', ({ roomId, duration }: { roomId: string; duration: number }) => {
    roomFinishOrder.set(roomId, []);
    const text = getRandomPassage();
    roomRaceState.set(roomId, { text, duration, startedAt: 0 });
    io.to(roomId).emit('race_config', { duration, text });
    let count = 3;
    io.to(roomId).emit('countdown_tick', count);
    const interval = setInterval(() => {
      count--;
      if (count > 0) {
        io.to(roomId).emit('countdown_tick', count);
      } else {
        clearInterval(interval);
        roomRaceState.set(roomId, { text, duration, startedAt: Date.now() });
        io.to(roomId).emit('race_start');
      }
    }, 1000);
  });

  socket.on('play_again', ({ roomId }: { roomId: string }) => {
    roomRaceState.delete(roomId);
    socket.to(roomId).emit('play_again');
  });

  socket.on('race_finish', async ({ roomId, wpm, accuracy }: { roomId: string; wpm: number; accuracy: number }) => {
    if (!roomFinishOrder.has(roomId)) roomFinishOrder.set(roomId, []);
    const finishList = roomFinishOrder.get(roomId)!;

    // Ignore duplicate finish from same socket
    if (finishList.some((e) => e.socketId === socket.id)) return;

    const name = rooms.get(roomId)?.get(socket.id) || 'Anonymous';
    const entry: FinishEntry = { socketId: socket.id, name, wpm, accuracy, placement: 0 };
    finishList.push(entry);

    io.to(roomId).emit('player_finished', { name, wpm, accuracy });

    await redis.zAdd('leaderboard:best', [{ score: wpm, value: name }], { GT: true });
    const top10 = await redis.zRangeWithScores('leaderboard:best', 0, 9, { REV: true });
    io.to(roomId).emit('leaderboard_update', top10.map((e, i) => ({ player_name: e.value, best_wpm: e.score, rank: i + 1 })));

    const totalPlayers = rooms.get(roomId)?.size ?? 0;
    if (finishList.length >= totalPlayers) {
      const sorted = [...finishList].sort((a, b) => b.wpm - a.wpm);
      const results = sorted.map(({ socketId, ...rest }, i) => ({ ...rest, placement: i + 1 }));
      io.to(roomId).emit('race_results', results);
      results.forEach(({ name, wpm, accuracy, placement }) => {
        pool.query(
          'INSERT INTO race_results (player_name, wpm, accuracy, room_id, placement) VALUES ($1, $2, $3, $4, $5)',
          [name, wpm, accuracy, roomId, placement]
        ).catch(console.error);
      });
      roomFinishOrder.delete(roomId);
      roomRaceState.delete(roomId);
    }
  });

  socket.on('disconnecting', async () => {
    for (const roomId of socket.rooms) {
      if (roomId === socket.id) continue;
      if (rooms.has(roomId)) {
        rooms.get(roomId)!.delete(socket.id);
        await redis.hDel(`room:${roomId}`, socket.id);
        if (rooms.get(roomId)!.size === 0) {
          rooms.delete(roomId);
          roomFinishOrder.delete(roomId);
          await redis.del(`room:${roomId}`);
        } else {
          broadcastPlayerList(roomId);
        }
      }
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

const PORT = process.env.PORT ?? 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});