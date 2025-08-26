const db = require('../config/database');

class Session {
    // Create or update active session
    static async create(sessionId, userId, socketId = null, roomName = null, ipAddress = null, userAgent = null) {
        try {
            // First check if session already exists
            const existing = await this.findBySessionId(sessionId);
            
            if (existing) {
                // Update existing session
                return await this.update(sessionId, { socketId, roomName, ipAddress, userAgent });
            }
            
            // Create new session
            const [result] = await db.execute(
                `INSERT INTO active_sessions (session_id, user_id, socket_id, room_name, ip_address, user_agent, created_at, last_activity)
                 VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())`,
                [sessionId, userId, socketId, roomName, ipAddress, userAgent]
            );
            
            return result;
        } catch (error) {
            console.error('Session creation error:', error);
            throw new Error('Failed to create session: ' + error.message);
        }
    }

    // Update existing session with better error handling
    static async update(sessionId, updates = {}) {
        try {
            const { socketId, roomName, ipAddress, userAgent } = updates;
            
            // Build dynamic update query
            const updateFields = [];
            const values = [];
            
            if (socketId !== undefined) {
                updateFields.push('socket_id = ?');
                values.push(socketId);
            }
            
            if (roomName !== undefined) {
                updateFields.push('room_name = ?');
                values.push(roomName);
            }
            
            if (ipAddress !== undefined) {
                updateFields.push('ip_address = ?');
                values.push(ipAddress);
            }
            
            if (userAgent !== undefined) {
                updateFields.push('user_agent = ?');
                values.push(userAgent);
            }
            
            // Always update last_activity
            updateFields.push('last_activity = NOW()');
            values.push(sessionId);
            
            if (updateFields.length === 1) {
                // Only last_activity update
                await db.execute(
                    'UPDATE active_sessions SET last_activity = NOW() WHERE session_id = ?',
                    [sessionId]
                );
            } else {
                const query = `UPDATE active_sessions SET ${updateFields.join(', ')} WHERE session_id = ?`;
                await db.execute(query, values);
            }
            
            return true;
        } catch (error) {
            console.error('Session update error:', error);
            throw new Error('Failed to update session: ' + error.message);
        }
    }

    // Update session activity with better validation
    static async updateActivity(sessionId, socketId = null, roomName = null) {
        try {
            if (!sessionId) {
                throw new Error('Session ID is required');
            }
            
            return await this.update(sessionId, { socketId, roomName });
        } catch (error) {
            console.error('Activity update error:', error);
            throw error;
        }
    }

    // Remove session with proper cleanup
    static async remove(sessionId) {
        try {
            if (!sessionId) {
                return false;
            }
            
            const [result] = await db.execute(
                'DELETE FROM active_sessions WHERE session_id = ?',
                [sessionId]
            );
            
            return result.affectedRows > 0;
        } catch (error) {
            console.error('Session removal error:', error);
            throw new Error('Failed to remove session: ' + error.message);
        }
    }

    // Remove session by socket ID
    static async removeBySocketId(socketId) {
        try {
            if (!socketId) {
                return false;
            }
            
            const [result] = await db.execute(
                'DELETE FROM active_sessions WHERE socket_id = ?',
                [socketId]
            );
            
            return result.affectedRows > 0;
        } catch (error) {
            console.error('Session removal by socket error:', error);
            throw new Error('Failed to remove session by socket: ' + error.message);
        }
    }

    // Find session by session ID
    static async findBySessionId(sessionId) {
        try {
            if (!sessionId) {
                return null;
            }
            
            const [rows] = await db.execute(
                'SELECT * FROM active_sessions WHERE session_id = ?',
                [sessionId]
            );
            
            return rows[0] || null;
        } catch (error) {
            console.error('Find session error:', error);
            throw new Error('Failed to find session: ' + error.message);
        }
    }

    // Get session by socket ID with user info
    static async findBySocketId(socketId) {
        try {
            if (!socketId) {
                return null;
            }
            
            const [rows] = await db.execute(`
                SELECT s.*, u.username, u.email, u.is_online, u.avatar_url
                FROM active_sessions s
                LEFT JOIN users u ON s.user_id = u.id
                WHERE s.socket_id = ?
            `, [socketId]);
            
            return rows[0] || null;
        } catch (error) {
            console.error('Find session by socket error:', error);
            throw new Error('Failed to find session by socket: ' + error.message);
        }
    }

    // Get users in a specific room with better error handling
    static async getUsersInRoom(roomName) {
        try {
            if (!roomName) {
                return [];
            }
            
            const [rows] = await db.execute(`
                SELECT DISTINCT 
                    u.id, 
                    u.username, 
                    u.is_online, 
                    u.avatar_url,
                    s.last_activity,
                    s.socket_id
                FROM users u
                JOIN active_sessions s ON u.id = s.user_id
                WHERE s.room_name = ? AND s.last_activity > DATE_SUB(NOW(), INTERVAL 1 HOUR)
                ORDER BY u.username ASC
            `, [roomName]);
            
            return rows;
        } catch (error) {
            console.error('Get users in room error:', error);
            throw new Error('Failed to get users in room: ' + error.message);
        }
    }

    // Get all active rooms with user counts
    static async getActiveRooms() {
        try {
            const [rows] = await db.execute(`
                SELECT 
                    room_name, 
                    COUNT(DISTINCT user_id) as user_count,
                    MAX(last_activity) as last_activity
                FROM active_sessions 
                WHERE room_name IS NOT NULL 
                AND last_activity > DATE_SUB(NOW(), INTERVAL 1 HOUR)
                GROUP BY room_name
                ORDER BY user_count DESC, room_name ASC
            `);
            
            return rows;
        } catch (error) {
            console.error('Get active rooms error:', error);
            throw new Error('Failed to get active rooms: ' + error.message);
        }
    }

    // Get user's active sessions
    static async getUserSessions(userId) {
        try {
            if (!userId) {
                return [];
            }
            
            const [rows] = await db.execute(`
                SELECT session_id, socket_id, room_name, ip_address, last_activity, created_at
                FROM active_sessions 
                WHERE user_id = ? 
                ORDER BY last_activity DESC
            `, [userId]);
            
            return rows;
        } catch (error) {
            console.error('Get user sessions error:', error);
            throw new Error('Failed to get user sessions: ' + error.message);
        }
    }

    // Validate session exists and is recent
    static async isValidSession(sessionId) {
        try {
            if (!sessionId) {
                return false;
            }
            
            const [rows] = await db.execute(`
                SELECT id FROM active_sessions 
                WHERE session_id = ? 
                AND last_activity > DATE_SUB(NOW(), INTERVAL 24 HOUR)
            `, [sessionId]);
            
            return rows.length > 0;
        } catch (error) {
            console.error('Session validation error:', error);
            return false;
        }
    }

    // Clean old sessions with configurable timeout
    static async cleanOldSessions(hoursOld = 24) {
        try {
            const [result] = await db.execute(
                'DELETE FROM active_sessions WHERE last_activity < DATE_SUB(NOW(), INTERVAL ? HOUR)',
                [hoursOld]
            );
            
            console.log(`Cleaned ${result.affectedRows} old sessions`);
            return result.affectedRows;
        } catch (error) {
            console.error('Session cleanup error:', error);
            throw new Error('Failed to clean old sessions: ' + error.message);
        }
    }

    // Clean sessions for a specific user (except current)
    static async cleanUserSessions(userId, exceptSessionId = null) {
        try {
            if (!userId) {
                return 0;
            }
            
            let query = 'DELETE FROM active_sessions WHERE user_id = ?';
            let params = [userId];
            
            if (exceptSessionId) {
                query += ' AND session_id != ?';
                params.push(exceptSessionId);
            }
            
            const [result] = await db.execute(query, params);
            return result.affectedRows;
        } catch (error) {
            console.error('User session cleanup error:', error);
            throw new Error('Failed to clean user sessions: ' + error.message);
        }
    }

    // Update user's online status based on sessions
    static async updateUserOnlineStatus(userId) {
        try {
            if (!userId) {
                return false;
            }
            
            // Check if user has any active sessions in last 10 minutes
            const [activeSessions] = await db.execute(`
                SELECT COUNT(*) as count 
                FROM active_sessions 
                WHERE user_id = ? 
                AND last_activity > DATE_SUB(NOW(), INTERVAL 10 MINUTE)
            `, [userId]);
            
            const isOnline = activeSessions[0].count > 0;
            
            // Update user status
            await db.execute(
                'UPDATE users SET is_online = ?, last_seen = NOW() WHERE id = ?',
                [isOnline, userId]
            );
            
            return isOnline;
        } catch (error) {
            console.error('Update online status error:', error);
            throw new Error('Failed to update online status: ' + error.message);
        }
    }
}

module.exports = Session;