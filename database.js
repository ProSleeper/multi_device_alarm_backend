const mysql = require('mysql');

// ─── 커넥션 풀 생성 ────────────────────────────────────────────────────────────
const pool = mysql.createPool({
  host:               process.env.DB_HOST      || 'localhost',
  port:               process.env.DB_PORT      || 3306,
  user:               process.env.DB_USER      || 'root',
  password:           process.env.DB_PASSWORD  || '',
  database:           process.env.DB_NAME      || 'alarm_db',
  charset:            'utf8mb4',
  timezone:           'Z',                 // UTC (ISO 문자열과 일치)
  multipleStatements: false,
  waitForConnections: true,
  connectionLimit:    10,
  acquireTimeout:     10000,
});

// ─── SQLite 호환 래퍼 ──────────────────────────────────────────────────────────
// alarms.js / auth.js(routes) 의 db.run / db.get / db.all / db.serialize 호출을
// 수정 없이 그대로 사용할 수 있도록 동일한 시그니처를 제공합니다.
const db = {
  /**
   * serialize(fn) – SQLite 전용 직렬화. MySQL에서는 그냥 fn() 실행.
   */
  serialize(fn) {
    fn();
  },

  /**
   * run(sql [, params] [, callback])
   * callback: function(err)  — this.lastID / this.changes 사용 가능
   */
  run(sql, params, callback) {
    if (typeof params === 'function') {
      callback = params;
      params   = [];
    }
    params = params || [];

    pool.query(sql, params, function (err, result) {
      if (!callback) return;
      if (err) {
        callback.call({}, err);
      } else {
        callback.call(
          {
            lastID:  result.insertId     || 0,
            changes: result.affectedRows || 0,
          },
          null
        );
      }
    });
  },

  /**
   * get(sql [, params], callback)
   * callback: function(err, row)  — 첫 번째 행만 반환
   */
  get(sql, params, callback) {
    if (typeof params === 'function') {
      callback = params;
      params   = [];
    }
    params = params || [];

    pool.query(sql, params, function (err, results) {
      if (callback) callback(err, results && results.length ? results[0] : undefined);
    });
  },

  /**
   * all(sql [, params], callback)
   * callback: function(err, rows)
   */
  all(sql, params, callback) {
    if (typeof params === 'function') {
      callback = params;
      params   = [];
    }
    params = params || [];

    pool.query(sql, params, function (err, results) {
      if (callback) callback(err, results || []);
    });
  },
};

// ─── 테이블 초기화 ─────────────────────────────────────────────────────────────
pool.getConnection((connErr, connection) => {
  if (connErr) {
    console.error('❌ MySQL 데이터베이스 연결 실패:', connErr.message);
    return;
  }
  console.log('✅ MySQL 데이터베이스 연결 성공');
  connection.release();
});

// 사용자 테이블
db.run(`
  CREATE TABLE IF NOT EXISTS users (
    id         INT           NOT NULL AUTO_INCREMENT,
    email      VARCHAR(191)  NOT NULL UNIQUE,
    password   VARCHAR(255)  NOT NULL,
    created_at DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`, (err) => {
  if (err) console.error('❌ users 테이블 생성 실패:', err.message);
  else      console.log('✅ users 테이블 준비 완료');
});

// 알람 테이블
db.run(`
  CREATE TABLE IF NOT EXISTS alarms (
    id                  INT           NOT NULL AUTO_INCREMENT,
    user_id             INT           NOT NULL,
    hour                INT           NOT NULL,
    minute              INT           NOT NULL,
    label               TEXT,
    is_enabled          TINYINT(1)    NOT NULL DEFAULT 1,
    repeat_days         TEXT,
    skip_next_date      VARCHAR(50),
    repeat_type         VARCHAR(50)   NOT NULL DEFAULT 'none',
    repeat_month_day    INT,
    repeat_year_month   INT,
    repeat_year_day     INT,
    specific_date       VARCHAR(50),
    sound_path          TEXT,
    is_silent           TINYINT(1)    NOT NULL DEFAULT 0,
    deleted             TINYINT(1)    NOT NULL DEFAULT 0,
    created_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`, (err) => {
  if (err) {
    console.error('❌ alarms 테이블 생성 실패:', err.message);
    return;
  }
  console.log('✅ alarms 테이블 준비 완료');

  // 기존 테이블에 컬럼이 없을 경우를 대비한 ALTER TABLE
  // MySQL 5.6은 ADD COLUMN IF NOT EXISTS를 지원하지 않으므로 에러를 무시합니다.
  const alterCommands = [
    "ALTER TABLE alarms ADD COLUMN skip_next_date VARCHAR(50)",
    "ALTER TABLE alarms ADD COLUMN repeat_type VARCHAR(50) NOT NULL DEFAULT 'none'",
    "ALTER TABLE alarms ADD COLUMN repeat_month_day INT",
    "ALTER TABLE alarms ADD COLUMN repeat_year_month INT",
    "ALTER TABLE alarms ADD COLUMN repeat_year_day INT",
    "ALTER TABLE alarms ADD COLUMN specific_date VARCHAR(50)",
    "ALTER TABLE alarms ADD COLUMN sound_path TEXT",
    "ALTER TABLE alarms ADD COLUMN is_silent TINYINT(1) NOT NULL DEFAULT 0",
    "ALTER TABLE alarms ADD COLUMN deleted TINYINT(1) NOT NULL DEFAULT 0",
    "ALTER TABLE alarms ADD COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP",
    "ALTER TABLE alarms ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP",
  ];

  alterCommands.forEach((cmd) => {
    db.run(cmd, (err) => {
      // 1060 = Duplicate column name → 이미 존재하는 컬럼이므로 무시
      if (err && err.errno !== 1060) {
        console.error('⚠️ 컬럼 추가 실패:', err.message);
      }
    });
  });
});

module.exports = db;