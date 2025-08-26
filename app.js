const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const path = require('path');
require('dotenv').config();

// Import models and utilities
const { formatMessage, formatDbMessage } = require('./utils/messages');
const { userJoin, getCurrentUser, userLeave, getRoomUsers } = require('./utils/users');
const User = require('./models/User');
const Message = require('./models/Message');
const db = require('./config/database');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
   cors: {
      origin: "*",
      methods: ["GET", "POST"]
   }
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Rate limiting
const limiter = rateLimit({
   windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
   max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
   message: 'Too many requests from this IP, please try again later.'
});
app.use(limiter);

// Session configuration
app.use(session({
   secret: process.env.SESSION_SECRET || 'your-secret-key',
   resave: false,
   saveUninitialized: false,
   cookie: { 
      secure: process.env.NODE_ENV === 'production',
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
   }
}));

const botName = 'ChatBud Bot';

// Routes
app.get('/', (req, res) => {
   if (req.session.userId) {
      return res.redirect('/chat');
   }
   res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/chat', (req, res) => {
   if (!req.session.userId) {
      return res.redirect('/');
   }
   res.sendFile(path.join(__dirname, 'public', 'chat.html'));
});

// Get current user info
app.get('/api/user', (req, res) => {
   if (req.session.userId && req.session.username) {
      res.json({ 
         success: true, 
         user: {
            id: req.session.userId,
            username: req.session.username
         }
      });
   } else {
      res.status(401).json({ success: false, message: 'Not authenticated' });
   }
});

// Authentication routes
app.post('/auth/login', async (req, res) => {
   try {
      const { email, password } = req.body;
      
      if (!email || !password) {
         return res.status(400).json({ success: false, message: 'Email/username and password required' });
      }

      const user = await User.findByEmailOrUsername(email);

      if (!user) {
         return res.status(401).json({ success: false, message: 'User not found' });
      }

      const isValidPassword = await User.verifyPassword(password, user.password_hash);
      if (!isValidPassword) {
         return res.status(401).json({ success: false, message: 'Invalid password' });
      }

      req.session.userId = user.id;
      req.session.username = user.username;
      
      res.json({ 
         success: true, 
         message: 'Login successful',
         user: {
            id: user.id,
            username: user.username,
            email: user.email
         }
      });
   } catch (error) {
      console.error('Login error:', error);
      res.status(500).json({ success: false, message: 'Server error during login' });
   }
});

app.post('/auth/register', async (req, res) => {
   try {
      const { email, password } = req.body; // Match frontend form fields

      // Validation
      if (!email || !password) {
         return res.status(400).json({ success: false, message: 'Email and password are required' });
      }

      if (password.length < 6) {
         return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
      }

      // Generate username from email (before @ symbol)
      const username = email.split('@')[0];

      // Check if user already exists
      const existingUser = await User.findByEmail(email);
      if (existingUser) {
         return res.status(409).json({ success: false, message: 'Email already registered' });
      }

      const existingUsername = await User.findByUsername(username);
      if (existingUsername) {
         // If username exists, append a number
         let counter = 1;
         let newUsername = `${username}${counter}`;
         while (await User.findByUsername(newUsername)) {
            counter++;
            newUsername = `${username}${counter}`;
         }
         username = newUsername;
      }

      // Create user
      const userId = await User.create(username, email, password);
      
      req.session.userId = userId;
      req.session.username = username;

      res.json({ 
         success: true, 
         message: 'Registration successful',
         user: { id: userId, username, email }
      });
   } catch (error) {
      console.error('Registration error:', error);
      
      if (error.code === 'ER_DUP_ENTRY') {
         if (error.sqlMessage.includes('username')) {
            return res.status(409).json({ success: false, message: 'Username already taken' });
         } else if (error.sqlMessage.includes('email')) {
            return res.status(409).json({ success: false, message: 'Email already registered' });
         }
      }
      
      res.status(500).json({ success: false, message: 'Server error during registration' });
   }
});

app.post('/auth/logout', (req, res) => {
   req.session.destroy((err) => {
      if (err) {
         return res.status(500).json({ success: false, message: 'Could not log out' });
      }
      res.json({ success: true, message: 'Logged out successfully' });
   });
});

// API routes
app.get('/api/messages/:room', async (req, res) => {
   try {
      if (!req.session.userId) {
         return res.status(401).json({ success: false, message: 'Not authenticated' });
      }

      const { room } = req.params;
      const limit = parseInt(req.query.limit) || 50;
      
      const messages = await Message.getRecentMessages(room, limit);
      const formattedMessages = messages.map(formatDbMessage);
      
      res.json({ success: true, messages: formattedMessages });
   } catch (error) {
      console.error('Error fetching messages:', error);
      res.status(500).json({ success: false, message: 'Error fetching messages' });
   }
});

// Socket.IO with better error handling
io.on('connection', async (socket) => {
   console.log(`🔌 New connection: ${socket.id}`);

   socket.on('joinRoom', async ({ username, room }) => {
      try {
         console.log(`👤 User attempting to join: ${username} -> ${room}`);

         if (!username || !room) {
            socket.emit('roomJoinError', 'Username and room are required');
            return;
         }

         // Get or create user in database
         let user = await User.findByUsername(username);
         
         if (!user) {
            console.log(`Creating guest user: ${username}`);
            const tempEmail = `${username.toLowerCase().replace(/[^a-z0-9]/g, '')}@guest.temp`;
            const tempPassword = 'temporary123';
            
            try {
               const userId = await User.create(username, tempEmail, tempPassword);
               user = { id: userId, username };
               console.log(`✅ Created guest user: ${username} with ID: ${userId}`);
            } catch (createError) {
               if (createError.code === 'ER_DUP_ENTRY') {
                  user = await User.findByUsername(username);
                  console.log(`✅ Found existing user: ${username}`);
               } else {
                  console.error('Error creating user:', createError);
                  socket.emit('roomJoinError', 'Error creating user account');
                  return;
               }
            }
         }

         // Join the user to the room
         const sessionId = socket.handshake.sessionID || socket.id;
         const ipAddress = socket.handshake.address;
         const userAgent = socket.handshake.headers['user-agent'];

         const joinedUser = await userJoin(
            socket.id, 
            sessionId, 
            user.id, 
            username, 
            room, 
            ipAddress, 
            userAgent
         );

         socket.join(room);

         // Emit success event
         socket.emit('roomJoined', { 
            room: room, 
            user: { id: user.id, username: username } 
         });

         // Load recent messages
         try {
            const recentMessages = await Message.getRecentMessages(room, 20);
            const formattedMessages = recentMessages.map(formatDbMessage);
            socket.emit('loadMessages', formattedMessages);
         } catch (messageError) {
            console.error('Error loading recent messages:', messageError);
            socket.emit('loadMessages', []);
         }

         // Welcome current user
         socket.emit('message', formatMessage(botName, `Welcome to ChatBud, ${username}! 🎉`));

         // Notify others in room
         socket.broadcast
            .to(room)
            .emit('message', formatMessage(botName, `${username} has joined the chat! 👋`));

         // Save system message
         try {
            await Message.create(user.id, room, `${username} has joined the chat!`, 'system');
         } catch (systemMsgError) {
            console.error('Error saving system message:', systemMsgError);
         }

         // Send users and room info
         const roomUsers = await getRoomUsers(room);
         io.to(room).emit('roomUsers', {
            room: room,
            users: roomUsers,
         });

         console.log(`✅ ${username} successfully joined room: ${room}`);
      } catch (error) {
         console.error('Error joining room:', error);
         socket.emit('roomJoinError', 'Failed to join room. Please try again.');
      }
   });

   socket.on('chatMessage', async (msg) => {
      try {
         const user = getCurrentUser(socket.id);
         if (!user) {
            console.error('User not found for socket:', socket.id);
            socket.emit('messageError', 'User session not found');
            return;
         }

         if (!msg || typeof msg !== 'string') {
            socket.emit('messageError', 'Invalid message');
            return;
         }

         const trimmedMsg = msg.trim();
         if (!trimmedMsg) {
            socket.emit('messageError', 'Empty message');
            return;
         }

         console.log(`💬 Message from ${user.username} in ${user.room}: ${trimmedMsg}`);

         // Save message to database (don't block on this)
         Message.create(user.id, user.room, trimmedMsg)
            .catch(saveError => {
               console.error('Error saving message:', saveError);
            });

         // Broadcast message to room immediately
         const message = formatMessage(user.username, trimmedMsg);
         io.to(user.room).emit('message', message);

      } catch (error) {
         console.error('Error handling chat message:', error);
         socket.emit('messageError', 'Failed to send message');
      }
   });

   socket.on('typing', () => {
      try {
         const user = getCurrentUser(socket.id);
         if (user) {
            socket.to(user.room).emit('typing', {
               username: user.username,
               isTyping: true
            });
         }
      } catch (error) {
         console.error('Error handling typing:', error);
      }
   });

   socket.on('stopTyping', () => {
      try {
         const user = getCurrentUser(socket.id);
         if (user) {
            socket.to(user.room).emit('typing', {
               username: user.username,
               isTyping: false
            });
         }
      } catch (error) {
         console.error('Error handling stop typing:', error);
      }
   });

   socket.on('disconnect', async () => {
      try {
         const user = await userLeave(socket.id);

         if (user) {
            console.log(`👤 ${user.username} disconnected from ${user.room}`);

            // Notify others in room
            io.to(user.room).emit('message', formatMessage(botName, `${user.username} has left the chat! 👋`));

            // Save system message
            Message.create(user.id, user.room, `${user.username} has left the chat!`, 'system')
               .catch(error => console.error('Error saving disconnect message:', error));

            // Update room users list
            const roomUsers = await getRoomUsers(user.room);
            io.to(user.room).emit('roomUsers', {
               room: user.room,
               users: roomUsers,
            });
         }
      } catch (error) {
         console.error('Error handling disconnect:', error);
      }
   });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
   console.log(`🚀 ChatBud Server is running on PORT: ${PORT}`);
   console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
   console.log(`🕐 Timezone: ${process.env.DEFAULT_TIMEZONE || 'Asia/Dhaka'}`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
   console.log('🔄 SIGTERM received, shutting down gracefully...');
   server.close(() => {
      console.log('✅ Server closed');
      process.exit(0);
   });
});