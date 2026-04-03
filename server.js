const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname)); // отдаём index.html из той же папки

// Хранилище сообщений в памяти (очищается при перезапуске)
let messages = [];

// Валидные пользователи (ник:пароль)
const validUsers = {
  "Ваниш": "Серафима1410",
  "Wezxqqs1x": "BlackPussy2009",
  "дамурчег": "дмрчг9307",
  "тест": "тест",
  "тест1": "тест1"
};

// Авторизация
app.post('/auth', (req, res) => {
  const { nick, key } = req.body;
  if (validUsers[nick] && validUsers[nick] === key) {
    res.json({ success: true, nick });
  } else {
    res.json({ success: false, error: 'Неизвестно' });
  }
});

// Получение истории (последние 100 сообщений)
app.get('/messages', (req, res) => {
  res.json(messages.slice(-100));
});

// WebSocket
io.on('connection', (socket) => {
  console.log('Клиент подключился');
  socket.on('new message', (data) => {
    const { nick, text } = data;
    if (!nick || !text || !text.trim()) return;
    const newMsg = { id: Date.now(), nick, text: text.trim(), created_at: new Date() };
    messages.push(newMsg);
    io.emit('message received', newMsg);
  });
  socket.on('disconnect', () => console.log('Клиент отключился'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Сервер чата запущен на порту ${PORT}`));