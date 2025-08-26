const db = require('../config/database');
const bcrypt = require('bcryptjs');

class User {
    // Create new user with hashed password
    static async create(username, email, password) {
        try {
            const hashedPassword = await bcrypt.hash(password, parseInt(process.env.BCRYPT_ROUNDS) || 12);
            const [result] = await db.execute(
                'INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)',
                [username, email, hashedPassword]
            );
            return result.insertId;
        } catch (error) {
            throw error;
        }
    }

    // Find user by email for login
    static async findByEmail(email) {
        try {
            console.log('🔍 Searching for user by email:', email);
            const [rows] = await db.execute(
                'SELECT * FROM users WHERE email = ?',
                [email]
            );
            console.log('📧 Email search result:', rows.length > 0 ? 'Found user' : 'No user found');
            if (rows.length > 0) {
                console.log('📧 Found user:', { id: rows[0].id, username: rows[0].username, email: rows[0].email });
            }
            return rows[0];
        } catch (error) {
            console.error('❌ Email search error:', error);
            throw error;
        }
    }

    // Find user by username
    static async findByUsername(username) {
        try {
            console.log('🔍 Searching for user by username:', username);
            const [rows] = await db.execute(
                'SELECT * FROM users WHERE username = ?',
                [username]
            );
            console.log('👤 Username search result:', rows.length > 0 ? 'Found user' : 'No user found');
            if (rows.length > 0) {
                console.log('👤 Found user:', { id: rows[0].id, username: rows[0].username, email: rows[0].email });
            }
            return rows[0];
        } catch (error) {
            console.error('❌ Username search error:', error);
            throw error;
        }
    }

    // Find user by email OR username (for login)
    static async findByEmailOrUsername(emailOrUsername) {
        try {
            console.log('🔍 Searching for user by email or username:', emailOrUsername);
            
            // First try email
            const userByEmail = await this.findByEmail(emailOrUsername);
            if (userByEmail) {
                console.log('✅ Found user by email');
                return userByEmail;
            }
            
            // Then try username
            const userByUsername = await this.findByUsername(emailOrUsername);
            if (userByUsername) {
                console.log('✅ Found user by username');
                return userByUsername;
            }
            
            console.log('❌ No user found');
            return null;
        } catch (error) {
            console.error('❌ Search error:', error);
            throw error;
        }
    }

    // Find user by ID
    static async findById(id) {
        try {
            const [rows] = await db.execute(
                'SELECT id, username, email, avatar_url, is_online, created_at FROM users WHERE id = ?',
                [id]
            );
            return rows[0];
        } catch (error) {
            throw error;
        }
    }

    // Update online status
    static async setOnlineStatus(userId, isOnline) {
        try {
            await db.execute(
                'UPDATE users SET is_online = ?, last_seen = CURRENT_TIMESTAMP WHERE id = ?',
                [isOnline, userId]
            );
        } catch (error) {
            throw error;
        }
    }

    // Get users in a specific room
    static async getUsersInRoom(roomName) {
        try {
            const [rows] = await db.execute(`
                SELECT DISTINCT u.id, u.username, u.is_online, u.avatar_url
                FROM users u
                JOIN active_sessions s ON u.id = s.user_id
                WHERE s.room_name = ?
                ORDER BY u.username
            `, [roomName]);
            return rows;
        } catch (error) {
            throw error;
        }
    }

    // Verify password with debug logging
    static async verifyPassword(password, hashedPassword) {
        try {
            console.log('🔐 Verifying password...');
            console.log('🔐 Input password length:', password.length);
            console.log('🔐 Stored hash length:', hashedPassword ? hashedPassword.length : 'null/undefined');
            
            const result = await bcrypt.compare(password, hashedPassword);
            console.log('🔐 Password verification result:', result ? 'Valid' : 'Invalid');
            return result;
        } catch (error) {
            console.error('❌ Password verification error:', error);
            return false;
        }
    }
}

module.exports = User;