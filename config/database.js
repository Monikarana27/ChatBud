const mysql = require('mysql2/promise');

// Use Railway DATABASE_URL or fallback to hardcoded connection
const DATABASE_URL = process.env.DATABASE_URL || 'mysql://root:kOAINsPWebXPIyJOIuXVjlBSztDgJDiw@hopper.proxy.rlwy.net:59199/railway';

const pool = mysql.createPool({
    uri: DATABASE_URL,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    timezone: '+06:00' // Bangladesh timezone
});

// Test connection
pool.getConnection()
    .then(connection => {
        console.log('✅ Connected to MySQL Database');
        console.log('📊 Database:', connection.config.database);
        console.log('🏠 Host:', connection.config.host);
        connection.release();
    })
    .catch(err => {
        console.error('❌ Database connection failed:', err.message);
        console.error('🔗 DATABASE_URL set:', !!process.env.DATABASE_URL);
        console.error('📝 Error code:', err.code);
        console.error('📝 Error errno:', err.errno);
    });

module.exports = pool;
