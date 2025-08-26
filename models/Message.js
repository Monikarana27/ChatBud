const db = require('../config/database');

class Message {
    // Ensure room exists or create it
    static async ensureRoom(roomName) {
        try {
            // Try to find room first
            const [roomRows] = await db.execute(
                'SELECT id FROM rooms WHERE name = ?',
                [roomName]
            );
            
            if (roomRows.length > 0) {
                return roomRows[0].id;
            }
            
            // Create room if it doesn't exist
            const [result] = await db.execute(
                'INSERT INTO rooms (name, created_by) VALUES (?, 1)',
                [roomName]
            );
            
            console.log(`Created new room: ${roomName} with ID: ${result.insertId}`);
            return result.insertId;
        } catch (error) {
            console.error('Error ensuring room exists:', error);
            throw error;
        }
    }

    // Save message to database
    static async create(userId, roomName, message, messageType = 'text') {
        try {
            // Ensure room exists first
            const roomId = await this.ensureRoom(roomName);
            
            const [result] = await db.execute(
                'INSERT INTO messages (user_id, room_id, message, message_type) VALUES (?, ?, ?, ?)',
                [userId, roomId, message, messageType]
            );
            
            return result.insertId;
        } catch (error) {
            console.error('Error creating message:', error);
            throw error;
        }
    }

    // Get recent messages for a room - FIXED VERSION
    static async getRecentMessages(roomName, limit = 50) {
        try {
            // First ensure room exists
            await this.ensureRoom(roomName);
            
            // Ensure limit is a valid integer and clamp it to reasonable bounds
            const messageLimit = Math.max(1, Math.min(parseInt(limit, 10) || 50, 1000));
            
            // Use query() instead of execute() to avoid parameter type issues with LIMIT
            const [rows] = await db.query(`
                SELECT m.*, u.username, u.avatar_url, m.timestamp as local_time
                FROM messages m 
                JOIN users u ON m.user_id = u.id 
                JOIN rooms r ON m.room_id = r.id
                WHERE r.name = ? AND m.is_deleted = FALSE
                ORDER BY m.timestamp DESC 
                LIMIT ${messageLimit}
            `, [roomName]);
            
            return rows.reverse();
        } catch (error) {
            console.error('Error in getRecentMessages:', error);
            return []; // Return empty array instead of throwing
        }
    }

    // Alternative approach using execute() with proper casting
    static async getRecentMessagesAlternative(roomName, limit = 50) {
        try {
            // First ensure room exists
            await this.ensureRoom(roomName);
            
            // Cast limit to UNSIGNED INTEGER in SQL to avoid type issues
            const messageLimit = Math.max(1, Math.min(parseInt(limit, 10) || 50, 1000));
            
            const [rows] = await db.execute(`
                SELECT m.*, u.username, u.avatar_url, m.timestamp as local_time
                FROM messages m 
                JOIN users u ON m.user_id = u.id 
                JOIN rooms r ON m.room_id = r.id
                WHERE r.name = ? AND m.is_deleted = FALSE
                ORDER BY m.timestamp DESC 
                LIMIT CAST(? AS UNSIGNED)
            `, [roomName, messageLimit]);
            
            return rows.reverse();
        } catch (error) {
            console.error('Error in getRecentMessages:', error);
            return []; // Return empty array instead of throwing
        }
    }

    // Search messages in a room - ALSO FIXED
    static async searchMessages(roomName, searchTerm, limit = 20) {
        try {
            await this.ensureRoom(roomName);
            
            // Sanitize limit parameter
            const messageLimit = Math.max(1, Math.min(parseInt(limit, 10) || 20, 500));
            
            // Use query() to avoid LIMIT parameter issues
            const [rows] = await db.query(`
                SELECT m.*, u.username,
                       CONVERT_TZ(m.timestamp, '+00:00', '+06:00') as local_time
                FROM messages m 
                JOIN users u ON m.user_id = u.id 
                JOIN rooms r ON m.room_id = r.id
                WHERE r.name = ? AND m.is_deleted = FALSE
                AND MATCH(m.message) AGAINST(? IN NATURAL LANGUAGE MODE)
                ORDER BY m.timestamp DESC 
                LIMIT ${messageLimit}
            `, [roomName, searchTerm]);
            
            return rows;
        } catch (error) {
            console.error('Error in searchMessages:', error);
            return [];
        }
    }

    // Get message count for a room
    static async getMessageCount(roomName) {
        try {
            await this.ensureRoom(roomName);
            
            const [rows] = await db.execute(`
                SELECT COUNT(*) as count
                FROM messages m 
                JOIN rooms r ON m.room_id = r.id
                WHERE r.name = ? AND m.is_deleted = FALSE
            `, [roomName]);
            
            return rows[0].count;
        } catch (error) {
            console.error('Error in getMessageCount:', error);
            return 0;
        }
    }
}

module.exports = Message;