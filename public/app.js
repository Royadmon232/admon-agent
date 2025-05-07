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

    // Initialize session memory
    const sessionMemory = {
        driverAge: null,
        driverGender: null,
        vehicleNumber: null
    };

    // Function to update session memory
    function updateSessionMemory(message) {
        const ageMatch = message.match(/גיל הנהג הוא (\d+)/);
        const genderMatch = message.match(/מין הנהג הוא (זכר|נקבה)/);
        const vehicleMatch = message.match(/מספר רכב הוא (\d{7,8})/);

        if (ageMatch) sessionMemory.driverAge = ageMatch[1];
        if (genderMatch) sessionMemory.driverGender = genderMatch[1];
        if (vehicleMatch) sessionMemory.vehicleNumber = vehicleMatch[1];
    }

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
                    attachment: [
                        {
                            name: "insurance_summary.pdf",
                            type: "application/pdf",
                            content: base64PDF,
                            encoding: "base64"
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

        // Update session memory
        updateSessionMemory(message);

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
            // First, try to handle the message with agentController
            const agentResponse = await fetch('/api/agent', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ message, sessionMemory }),
            });

            const agentData = await agentResponse.json();

            if (agentData.reply) {
                addMessage(agentData.reply, true);
            } else {
                // If agentController returns null, fallback to OpenAI
                const response = await fetch(API_URL, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ message, sessionMemory }),
                });

                const data = await response.json();

                if (data.error) {
                    console.error('OpenAI/Server error:', data.error);
                    addMessage('אירעה שגיאה בעת עיבוד הבקשה שלך. אנא נסה שוב.', true);
                } else {
                    addMessage(data.reply, true);

                    // Check if we should generate PDF
                    if (data.shouldGeneratePDF) {
                        await generatePDF();
                    }
                }
            }

            // Remove typing feedback
            if (typingDiv && typingDiv.parentNode) {
                typingDiv.parentNode.removeChild(typingDiv);
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