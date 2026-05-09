const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const axios = require('axios');
const ACTIONS = require('./Actions');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const app = express();
const server = http.createServer(app);

const allowedOrigins = (process.env.CLIENT_ORIGIN || 'http://localhost:3000,http://127.0.0.1:3000,https://codesync-hmt6.onrender.com')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);


const languageConfig = {
  python3: { versionIndex: '3' },
  java: { versionIndex: '3' },
  cpp: { versionIndex: '4' },
  nodejs: { versionIndex: '3' },
  c: { versionIndex: '4' },
  ruby: { versionIndex: '3' },
  go: { versionIndex: '3' },
  scala: { versionIndex: '3' },
  bash: { versionIndex: '3' },
  sql: { versionIndex: '3' },
  pascal: { versionIndex: '2' },
  csharp: { versionIndex: '3' },
  php: { versionIndex: '3' },
  swift: { versionIndex: '3' },
  rust: { versionIndex: '3' },
  r: { versionIndex: '3' },
};

app.use(cors({ origin: allowedOrigins }));
app.use(express.json());
const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
  },
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000,
    skipMiddlewares: true,
  }
});

const userSocketMap = {};
const roomSocketMap = {};

const getAllConnectedClients = (roomId) => {
  return Array.from(io.sockets.adapter.rooms.get(roomId) || []).map(
    (socketId) => ({
      socketId,
      username: userSocketMap[socketId],
    })
  );
};

io.on('connection', (socket) => {
  console.log('New connection:', socket.id);

  socket.on(ACTIONS.JOIN, ({ roomId, username }) => {
    if (!roomId || !username) {
      socket.disconnect();
      return;
    }

    userSocketMap[socket.id] = username;
    roomSocketMap[socket.id] = roomId;
    socket.join(roomId);

    const clients = getAllConnectedClients(roomId);
    clients.forEach(({ socketId }) => {
      io.to(socketId).emit(ACTIONS.JOINED, {
        clients,
        username,
        socketId: socket.id,
      });
    });
  });

  socket.on(ACTIONS.CODE_CHANGE, ({ roomId, code }) => {
    socket.in(roomId).emit(ACTIONS.CODE_CHANGE, { code });
  });

  socket.on(ACTIONS.SYNC_CODE, ({ code, socketId }) => {
    io.to(socketId).emit(ACTIONS.CODE_CHANGE, { code });
  });

  socket.on(ACTIONS.LANGUAGE_CHANGE, ({ roomId, language }) => {
    socket.in(roomId).emit(ACTIONS.LANGUAGE_CHANGE, { language });
  });

  socket.on(ACTIONS.LEAVE, () => {
    const roomId = roomSocketMap[socket.id];
    const username = userSocketMap[socket.id];
    
    if (roomId && username) {
      socket.leave(roomId);
      const remainingClients = getAllConnectedClients(roomId);
      
      io.to(roomId).emit(ACTIONS.DISCONNECTED, {
        socketId: socket.id,
        username,
        remainingClients
      });
      
      delete userSocketMap[socket.id];
      delete roomSocketMap[socket.id];
      socket.emit(ACTIONS.LEFT);
    }
  });

  socket.on('disconnect', () => {
    const roomId = roomSocketMap[socket.id];
    const username = userSocketMap[socket.id];
    
    if (roomId && username) {
      socket.leave(roomId);
      const remainingClients = getAllConnectedClients(roomId);
      
      io.to(roomId).emit(ACTIONS.DISCONNECTED, {
        socketId: socket.id,
        username,
        remainingClients
      });
      
      delete userSocketMap[socket.id];
      delete roomSocketMap[socket.id];
    }
  });
});

app.post('/compile', async (req, res) => {
  const { code, language, roomId } = req.body;

  if (!code || !language) {
    return res.status(400).json({ error: 'Code and language are required' });
  }

  if (!languageConfig[language]) {
    return res.status(400).json({ error: 'Unsupported language' });
  }

  if (!process.env.JDOODLE_CLIENT_ID || !process.env.JDOODLE_CLIENT_SECRET) {
    return res.status(500).json({ error: 'Compilation service not configured' });
  }

  try {
    const response = await axios.post('https://api.jdoodle.com/v1/execute', {
      script: code,
      language: language,
      versionIndex: languageConfig[language].versionIndex,
      clientId: process.env.JDOODLE_CLIENT_ID,
      clientSecret: process.env.JDOODLE_CLIENT_SECRET,
    });

    const outputPayload =
      typeof response.data.output === 'string'
        ? response.data.output
        : JSON.stringify(response.data);

    if (roomId) {
      io.to(roomId).emit(ACTIONS.OUTPUT_CHANGE, {
        output: outputPayload,
      });
    }

    res.json(response.data);
  } catch (error) {
    console.error('Compilation error:', error);
    res.status(500).json({ 
      error: 'Failed to compile code',
      details: error.response?.data || error.message 
    });
  }
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
const buildPath = path.join(__dirname, '..', 'client', 'build');

app.use(express.static(buildPath));

app.get('*', (_, res) => {
  res.sendFile(path.join(buildPath, 'index.html'));
});
