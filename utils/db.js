// utils/db.js
const config = require('../config');
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: config.db.host,
  user: config.db.user,
  password: config.db.password,
  database: config.db.name,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  connectTimeout: 5000,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
});

// Safe wrappers (no 'this' binding problems)
const execute = (sql, params) => pool.execute(sql, params);
const query = (sql, params) => pool.query(sql, params);
const getConnection = () => pool.getConnection();

module.exports = { pool, execute, query, getConnection };
