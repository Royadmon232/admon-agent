// flow.js

// Define the types of insurance
const insuranceTypes = ['חובה', 'צד ג', 'מקיף'];

// Define questions for each insurance type
const questions = {
    'חובה': [
        { id: 'carDetails', question: 'מה הם פרטי הרכב שלך?' },
        { id: 'driverAge', question: 'מה הגיל שלך?' },
        { id: 'licenseYears', question: 'כמה שנים יש לך רישיון נהיגה?' }
    ],
    'צד ג': [
        { id: 'carDetails', question: 'מה הם פרטי הרכב שלך?' },
        { id: 'driverAge', question: 'מה הגיל שלך?' },
        { id: 'licenseYears', question: 'כמה שנים יש לך רישיון נהיגה?' },
        { id: 'accidents', question: 'האם היו לך תאונות בעבר?' }
    ],
    'מקיף': [
        { id: 'carDetails', question: 'מה הם פרטי הרכב שלך?' },
        { id: 'driverAge', question: 'מה הגיל שלך?' },
        { id: 'licenseYears', question: 'כמה שנים יש לך רישיון נהיגה?' },
        { id: 'accidents', question: 'האם היו לך תאונות בעבר?' },
        { id: 'coverage', question: 'איזה כיסוי ביטוחי אתה מעוניין?' }
    ]
};

// Session object to store user answers
let session = {};

// Function to start the flow
function startFlow() {
    console.log('ברוכים הבאים! איזה סוג ביטוח אתם מעוניינים?');
    console.log(insuranceTypes.join(', '));
    // Here you would typically handle user input to select insurance type
    // For demonstration, we'll assume the user selects 'חובה'
    const selectedType = 'חובה';
    askQuestions(selectedType);
}

// Function to ask questions based on selected insurance type
function askQuestions(type) {
    const typeQuestions = questions[type];
    typeQuestions.forEach(q => {
        console.log(q.question);
        // Here you would typically handle user input to collect answers
        // For demonstration, we'll assume the user answers 'Toyota'
        session[q.id] = 'Toyota';
    });
    console.log('תודה על המידע! נמשיך לחישוב המחיר.');
    // Pass the session data to the pricing module
    calculatePrice(session);
}

// Function to calculate price (placeholder)
function calculatePrice(data) {
    console.log('Calculating price with data:', data);
    // Here you would typically call the pricing module
}

// Start the flow
startFlow(); 