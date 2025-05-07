document.addEventListener('DOMContentLoaded', () => {
    const chatMessages = document.getElementById('chat-messages');
    const userInput = document.getElementById('user-input');
    const sendButton = document.getElementById('send-button');

    // Function to add a message to the chat
    function addMessage(content, isSystem = false) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${isSystem ? 'system' : ''}`;
        
        const messageP = document.createElement('p');
        messageP.textContent = content;
        
        messageDiv.appendChild(messageP);
        chatMessages.appendChild(messageDiv);
        
        // Scroll to bottom
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    // Function to handle sending messages
    async function sendMessage() {
        const message = userInput.value.trim();
        if (!message) return;

        // Add user message to chat
        addMessage(message);
        userInput.value = '';

        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ message }),
            });

            const data = await response.json();
            
            if (data.error) {
                addMessage('Sorry, there was an error processing your request. Please try again.', true);
            } else {
                addMessage(data.response, true);
            }
        } catch (error) {
            console.error('Error:', error);
            addMessage('Sorry, there was an error connecting to the server. Please try again.', true);
        }
    }

    // Event listeners
    sendButton.addEventListener('click', sendMessage);

    userInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    // Focus input on load
    userInput.focus();
}); 