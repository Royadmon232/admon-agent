document.addEventListener('DOMContentLoaded', () => {
    const chatMessages = document.getElementById('chat-messages');
    const userInput = document.getElementById('user-input');
    const sendButton = document.getElementById('send-button');
    const themeToggle = document.getElementById('theme-toggle');

    if (!sendButton) {
        console.error("❌ sendButton not found in DOM");
        return;
    }

    sendButton.addEventListener('click', () => {
        console.log("✅ Send button clicked");
        sendMessage();
    });

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

    // Load theme from localStorage
    if (localStorage.getItem('theme') === 'dark') {
        document.body.classList.add('dark-mode');
    }

    // Toggle theme
    function toggleTheme() {
        document.body.classList.toggle('dark-mode');
        const theme = document.body.classList.contains('dark-mode') ? 'dark' : 'light';
        localStorage.setItem('theme', theme);
    }

    // Function to update session memory
    function updateSessionMemory(message) {
        const ageMatch = message.match(/גיל הנהג הוא (\d+)/);
        const genderMatch = message.match(/מין הנהג הוא (זכר|נקבה)/);
        const vehicleMatch = message.match(/מספר רכב הוא (\d{7,8})/);

        if (ageMatch) sessionMemory.driverAge = ageMatch[1];
        if (genderMatch) sessionMemory.driverGender = genderMatch[1];
        if (vehicleMatch) sessionMemory.vehicleNumber = vehicleMatch[1];

        updateProgressBar();
    }

    function updateProgressBar() {
        const totalSteps = 8;
        const completedSteps = [sessionMemory.driverAge, sessionMemory.driverGender, sessionMemory.vehicleNumber].filter(Boolean).length;
        const progressPercentage = (completedSteps / totalSteps) * 100;
        const progressBar = document.getElementById('progress-bar');
        if (progressBar) {
            progressBar.style.width = `${progressPercentage}%`;
        }
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

    // Function to generate styled PDF
    async function generateStyledPDF() {
        // Build the styled HTML for PDF
        let html = `
            <div style="font-family: Arial, 'Noto Sans Hebrew', sans-serif;">
                <img src="doni-logo.png" alt="Doni Logo" style="width: 100px;">
                <h2>סיכום הצעת מחיר לביטוח</h2>
                <p>נוצר בתאריך: ${new Date().toLocaleString()}</p>
                <p>מספר רישוי: ${sessionMemory.vehicleNumber}</p>
                <p>גיל הנהג: ${sessionMemory.driverAge}</p>
                <p>מין הנהג: ${sessionMemory.driverGender}</p>
                <p>תודה שבחרת בדוני לביטוח שלך!</p>
            </div>
        `;
        document.getElementById('pdf-content').innerHTML = html;

        // html2pdf options
        const opt = {
            margin: 0.5,
            filename: 'insurance_quote.pdf',
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: { scale: 2 },
            jsPDF: { unit: 'in', format: 'a4', orientation: 'portrait' }
        };

        // Generate PDF and get blob
        const pdfBlob = await html2pdf().from(document.getElementById('pdf-content')).set(opt).outputPdf('blob');

        // Provide options for email or download
        const userChoice = confirm('האם ברצונך לשלוח את ה-PDF למייל או להוריד אותו? לחץ על "אישור" לשליחה למייל או "ביטול" להורדה.');
        if (userChoice) {
            await sendEmailWithPDF(pdfBlob);
        } else {
            html2pdf().from(document.getElementById('pdf-content')).set(opt).save();
        }
    }

    // Clear conversation log at the start of a new session
    conversationLog.length = 0;

    // Function to create option elements
    function createOptionElements(options, questionId) {
        const container = document.createElement('div');
        container.className = 'options-container';

        // For mobile or when there are many options, use a select dropdown
        const useSelect = window.innerWidth < 768 || options.length > 4;
        
        if (useSelect) {
            const select = document.createElement('select');
            select.className = 'option-select';
            
            // Add a default option
            const defaultOption = document.createElement('option');
            defaultOption.value = '';
            defaultOption.textContent = 'בחר אפשרות...';
            select.appendChild(defaultOption);
            
            // Add the actual options
            options.forEach(option => {
                const optionElement = document.createElement('option');
                optionElement.value = option;
                optionElement.textContent = option;
                select.appendChild(optionElement);
            });
            
            select.addEventListener('change', (e) => {
                if (e.target.value) {
                    handleOptionSelection(e.target.value, questionId);
                }
            });
            
            container.appendChild(select);
        } else {
            // Use buttons for desktop when there are few options
            options.forEach(option => {
                const button = document.createElement('button');
                button.className = 'option-button';
                button.textContent = option;
                button.addEventListener('click', () => {
                    handleOptionSelection(option, questionId);
                });
                container.appendChild(button);
            });
        }
        
        return container;
    }

    // Function to handle option selection
    function handleOptionSelection(selectedOption, questionId) {
        // Remove the options container
        const optionsContainer = document.querySelector('.options-container');
        if (optionsContainer) {
            optionsContainer.remove();
        }
        
        // Add the selected option as a user message
        addMessage(selectedOption);
        
        // Update session memory
        sessionMemory[questionId] = selectedOption;
        
        // Continue with the flow
        continueFlow(questionId, selectedOption);
    }

    // Function to continue the flow after option selection
    async function continueFlow(questionId, answer) {
        try {
            const response = await fetch(API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ 
                    message: answer,
                    sessionMemory,
                    questionId
                }),
            });

            if (!response.ok) {
                throw new Error('Network response was not ok');
            }

            const data = await response.json();
            
            // Handle the response
            if (data.question && data.options) {
                // If the response includes a new question with options
                addMessage(data.question, true);
                const optionsContainer = createOptionElements(data.options, data.questionId);
                document.querySelector('.chat-messages').appendChild(optionsContainer);
            } else {
                // Regular response
                addMessage(data.response, true);
            }
        } catch (error) {
            console.error('Error:', error);
            addMessage('מצטער, אירעה שגיאה. אנא נסה שוב.', true);
        }
    }

    // Update the addMessage function to handle option-based questions
    function addMessage(content, isSystem = false) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${isSystem ? 'system' : 'user'}`;

        if (isSystem && content && content.includes('ההצעה המשתלמת ביותר')) {
            const cardDiv = document.createElement('div');
            cardDiv.className = 'insurance-card';
            const match = content.match(/חברת (\S+) – (\d+,?\d*) ₪/);
            if (match) {
                const [company, price] = match.slice(1);
                cardDiv.innerHTML = `<strong>${company}</strong><br><span class='highlight'>${price} ₪</span><br>${content}`;
                messageDiv.appendChild(cardDiv);
            }
        } else {
            if (isSystem) {
                const avatar = document.createElement('img');
                avatar.src = 'doni-logo.png';
                avatar.alt = 'Doni Avatar';
                avatar.className = 'system-avatar';
                messageDiv.appendChild(avatar);
            }
            const messageP = document.createElement('p');
            messageP.textContent = content;
            messageDiv.appendChild(messageP);
        }

        chatMessages.appendChild(messageDiv);

        // Log the message
        conversationLog.push({
            message: content,
            isSystem: isSystem,
            timestamp: new Date().toISOString()
        });

        // Count only non-system messages
        const userMessagesCount = conversationLog.filter(msg => !msg.isSystem).length;

        // Check if we should generate PDF
        if (userMessagesCount >= MESSAGE_THRESHOLD || 
            (content.toLowerCase() === 'סיכום' && !isSystem)) {
            generateStyledPDF();
        }

        // Scroll to bottom
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    // Update the sendMessage function to handle structured response from /chat
    async function sendMessage() {
        const message = userInput.value.trim();
        if (!message) return;

        // Update session memory
        updateSessionMemory(message);

        // Add user message to chat
        addMessage(message);
        userInput.value = '';

        // Ensure chat scrolls to the bottom
        chatMessages.scrollTop = chatMessages.scrollHeight;

        // Determine if typing feedback is needed
        let showTypingFeedback = true;
        if (sessionMemory.currentQuestion && sessionMemory.currentQuestion.type === 'options') {
            showTypingFeedback = false;
        }

        // Show Doni typing feedback if needed
        let typingDiv;
        if (showTypingFeedback) {
            typingDiv = document.createElement('div');
            typingDiv.className = 'message system typing-feedback';
            let typingP = document.createElement('p');
            typingP.textContent = 'דוני מקליד...';
            typingDiv.appendChild(typingP);
            chatMessages.appendChild(typingDiv);
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }

        try {
            const response = await fetch(API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ message, sessionMemory }),
            });

            if (!response.ok) {
                throw new Error('Network response was not ok');
            }

            const data = await response.json();

            // Remove typing feedback if it was shown
            if (showTypingFeedback && typingDiv) {
                typingDiv.remove();
            }

            // Handle the structured response
            if (data.type === 'flow') {
                // Extract and use the question, id, and inputType
                addMessage(data.question, true);
                const optionsContainer = createOptionElements(data.options, data.id);
                document.querySelector('.chat-messages').appendChild(optionsContainer);
            } else if (data.type === 'openai') {
                // Handle as a regular AI reply
                addMessage(data.reply, true);
            }
        } catch (error) {
            console.error('Error:', error);
            if (showTypingFeedback && typingDiv) {
                typingDiv.remove();
            }
            addMessage('מצטער, אירעה שגיאה. אנא נסה שוב.', true);
        }
    }

    // Event listeners
    userInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    // Focus input on load
    userInput.focus();

    // Hide loading screen once DOM content is loaded
    const loadingScreen = document.getElementById('loading-screen');
    if (loadingScreen) {
        loadingScreen.style.display = 'none';
    }

    if (themeToggle) {
        themeToggle.addEventListener('click', toggleTheme);
    }
}); 