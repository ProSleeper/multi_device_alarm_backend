require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');
const jwt = require('jsonwebtoken');

const authRoutes = require('./routes/auth');
const alarmRoutes = require('./routes/alarms');
const { JWT_SECRET } = require('./middleware/auth');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '172.20.10.8';

// 미들웨어
app.use(cors());
app.use(express.json());

// 요청 로깅 미들웨어 (디버깅용)
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// WebSocket을 app.locals에 저장 (라우트에서 접근 가능)
app.locals.wss = wss;

// 라우트
app.use('/api/auth', authRoutes);
app.use('/api/alarms', alarmRoutes);

// 기본 라우트
app.get('/', (req, res) => {
  res.json({
    message: 'Smart Alarm API Server',
    version: '2.0.0',
    status: 'running',
    endpoints: {
      auth: {
        register: 'POST /api/auth/register',
        login: 'POST /api/auth/login'
      },
      alarms: {
        list: 'GET /api/alarms',
        create: 'POST /api/alarms',
        update: 'PUT /api/alarms/:id',
        delete: 'DELETE /api/alarms/:id'
      }
    },
    features: [
      'User Authentication',
      'Alarm CRUD Operations',
      'Multiple Repeat Types (daily, weekly, monthly, yearly, specific_date)',
      'Skip Next Alarm',
      'Custom Sound Path',
      'WebSocket Real-time Sync'
    ]
  });
});

// 헬스체크 엔드포인트
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// 404 핸들러
app.use((req, res) => {
  res.status(404).json({ error: '요청한 경로를 찾을 수 없습니다' });
});

// 에러 핸들러
app.use((err, req, res, next) => {
  console.error('서버 에러:', err);
  res.status(500).json({ error: '서버 내부 오류가 발생했습니다' });
});

// WebSocket 연결 처리
wss.on('connection', (ws) => {
  console.log('🔌 WebSocket 클라이언트 연결됨');

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      // 인증 처리
      if (data.type === 'auth' && data.token) {
        jwt.verify(data.token, JWT_SECRET, (err, decoded) => {
          if (err) {
            console.error('WebSocket 인증 실패:', err.message);
            ws.send(JSON.stringify({ type: 'error', message: '인증 실패' }));
            ws.close();
          } else {
            ws.userId = decoded.userId;
            ws.send(JSON.stringify({ type: 'auth_success', message: '인증 성공' }));
            console.log(`✅ 사용자 ${decoded.email} (ID: ${decoded.userId}) WebSocket 인증 완료`);
          }
        });
      }
    } catch (error) {
      console.error('WebSocket 메시지 처리 오류:', error);
    }
  });

  ws.on('close', () => {
    console.log('🔌 WebSocket 클라이언트 연결 해제됨');
  });

  ws.on('error', (error) => {
    console.error('WebSocket 에러:', error);
  });
});

// 서버 시작
server.listen(PORT, HOST, () => {
  console.log('='.repeat(60));
  console.log('🚀 Smart Alarm API Server 시작됨');
  console.log(`📡 서버 주소: http://${HOST}:${PORT}`);
  console.log(`🔌 WebSocket: ws://${HOST}:${PORT}`);
  console.log(`📱 Flutter 앱 호환 버전`);
  console.log('='.repeat(60));
  console.log('');
  console.log('✅ 지원 기능:');
  console.log('  - 다중 반복 타입 (daily, weekly, monthly, yearly, specific_date)');
  console.log('  - 1회 스킵 기능');
  console.log('  - 커스텀 알람음');
  console.log('  - 실시간 동기화 (WebSocket)');
  console.log('');
  console.log('📝 API 테스트: http://' + HOST + ':' + PORT);
  console.log('');
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n서버를 종료합니다...');
  
  // WebSocket 연결 종료
  wss.clients.forEach(client => {
    client.close();
  });
  
  server.close(() => {
    console.log('서버가 정상적으로 종료되었습니다');
    process.exit(0);
  });
});