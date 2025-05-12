// flow.js

// Define the types of insurance
const insuranceTypes = ['חובה', 'צד ג', 'מקיף'];

// Define questions for each insurance type
const questions = {
    'חובה': [
        { 
            id: 'carDetails', 
            question: 'מה הם פרטי הרכב שלך?',
            type: 'text'
        },
        { 
            id: 'driverAge', 
            question: 'מה הגיל שלך?',
            type: 'number'
        },
        { 
            id: 'licenseYears', 
            question: 'כמה שנים יש לך רישיון נהיגה?',
            type: 'number'
        }
    ],
    'צד ג': [
        { 
            id: 'carDetails', 
            question: 'מה הם פרטי הרכב שלך?',
            type: 'text'
        },
        { 
            id: 'driverAge', 
            question: 'מה הגיל שלך?',
            type: 'number'
        },
        { 
            id: 'licenseYears', 
            question: 'כמה שנים יש לך רישיון נהיגה?',
            type: 'number'
        },
        { 
            id: 'accidents', 
            question: 'האם היו לך תאונות בעבר?',
            type: 'options',
            options: ['כן', 'לא']
        }
    ],
    'מקיף': [
        { 
            id: 'carDetails', 
            question: 'מה הם פרטי הרכב שלך?',
            type: 'text'
        },
        { 
            id: 'driverAge', 
            question: 'מה הגיל שלך?',
            type: 'number'
        },
        { 
            id: 'licenseYears', 
            question: 'כמה שנים יש לך רישיון נהיגה?',
            type: 'number'
        },
        { 
            id: 'accidents', 
            question: 'האם היו לך תאונות בעבר?',
            type: 'options',
            options: ['כן', 'לא']
        },
        { 
            id: 'coverage', 
            question: 'איזה כיסוי ביטוחי אתה מעוניין?',
            type: 'options',
            options: ['בסיסי', 'מורחב', 'מלא']
        }
    ]
};

// Session object to store user answers
let session = {};

// Function to validate answer based on question type
function validateAnswer(question, answer) {
    switch (question.type) {
        case 'number':
            const num = Number(answer);
            return !isNaN(num) && num > 0;
        case 'options':
            return question.options.includes(answer);
        case 'text':
        default:
            return answer && answer.trim().length > 0;
    }
}

// Function to format options for display
function formatOptions(options) {
    return options.map((opt, index) => `${index + 1}. ${opt}`).join('\n');
}

// Function to start the flow
export function startFlow(type = 'חובה') {
    const validTypes = ['חובה', 'צד ג', 'מקיף'];
    // Ensure the type is valid
    if (!validTypes.includes(type)) {
        type = 'חובה';
    }
    // Check if questions exist for the type
    if (questions[type] && questions[type].length > 0) {
        return questions[type][0];
    } else {
        return {
            id: 'fallback',
            question: 'לא נמצאו שאלות עבור סוג הביטוח שבחרת.',
            options: [],
            type: 'text'
        };
    }
}

// Function to ask questions based on selected insurance type
function askQuestions(type) {
    const typeQuestions = questions[type];
    for (const q of typeQuestions) {
        // Here you would typically handle user input to collect answers
        // For demonstration, we'll assume the user answers appropriately
        let answer;
        if (q.type === 'options') {
            answer = q.options[0]; // Simulating user selecting first option
        } else if (q.type === 'number') {
            answer = '25'; // Simulating user entering a number
        } else {
            answer = 'Toyota'; // Simulating user entering text
        }
        
        if (validateAnswer(q, answer)) {
            session[q.id] = answer;
        }
    }
    
    // Pass the session data to the pricing module
    calculatePrice(session);
}

// Function to calculate price (placeholder)
function calculatePrice(data) {
    // Here you would typically call the pricing module
}

// Start the flow
startFlow(); 