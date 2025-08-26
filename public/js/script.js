const chatForm = document.getElementById('chat-form');
const chatMessages = document.querySelector('.chat-messages');
const roomName = document.getElementById('room-name');
const userList = document.getElementById('users');
const roomSelect = document.getElementById('room-select');
const joinRoomBtn = document.getElementById('join-room-btn');
const logoutBtn = document.getElementById('logout-btn');
const msgInput = document.getElementById('msg');
const sendBtn = document.querySelector('.send-button');
const typingIndicator = document.getElementById('typing-indicator');

const socket = io();

let currentRoom = null;
let currentUsername = null;
let currentUserId = null;
let typingTimer;
let isTyping = false;
let isSocketConnected = false;
let isAuthenticated = false;

// Initialize user and check authentication with retry logic
async function initializeUser() {
    let retryCount = 0;
    const maxRetries = 3;
    
    while (retryCount < maxRetries) {
        try {
            console.log(`Checking authentication (attempt ${retryCount + 1})...`);
            
            const authResponse = await fetch('/api/user', {
                method: 'GET',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'no-cache'
                }
            });

            if (authResponse.ok) {
                const userData = await authResponse.json();
                if (userData.success && userData.user) {
                    currentUsername = userData.user.username;
                    currentUserId = userData.user.id;
                    isAuthenticated = true;
                    console.log('Authentication successful:', currentUsername);
                    return true;
                }
            }
            
            console.log(`Authentication failed (${authResponse.status}), attempt ${retryCount + 1}`);
            retryCount++;
            
            // Wait before retry
            if (retryCount < maxRetries) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            
        } catch (error) {
            console.error('Authentication check error:', error);
            retryCount++;
            
            if (retryCount < maxRetries) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
    }
    
    // All retries failed
    console.log('All authentication attempts failed, redirecting to login...');
    setTimeout(() => {
        window.location.href = '/';
    }, 500);
    return false;
}

// Socket connection handlers with better state management
socket.on('connect', () => {
    console.log('Socket connected:', socket.id);
    isSocketConnected = true;
    
    // Only enable UI if authenticated
    if (isAuthenticated && msgInput && sendBtn) {
        msgInput.disabled = false;
        sendBtn.disabled = false;
        msgInput.placeholder = 'Enter Message';
    }
});

socket.on('disconnect', (reason) => {
    console.log('Socket disconnected:', reason);
    isSocketConnected = false;
    
    if (msgInput && sendBtn) {
        msgInput.disabled = true;
        sendBtn.disabled = true;
        msgInput.placeholder = 'Disconnected from server...';
    }
});

socket.on('connect_error', (error) => {
    console.error('Socket connection error:', error);
    isSocketConnected = false;
});

socket.on('reconnect', (attemptNumber) => {
    console.log('Socket reconnected after', attemptNumber, 'attempts');
    isSocketConnected = true;
    
    // Re-join current room if authenticated and was in a room
    if (currentRoom && currentUsername && isAuthenticated) {
        setTimeout(() => joinRoom(currentRoom), 1000);
    }
});

// Join room functionality
if (joinRoomBtn) {
    joinRoomBtn.addEventListener('click', () => {
        const selectedRoom = roomSelect?.value;
        if (selectedRoom && isAuthenticated && currentUsername) {
            joinRoom(selectedRoom);
        } else if (!isAuthenticated) {
            showError('Please log in first');
            window.location.href = '/';
        } else {
            showError('Please select a room');
        }
    });
}

// Room selection change
if (roomSelect) {
    roomSelect.addEventListener('change', () => {
        const selectedRoom = roomSelect.value;
        if (selectedRoom && isAuthenticated && currentUsername && selectedRoom !== currentRoom) {
            joinRoom(selectedRoom);
        }
    });
}

function joinRoom(room) {
    if (!isSocketConnected) {
        showError('Not connected to server. Please wait and try again.');
        return;
    }

    if (!isAuthenticated || !currentUsername) {
        showError('Authentication required. Please log in.');
        window.location.href = '/';
        return;
    }

    if (!room || room.trim() === '') {
        showError('Please select a valid room');
        return;
    }

    currentRoom = room.trim();
    
    // Clear previous messages and show loading
    if (chatMessages) {
        chatMessages.innerHTML = '<div class="loading" style="text-align: center; padding: 20px; color: #6c757d;">Joining room...</div>';
    }
    
    // Disable form while joining
    if (msgInput && sendBtn) {
        msgInput.disabled = true;
        sendBtn.disabled = true;
        msgInput.placeholder = 'Joining room...';
    }
    
    console.log(`Joining room: ${currentRoom} as ${currentUsername}`);
    socket.emit('joinRoom', { 
        username: currentUsername, 
        room: currentRoom
    });
}

// Handle successful room join
socket.on('roomJoined', ({ room, user }) => {
    console.log('Successfully joined room:', room);
    currentRoom = room;
    
    // Enable chat form
    if (msgInput && sendBtn && isAuthenticated) {
        msgInput.disabled = false;
        sendBtn.disabled = false;
        msgInput.placeholder = 'Enter Message';
        
        // Focus with delay to ensure DOM is ready
        setTimeout(() => {
            if (msgInput && !msgInput.disabled) {
                msgInput.focus();
            }
        }, 100);
    }
    
    // Update UI elements
    if (roomName) {
        roomName.textContent = room;
    }
    
    if (roomSelect) {
        roomSelect.value = room;
    }
    
    // Remove loading message
    if (chatMessages) {
        const loadingMsg = chatMessages.querySelector('.loading');
        if (loadingMsg) {
            loadingMsg.remove();
        }
    }
});

// Handle room join errors
socket.on('roomJoinError', (error) => {
    console.error('Room join error:', error);
    showError(`Failed to join room: ${error}`);
    
    // Re-enable form if authenticated
    if (msgInput && sendBtn && isAuthenticated) {
        msgInput.disabled = false;
        sendBtn.disabled = false;
        msgInput.placeholder = 'Select a room to start chatting...';
    }
    
    // Clear loading message
    if (chatMessages) {
        const loadingMsg = chatMessages.querySelector('.loading');
        if (loadingMsg) {
            loadingMsg.remove();
        }
    }
});

// Message submit with better error handling
if (chatForm) {
    chatForm.addEventListener('submit', (e) => {
        e.preventDefault();

        if (!isSocketConnected) {
            showError('Not connected to server. Please wait and try again.');
            return;
        }

        if (!isAuthenticated) {
            showError('Please log in first');
            window.location.href = '/';
            return;
        }

        if (!currentRoom) {
            showError('Please join a room first.');
            return;
        }

        const msgElement = e.target.elements.msg;
        if (!msgElement) {
            showError('Message input not found');
            return;
        }

        let msg = msgElement.value.trim();
        
        if (!msg) {
            msgElement.focus();
            return;
        }

        // Prevent spam - disable temporarily
        msgElement.disabled = true;
        sendBtn.disabled = true;

        console.log('Sending message:', msg);
        socket.emit('chatMessage', msg);

        // Clear input and re-enable
        msgElement.value = '';
        setTimeout(() => {
            msgElement.disabled = false;
            sendBtn.disabled = false;
            msgElement.focus();
        }, 500);
        
        // Stop typing indicator
        if (isTyping) {
            socket.emit('stopTyping');
            isTyping = false;
        }
    });
}

// Typing indicators with debounce
if (msgInput) {
    msgInput.addEventListener('input', () => {
        if (!currentRoom || !isSocketConnected || !isAuthenticated) return;
        
        if (!isTyping) {
            socket.emit('typing');
            isTyping = true;
        }
        
        clearTimeout(typingTimer);
        typingTimer = setTimeout(() => {
            if (isTyping) {
                socket.emit('stopTyping');
                isTyping = false;
            }
        }, 1000);
    });
    
    msgInput.addEventListener('blur', () => {
        if (isTyping) {
            socket.emit('stopTyping');
            isTyping = false;
            clearTimeout(typingTimer);
        }
    });
}

// Enhanced logout with proper cleanup
if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
        try {
            console.log('Logging out...');
            
            // Disable the button to prevent double-click
            logoutBtn.disabled = true;
            logoutBtn.textContent = 'Logging out...';
            
            // Stop typing if active
            if (isTyping) {
                socket.emit('stopTyping');
                isTyping = false;
            }
            
            // Disconnect socket
            if (socket.connected) {
                socket.disconnect();
            }
            
            // Make logout request with timeout
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            
            const response = await fetch('/auth/logout', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                credentials: 'include',
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            // Parse response if possible
            let result = { success: true };
            try {
                result = await response.json();
            } catch (e) {
                console.log('Could not parse logout response, assuming success');
            }
            
            console.log('Logout response:', result);
            
        } catch (error) {
            console.error('Logout error:', error);
            // Continue with cleanup even if logout request fails
        } finally {
            // Clear local state regardless of server response
            currentUsername = null;
            currentUserId = null;
            currentRoom = null;
            isAuthenticated = false;
            isSocketConnected = false;
            
            // Clear any timers
            if (typingTimer) {
                clearTimeout(typingTimer);
            }
            
            console.log('Redirecting to login...');
            window.location.href = '/';
        }
    });
}

// Socket event listeners

socket.on('message', (message) => {
    console.log('Received message:', message);
    outputMessage(message);
    scrollToBottom();
});

socket.on('loadMessages', (messages) => {
    console.log('Loading previous messages:', messages.length);
    
    if (chatMessages) {
        // Clear loading message
        const loadingMsg = chatMessages.querySelector('.loading');
        if (loadingMsg) {
            loadingMsg.remove();
        }
        
        // Remove welcome message if present
        const welcomeMsg = chatMessages.querySelector('.welcome-message');
        if (welcomeMsg) {
            welcomeMsg.remove();
        }
    }
    
    messages.forEach(message => outputMessage(message));
    scrollToBottom();
});

socket.on('roomUsers', ({ room, users }) => {
    console.log('Room users updated:', users.length, 'users');
    outputRoomName(room);
    outputUsers(users);
});

socket.on('typing', ({ username, isTyping: typing }) => {
    if (typingIndicator && username !== currentUsername) {
        if (typing) {
            typingIndicator.textContent = `${username} is typing...`;
            typingIndicator.style.display = 'block';
        } else {
            typingIndicator.textContent = '';
            typingIndicator.style.display = 'none';
        }
    }
});

socket.on('error', (error) => {
    console.error('Socket error:', error);
    showError(`Connection error: ${error}`);
});

socket.on('messageError', (error) => {
    console.error('Message error:', error);
    showError(`Failed to send message: ${error}`);
    
    // Re-enable message input
    if (msgInput && sendBtn) {
        msgInput.disabled = false;
        sendBtn.disabled = false;
        msgInput.focus();
    }
});

// Helper functions

function showError(message) {
    console.error('Error:', message);
    
    // Create a temporary error display
    const errorDiv = document.createElement('div');
    errorDiv.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: #dc3545;
        color: white;
        padding: 15px;
        border-radius: 5px;
        z-index: 1000;
        max-width: 300px;
        box-shadow: 0 4px 6px rgba(0,0,0,0.1);
    `;
    errorDiv.textContent = message;
    
    document.body.appendChild(errorDiv);
    
    // Remove after 5 seconds
    setTimeout(() => {
        if (errorDiv.parentNode) {
            errorDiv.parentNode.removeChild(errorDiv);
        }
    }, 5000);
}

function scrollToBottom() {
    if (chatMessages) {
        setTimeout(() => {
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }, 50);
    }
}

function outputMessage(message) {
    // Add comprehensive debugging
    console.log('outputMessage called with:', message);
    
    if (!chatMessages) {
        console.error('chatMessages element not found! Looking for element with class "chat-messages"');
        console.log('Available elements:', document.querySelectorAll('.chat-messages'));
        return;
    }
    
    if (!message) {
        console.error('Message is null or undefined');
        return;
    }
    
    if (!message.username) {
        console.warn('Message missing username:', message);
    }
    
    if (!message.text) {
        console.warn('Message missing text:', message);
    }
    
    const div = document.createElement('div');
    div.classList.add('message');
    
    const isOwnMessage = message.username === currentUsername;
    if (isOwnMessage) {
        // Use 'own' class to match CSS (.message.own)
        div.classList.add('own');
    }
    
    // Handle system messages
    if (message.username === 'ChatBud Bot' || message.username === 'ChatBud') {
        div.classList.add('system-message');
    }
    
    // More robust time handling
    let time;
    if (message.time) {
        time = message.time;
    } else if (message.timestamp) {
        time = new Date(message.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    } else {
        time = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    }
    
    // Use fallback values for missing properties
    const username = message.username || 'Unknown User';
    const text = message.text || message.message || '[Empty message]';
    
    // Structure to match CSS expectations
    div.innerHTML = `
        <div class="meta">
            ${escapeHtml(username)} 
            <span>${time}</span>
        </div>
        <div class="text">${escapeHtml(text)}</div>
    `;
    
    console.log('Adding message to chat:', div);
    console.log('Message HTML:', div.outerHTML);
    console.log('Message classes:', div.classList.toString());
    
    // Remove welcome message if it still exists
    const welcomeMsg = chatMessages.querySelector('.welcome-message');
    if (welcomeMsg) {
        welcomeMsg.remove();
        console.log('Removed welcome message');
    }
    
    chatMessages.appendChild(div);
    
    // Verify the message was added and is visible
    console.log('Total messages in chat:', chatMessages.children.length);
    console.log('Message element:', div);
    
    // Force a repaint
    chatMessages.style.display = 'none';
    chatMessages.offsetHeight; // Trigger reflow
    chatMessages.style.display = '';
}

function outputRoomName(room) {
    if (roomName) {
        roomName.textContent = room;
    }
    
    if (roomSelect) {
        roomSelect.value = room;
    }
}

function outputUsers(users) {
    if (!userList) return;
    
    userList.innerHTML = '';
    users.forEach((user) => {
        const li = document.createElement('li');
        
        const username = user.username || user;
        const isOnline = user.isOnline !== undefined ? user.isOnline : true;
        
        const statusClass = isOnline ? 'user-online' : 'user-offline';
        const statusIcon = isOnline ? '🟢' : '🔴';
        
        li.innerHTML = `
            <span class="${statusClass}">
                ${statusIcon} ${escapeHtml(username)}
            </span>
        `;
        
        userList.appendChild(li);
    });
}

function escapeHtml(unsafe) {
    if (typeof unsafe !== 'string') {
        console.warn('escapeHtml received non-string value:', typeof unsafe, unsafe);
        return String(unsafe || '');
    }
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// Debug function to check DOM elements
function debugChatElements() {
    console.log('=== Chat Elements Debug ===');
    console.log('chatMessages:', chatMessages);
    console.log('msgInput:', msgInput);
    console.log('sendBtn:', sendBtn);
    console.log('roomName:', roomName);
    console.log('userList:', userList);
    console.log('roomSelect:', roomSelect);
    console.log('joinRoomBtn:', joinRoomBtn);
    console.log('logoutBtn:', logoutBtn);
    console.log('typingIndicator:', typingIndicator);
    console.log('================================');
}

// Initialize when page loads
window.addEventListener('load', async () => {
    console.log('Page loaded, initializing user...');
    
    // Debug DOM elements
    debugChatElements();
    
    const authSuccess = await initializeUser();
    
    if (authSuccess && isAuthenticated) {
        console.log('User authenticated successfully');
        
        // Wait for socket connection before auto-joining
        const waitForConnection = () => {
            return new Promise((resolve) => {
                if (isSocketConnected) {
                    resolve();
                } else {
                    socket.on('connect', resolve);
                    setTimeout(resolve, 3000); // Fallback timeout
                }
            });
        };
        
        await waitForConnection();
        
        // Auto-join first room if available
        if (roomSelect && roomSelect.options.length > 0) {
            const firstRoom = roomSelect.options[0].value;
            if (firstRoom) {
                setTimeout(() => joinRoom(firstRoom), 500);
            }
        }
    } else {
        console.log('Authentication failed or user not authenticated');
    }
});

// Handle page visibility change
document.addEventListener('visibilitychange', () => {
    if (!document.hidden && isAuthenticated) {
        // Page became visible, check if still authenticated
        setTimeout(() => {
            fetch('/api/user', { credentials: 'include' })
                .then(response => {
                    if (!response.ok) {
                        console.log('Session expired, redirecting to login');
                        window.location.href = '/';
                    }
                })
                .catch(error => {
                    console.error('Session check error:', error);
                });
        }, 1000);
    }
});