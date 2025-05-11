// app/components/ChatUIEnhancements.js

// Function to add labels and indicators in Hebrew
function addLabelsAndIndicators(questionElement, question) {
    const label = document.createElement('label');
    label.textContent = question.question;
    label.style.fontWeight = 'bold';
    questionElement.prepend(label);
}

// Function to highlight the active question
function highlightActiveQuestion(questionElement) {
    questionElement.style.backgroundColor = '#f0f8ff'; // Light blue background
}

// Function to show a friendly message if user types instead of selecting
function showFriendlyMessage(inputElement) {
    const message = document.createElement('div');
    message.textContent = 'אנא בחר מהרשימה';
    message.style.color = 'red';
    inputElement.parentElement.appendChild(message);
}

// Function to apply enhancements to the chat UI
function enhanceChatUI() {
    const questions = document.querySelectorAll('.question');
    questions.forEach((questionElement, index) => {
        const question = predefinedQuestions[index]; // Assuming predefinedQuestions is available
        addLabelsAndIndicators(questionElement, question);
        highlightActiveQuestion(questionElement);

        const inputElement = questionElement.querySelector('input, select');
        if (inputElement && inputElement.tagName === 'SELECT') {
            inputElement.addEventListener('input', () => {
                if (inputElement.value === '') {
                    showFriendlyMessage(inputElement);
                }
            });
        }
    });
}

// Export the function for use in other parts of the application
export { enhanceChatUI }; 