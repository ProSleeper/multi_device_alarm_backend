const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../database');
const { JWT_SECRET } = require('../middleware/auth');

const router = express.Router();

// 회원가입
router.post('/register', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: '이메일과 비밀번호를 입력해주세요' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: '비밀번호는 6자 이상이어야 합니다' });
  }

  try {
    // 비밀번호 해싱
    const hashedPassword = await bcrypt.hash(password, 10);

    db.run(
      'INSERT INTO users (email, password) VALUES (?, ?)',
      [email, hashedPassword],
      function(err) {
        if (err) {
          if (err.message.includes('UNIQUE constraint failed')) {
            return res.status(409).json({ error: '이미 존재하는 이메일입니다' });
          }
          console.error('회원가입 오류:', err);
          return res.status(500).json({ error: '회원가입 중 오류가 발생했습니다' });
        }

        const token = jwt.sign({ userId: this.lastID, email }, JWT_SECRET, {
          expiresIn: '30d'
        });

        res.json({
          message: '회원가입 성공',
          token,
          user: { id: this.lastID, email }
        });
      }
    );
  } catch (error) {
    console.error('회원가입 서버 오류:', error);
    res.status(500).json({ error: '서버 오류가 발생했습니다' });
  }
});

// 로그인
router.post('/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: '이메일과 비밀번호를 입력해주세요' });
  }

  db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
    if (err) {
      console.error('로그인 오류:', err);
      return res.status(500).json({ error: '서버 오류가 발생했습니다' });
    }

    if (!user) {
      return res.status(401).json({ error: '이메일 또는 비밀번호가 잘못되었습니다' });
    }

    try {
      const isValidPassword = await bcrypt.compare(password, user.password);

      if (!isValidPassword) {
        return res.status(401).json({ error: '이메일 또는 비밀번호가 잘못되었습니다' });
      }

      const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, {
        expiresIn: '30d'
      });

      res.json({
        message: '로그인 성공',
        token,
        user: { id: user.id, email: user.email }
      });
    } catch (error) {
      console.error('로그인 비밀번호 검증 오류:', error);
      res.status(500).json({ error: '서버 오류가 발생했습니다' });
    }
  });
});

module.exports = router;