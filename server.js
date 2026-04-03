const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const cors = require('cors');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// PostgreSQL – строка подключения из переменной окружения
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Инициализация таблиц
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      nick VARCHAR(50) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      token TEXT UNIQUE,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      nick VARCHAR(50) NOT NULL,
      text TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  console.log('✅ База данных готова');
}
initDB();

// Вспомогательная функция: поиск пользователя по токену
async function findUserByToken(token) {
  if (!token) return null;
  const res = await pool.query('SELECT nick FROM users WHERE token = $1', [token]);
  return res.rows[0] || null;
}

// ---------- API ----------
// Регистрация / вход (единая кнопка)
app.post('/auth', async (req, res) => {
  const { nick, key } = req.body;
  if (!nick || !key) return res.status(400).json({ success: false, error: 'Заполните поля' });

  const existing = await pool.query('SELECT id, password_hash FROM users WHERE nick = $1', [nick]);
  if (existing.rows.length > 0) {
    // Проверка пароля
    const valid = await bcrypt.compare(key, existing.rows[0].password_hash);
    if (!valid) return res.json({ success: false, error: 'Неверный ключ' });
    // Обновляем токен (новая сессия)
    const token = uuidv4();
    await pool.query('UPDATE users SET token = $1 WHERE id = $2', [token, existing.rows[0].id]);
    return res.json({ success: true, nick, token });
  } else {
    // Регистрация
    const hash = await bcrypt.hash(key, 10);
    const token = uuidv4();
    await pool.query('INSERT INTO users (nick, password_hash, token) VALUES ($1, $2, $3)', [nick, hash, token]);
    return res.json({ success: true, nick, token });
  }
});

// Проверка токена (бесшовный вход)
app.post('/verify', async (req, res) => {
  const { token } = req.body;
  const user = await findUserByToken(token);
  if (user) res.json({ success: true, nick: user.nick });
  else res.json({ success: false });
});

// Смена ника
app.post('/change-nick', async (req, res) => {
  const { token, newNick } = req.body;
  if (!token || !newNick) return res.status(400).json({ success: false, error: 'Данные неполные' });
  const user = await findUserByToken(token);
  if (!user) return res.json({ success: false, error: 'Сессия недействительна' });
  // Проверка, что новый ник не занят
  const existing = await pool.query('SELECT id FROM users WHERE nick = $1', [newNick]);
  if (existing.rows.length > 0) return res.json({ success: false, error: 'Ник уже занят' });
  await pool.query('UPDATE users SET nick = $1 WHERE token = $2', [newNick, token]);
  // Обновляем ник в сообщениях пользователя (опционально)
  await pool.query('UPDATE messages SET nick = $1 WHERE nick = $2', [newNick, user.nick]);
  res.json({ success: true, newNick });
});

// Смена пароля
app.post('/change-password', async (req, res) => {
  const { token, oldPassword, newPassword } = req.body;
  if (!token || !oldPassword || !newPassword) return res.status(400).json({ success: false, error: 'Заполните поля' });
  const userRes = await pool.query('SELECT id, password_hash FROM users WHERE token = $1', [token]);
  if (userRes.rows.length === 0) return res.json({ success: false, error: 'Сессия недействительна' });
  const user = userRes.rows[0];
  const valid = await bcrypt.compare(oldPassword, user.password_hash);
  if (!valid) return res.json({ success: false, error: 'Неверный старый пароль' });
  const newHash = await bcrypt.hash(newPassword, 10);
  await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, user.id]);
  res.json({ success: true });
});

// История сообщений
app.get('/messages', async (req, res) => {
  const result = await pool.query('SELECT id, nick, text, created_at FROM messages ORDER BY created_at ASC LIMIT 200');
  res.json(result.rows);
});

// WebSocket – новые сообщения
io.on('connection', (socket) => {
  console.log('Клиент подключился');
  socket.on('new message', async (data) => {
    const { nick, text } = data;
    if (!nick || !text || !text.trim()) return;
    const result = await pool.query(
      'INSERT INTO messages (nick, text) VALUES ($1, $2) RETURNING id, created_at',
      [nick, text.trim()]
    );
    const newMsg = {
      id: result.rows[0].id,
      nick,
      text: text.trim(),
      created_at: result.rows[0].created_at
    };
    io.emit('message received', newMsg);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Сервер на порту ${PORT}`));
