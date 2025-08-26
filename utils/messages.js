function formatMessage(username, text) {
    return {
        username,
        text,
        time: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})
    };
}

function formatDbMessage(dbMessage) {
    // Debug: Log what we receive from database
    console.log('🔍 Raw DB message:', JSON.stringify(dbMessage, null, 2));
    
    // Check if dbMessage is valid
    if (!dbMessage) {
        console.error('❌ dbMessage is null or undefined');
        return null;
    }
    
    const formatted = {
        username: dbMessage.username || 'Unknown User',
        text: dbMessage.message || '',
        time: dbMessage.local_time ? 
             new Date(dbMessage.local_time).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) :
             new Date(dbMessage.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}),
        messageType: dbMessage.message_type || 'text',
        avatar: dbMessage.avatar_url
    };
    
    console.log('✅ Formatted message:', JSON.stringify(formatted, null, 2));
    return formatted;
}

module.exports = {
    formatMessage,
    formatDbMessage
};