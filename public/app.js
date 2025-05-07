document.addEventListener('DOMContentLoaded', () => {
    const chatMessages = document.getElementById('chat-messages');
    const userInput = document.getElementById('user-input');
    const sendButton = document.getElementById('send-button');

    // Initialize conversation log
    const conversationLog = [];
    const MESSAGE_THRESHOLD = 10;

    // Initialize EmailJS
    emailjs.init("bmjjh75db3mmHuq5H");

    // Function to send email with PDF
    async function sendEmailWithPDF(pdfBlob) {
        try {
            const formData = new FormData();
            formData.append('pdf', pdfBlob, 'insurance_summary.pdf');

            const response = await emailjs.send(
                "service_fidvxmm",
                "template_0svkc5i",
                {
                    to_email: "royadmon23@gmail.com",
                    subject: "Insurance Summary from Doni",
                    message: "Attached is your conversation summary with Doni, your AI insurance agent.",
                    pdf: pdfBlob
                }
            );

            console.log('Email sent successfully:', response);
        } catch (error) {
            console.error('Error sending email:', error);
        }
    }

    // Function to generate PDF
    async function generatePDF() {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        
        // Add title
        doc.setFontSize(20);
        doc.text('Insurance Conversation Summary', 20, 20);
        
        // Add timestamp
        doc.setFontSize(12);
        doc.text(`Generated on: ${new Date().toLocaleString()}`, 20, 30);
        
        // Add conversation
        doc.setFontSize(11);
        let yPosition = 45;
        
        conversationLog.forEach((entry, index) => {
            const prefix = entry.isSystem ? 'Assistant: ' : 'You: ';
            const text = `${prefix}${entry.message}`;
            
            // Split text into lines that fit the page width
            const splitText = doc.splitTextToSize(text, 170);
            
            // Check if we need a new page
            if (yPosition + splitText.length * 7 > 280) {
                doc.addPage();
                yPosition = 20;
            }
            
            doc.text(splitText, 20, yPosition);
            yPosition += splitText.length * 7 + 5;
        });
        
        // Save the PDF and get it as a blob
        const pdfBlob = doc.output('blob');
        
        // Send email with PDF
        await sendEmailWithPDF(pdfBlob);
        
        // Also save locally
        doc.save('insurance_summary.pdf');
    }

    // Function to add a message to the chat
    function addMessage(content, isSystem = false) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${isSystem ? 'system' : 'user'}`;
        
        const messageP = document.createElement('p');
        messageP.textContent = content;
        
        messageDiv.appendChild(messageP);
        chatMessages.appendChild(messageDiv);
        
        // Log the message
        conversationLog.push({
            message: content,
            isSystem: isSystem,
            timestamp: new Date().toISOString()
        });
        
        // Check if we should generate PDF
        if (conversationLog.length >= MESSAGE_THRESHOLD || 
            (content.toLowerCase() === 'סיכום' && !isSystem)) {
            generatePDF();
        }
        
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