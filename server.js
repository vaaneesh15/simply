const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Хранилище сообщений в памяти
let messages = [];

// Авторизация — только ник
app.post('/auth', (req, res) => {
  const { nick } = req.body;
  if (!nick || nick.trim() === '') {
    return res.status(400).json({ success: false, error: 'Ник не может быть пустым' });
  }
  const token = Math.random().toString(36).substring(2, 15);
  res.json({ success: true, nick: nick.trim(), token });
});

app.post('/verify', (req, res) => {
  res.json({ success: true });
});

app.get('/messages', (req, res) => {
  res.json(messages.slice(-200));
});

app.post('/delete-message', (req, res) => {
  const { nick, messageId } = req.body;
  if (!nick || !messageId) return res.status(400).json({ success: false });
  const msgIndex = messages.findIndex(m => m.id === messageId);
  if (msgIndex !== -1 && messages[msgIndex].nick === nick) {
    messages.splice(msgIndex, 1);
    io.emit('message deleted', messageId);
    res.json({ success: true });
  } else {
    res.json({ success: false });
  }
});

io.on('connection', (socket) => {
  console.log('Клиент подключился');
  socket.on('new message', (data) => {
    const { nick, text } = data;
    if (!nick || !text || text.trim() === '') return;
    const newMsg = {
      id: Date.now(),
      nick,
      text: text.trim(),
      created_at: new Date()
    };
    messages.push(newMsg);
    io.emit('message received', newMsg);
  });
  socket.on('disconnect', () => console.log('Клиент отключился'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Сервер запущен на порту ${PORT}`));
