document.addEventListener('DOMContentLoaded', () => {
    const chatMessages = document.getElementById('chat-messages');
    const userInput = document.getElementById('user-input');
    const sendButton = document.getElementById('send-button');

    // Initialize conversation log
    const conversationLog = [];
    const MESSAGE_THRESHOLD = 10;

    // Initialize EmailJS
    emailjs.init("bmjjh75db3mmHuq5H");

    // API endpoint configuration
    const API_URL = 'https://admon-agent.onrender.com/api/chat';

    // Function to send email with PDF (as base64 attachment)
    async function sendEmailWithPDF(pdfBlob) {
        try {
            // Convert blob to base64
            const toBase64 = blob => new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result.split(',')[1]);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });
            const base64PDF = await toBase64(pdfBlob);

            const response = await emailjs.send(
                "service_fidvxmm",
                "template_0svkc5i",
                {
                    to_email: "royadmon23@gmail.com",
                    subject: "Insurance Summary from Doni",
                    message: "Attached is your conversation summary with Doni, your AI insurance agent.",
                    // EmailJS expects an array of attachments
                    attachments: [
                        {
                            name: "insurance_summary.pdf",
                            data: base64PDF
                        }
                    ]
                }
            );

            console.log('Email sent successfully:', response);
        } catch (error) {
            console.error('Error sending email:', error);
        }
    }

    // Function to generate PDF
    async function generatePDF() {
        // Build the conversation HTML for PDF
        let html = `<h2 style="font-family: Arial, 'Noto Sans Hebrew', sans-serif;">Insurance Conversation Summary</h2>`;
        html += `<div>Generated on: ${new Date().toLocaleString()}</div><br>`;
        conversationLog.forEach(entry => {
            const prefix = entry.isSystem ? 'Assistant:' : 'You:';
            // Use dir="rtl" for Hebrew
            html += `<div dir="rtl" style="margin-bottom:8px;"><b>${prefix}</b> ${entry.message}</div>`;
        });
        document.getElementById('pdf-content').innerHTML = html;

        // html2pdf options
        const opt = {
            margin:       0.5,
            filename:     'insurance_summary.pdf',
            image:        { type: 'jpeg', quality: 0.98 },
            html2canvas:  { scale: 2 },
            jsPDF:        { unit: 'in', format: 'a4', orientation: 'portrait' }
        };

        // Generate PDF and get blob
        const pdfBlob = await html2pdf().from(document.getElementById('pdf-content')).set(opt).outputPdf('blob');

        // Send email with PDF
        await sendEmailWithPDF(pdfBlob);

        // Also save locally
        html2pdf().from(document.getElementById('pdf-content')).set(opt).save();
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

        // Show Doni typing feedback
        let typingDiv = document.createElement('div');
        typingDiv.className = 'message system typing-feedback';
        let typingP = document.createElement('p');
        typingP.textContent = 'דוני מקליד...';
        typingDiv.appendChild(typingP);
        chatMessages.appendChild(typingDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;

        try {
            const response = await fetch(API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ message }),
            });

            // Remove typing feedback
            if (typingDiv && typingDiv.parentNode) {
                typingDiv.parentNode.removeChild(typingDiv);
            }

            const data = await response.json();
            
            if (data.error) {
                addMessage('Sorry, there was an error processing your request. Please try again.', true);
            } else {
                addMessage(data.reply, true);
            }
        } catch (error) {
            // Remove typing feedback on error
            if (typingDiv && typingDiv.parentNode) {
                typingDiv.parentNode.removeChild(typingDiv);
            }
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