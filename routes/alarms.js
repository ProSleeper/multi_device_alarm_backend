const express = require('express');
const db = require('../database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// 모든 라우트에 인증 미들웨어 적용
router.use(authenticateToken);

// 알람 목록 조회 - 타임스탬프 포함
router.get('/', (req, res) => {
  const userId = req.user.userId;

  db.all(
    'SELECT * FROM alarms WHERE user_id = ? AND deleted = 0 ORDER BY hour, minute',
    [userId],
    (err, alarms) => {
      if (err) {
        console.error('알람 조회 오류:', err);
        return res.status(500).json({ error: '알람 조회 중 오류가 발생했습니다' });
      }

      // Flutter 앱이 기대하는 형식으로 변환 (타임스탬프 포함)
      const parsedAlarms = alarms.map(alarm => ({
        id: alarm.id, // server_id로 사용됨
        server_id: alarm.id,
        hour: alarm.hour,
        minute: alarm.minute,
        label: alarm.label || '',
        is_enabled: Boolean(alarm.is_enabled),
        repeat_days: JSON.parse(alarm.repeat_days || '[]'),
        skip_next_date: alarm.skip_next_date,
        repeat_type: alarm.repeat_type || 'none',
        repeat_month_day: alarm.repeat_month_day,
        repeat_year_month: alarm.repeat_year_month,
        repeat_year_day: alarm.repeat_year_day,
        specific_date: alarm.specific_date,
        sound_path: alarm.sound_path,
        created_at: alarm.created_at, // 타임스탬프 추가
        updated_at: alarm.updated_at, // 타임스탬프 추가
        is_synced: true,
        deleted: false
      }));

      console.log(`📋 알람 조회: 사용자 ID ${userId} - ${parsedAlarms.length}개`);
      res.json(parsedAlarms);
    }
  );
});

// 알람 생성 - 타임스탬프 포함
router.post('/', (req, res) => {
  const userId = req.user.userId;
  const { 
    hour, 
    minute, 
    label, 
    is_enabled, 
    repeat_days,
    skip_next_date,
    repeat_type,
    repeat_month_day,
    repeat_year_month,
    repeat_year_day,
    specific_date,
    sound_path,
    created_at,  // 클라이언트에서 전송
    updated_at   // 클라이언트에서 전송
  } = req.body;

  // 유효성 검사
  if (hour === undefined || minute === undefined) {
    return res.status(400).json({ error: '시간 정보가 필요합니다' });
  }

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return res.status(400).json({ error: '올바른 시간 형식이 아닙니다' });
  }

  const repeatDaysJson = JSON.stringify(repeat_days || []);
  
  // 타임스탬프 처리: 클라이언트가 보낸 값 우선, 없으면 현재 시간
  const createdAtValue = created_at || new Date().toISOString();
  const updatedAtValue = updated_at || new Date().toISOString();

  db.run(
    `INSERT INTO alarms (
      user_id, hour, minute, label, is_enabled, repeat_days,
      skip_next_date, repeat_type, repeat_month_day, repeat_year_month,
      repeat_year_day, specific_date, sound_path, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userId, 
      hour, 
      minute, 
      label || '', 
      is_enabled !== false ? 1 : 0, 
      repeatDaysJson,
      skip_next_date || null,
      repeat_type || 'none',
      repeat_month_day || null,
      repeat_year_month || null,
      repeat_year_day || null,
      specific_date || null,
      sound_path || null,
      createdAtValue,
      updatedAtValue
    ],
    function(err) {
      if (err) {
        console.error('알람 생성 오류:', err);
        return res.status(500).json({ error: '알람 생성 중 오류가 발생했습니다' });
      }

      const alarmId = this.lastID;
      console.log(`➕ 알람 생성: ${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')} (ID: ${alarmId})`);

      // WebSocket으로 변경 알림 전송
      if (req.app.locals.wss) {
        broadcastAlarmChange(req.app.locals.wss, userId, 'create', alarmId);
      }

      // Flutter 앱이 기대하는 형식으로 응답
      res.json({
        message: '알람이 생성되었습니다',
        id: alarmId,
        created_at: createdAtValue,
        updated_at: updatedAtValue,
        alarm: {
          id: alarmId,
          server_id: alarmId,
          user_id: userId,
          hour,
          minute,
          label: label || '',
          is_enabled: is_enabled !== false,
          repeat_days: repeat_days || [],
          skip_next_date: skip_next_date || null,
          repeat_type: repeat_type || 'none',
          repeat_month_day: repeat_month_day || null,
          repeat_year_month: repeat_year_month || null,
          repeat_year_day: repeat_year_day || null,
          specific_date: specific_date || null,
          sound_path: sound_path || null,
          created_at: createdAtValue,
          updated_at: updatedAtValue
        }
      });
    }
  );
});

// 알람 수정 - 타임스탬프 포함 (증분 동기화 핵심)
router.put('/:id', (req, res) => {
  const userId = req.user.userId;
  const alarmId = req.params.id;
  const { 
    hour, 
    minute, 
    label, 
    is_enabled, 
    repeat_days,
    skip_next_date,
    repeat_type,
    repeat_month_day,
    repeat_year_month,
    repeat_year_day,
    specific_date,
    sound_path,
    updated_at  // 클라이언트에서 전송 (중요!)
  } = req.body;

  // 유효성 검사
  if (hour === undefined || minute === undefined) {
    return res.status(400).json({ error: '시간 정보가 필요합니다' });
  }

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return res.status(400).json({ error: '올바른 시간 형식이 아닙니다' });
  }

  const repeatDaysJson = JSON.stringify(repeat_days || []);
  
  // 타임스탬프 처리: 클라이언트가 보낸 값 우선, 없으면 현재 시간
  const updatedAtValue = updated_at || new Date().toISOString();

  db.run(
    `UPDATE alarms 
     SET hour = ?, minute = ?, label = ?, is_enabled = ?, repeat_days = ?,
         skip_next_date = ?, repeat_type = ?, repeat_month_day = ?,
         repeat_year_month = ?, repeat_year_day = ?, specific_date = ?,
         sound_path = ?, updated_at = ?
     WHERE id = ? AND user_id = ?`,
    [
      hour, 
      minute, 
      label || '', 
      is_enabled ? 1 : 0, 
      repeatDaysJson,
      skip_next_date || null,
      repeat_type || 'none',
      repeat_month_day || null,
      repeat_year_month || null,
      repeat_year_day || null,
      specific_date || null,
      sound_path || null,
      updatedAtValue,  // 클라이언트 타임스탬프 유지
      alarmId, 
      userId
    ],
    function(err) {
      if (err) {
        console.error('알람 수정 오류:', err);
        return res.status(500).json({ error: '알람 수정 중 오류가 발생했습니다' });
      }

      if (this.changes === 0) {
        return res.status(404).json({ error: '알람을 찾을 수 없습니다' });
      }

      console.log(`🔄 알람 수정: ID ${alarmId} - ${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`);

      // WebSocket으로 변경 알림 전송
      if (req.app.locals.wss) {
        broadcastAlarmChange(req.app.locals.wss, userId, 'update', alarmId);
      }

      res.json({ 
        message: '알람이 수정되었습니다',
        updated_at: updatedAtValue,
        changes: this.changes
      });
    }
  );
});

// 알람 삭제 (Soft Delete)
router.delete('/:id', (req, res) => {
  const userId = req.user.userId;
  const alarmId = req.params.id;

  db.run(
    'UPDATE alarms SET deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?',
    [alarmId, userId],
    function(err) {
      if (err) {
        console.error('알람 삭제 오류:', err);
        return res.status(500).json({ error: '알람 삭제 중 오류가 발생했습니다' });
      }

      if (this.changes === 0) {
        return res.status(404).json({ error: '알람을 찾을 수 없습니다' });
      }

      console.log(`🗑️ 알람 삭제 (Soft): ID ${alarmId}`);

      // WebSocket으로 변경 알림 전송
      if (req.app.locals.wss) {
        broadcastAlarmChange(req.app.locals.wss, userId, 'delete', alarmId);
      }

      res.json({ 
        message: '알람이 삭제되었습니다',
        changes: this.changes
      });
    }
  );
});

// WebSocket 브로드캐스트 헬퍼 함수
function broadcastAlarmChange(wss, userId, action, alarmId) {
  wss.clients.forEach((client) => {
    if (client.readyState === 1 && client.userId === userId) {
      client.send(JSON.stringify({ 
        type: 'alarm_change',
        action: action,
        alarmId: alarmId
      }));
    }
  });
}

module.exports = router;