// Simulated agent system

import axios from 'axios';

// Mock functions representing different tools
async function fetchVehicleData(licensePlate) {
    try {
        const response = await axios.get(`https://data.gov.il/api/3/action/datastore_search?resource_id=053ea72f-8bc0-4b7e-bc78-42cfc97bd0cd&q=${licensePlate}`);
        const records = response.data.result.records;
        if (records && records.length > 0) {
            const { tozeret_nm, degem_nm, shnat_yitzur, sug_delek_nm } = records[0];
            return `רכב: ${tozeret_nm} ${degem_nm}, שנת ${shnat_yitzur}, ${sug_delek_nm}`;
        } else {
            return 'לא נמצא רכב עם מספר רישוי כזה במאגר.';
        }
    } catch (error) {
        console.error('Error fetching vehicle data:', error);
        // Fallback to dummy data if API fails
        return getVehicleInfoByPlate(licensePlate);
    }
}

// Dummy vehicle data for testing
function getVehicleInfoByPlate(plateNumber) {
    // Simple hash function to get consistent dummy data for the same plate
    const hash = plateNumber.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    
    const models = [
        { make: 'טויוטה', model: 'קורולה', year: 2020, color: 'כסוף' },
        { make: 'הונדה', model: 'סיוויק', year: 2019, color: 'שחור' },
        { make: 'מזדה', model: '3', year: 2021, color: 'לבן' },
        { make: 'יונדאי', model: 'איוניק', year: 2022, color: 'כחול' },
        { make: 'סובארו', model: 'אימפרזה', year: 2018, color: 'אדום' }
    ];
    
    const selectedModel = models[hash % models.length];
    return `הרכב שלך הוא ${selectedModel.make} ${selectedModel.model}, שנת ${selectedModel.year}, צבע ${selectedModel.color}`;
}

function calculateInsuranceQuote(userData) {
    return `הצעת מחיר לביטוח: ${JSON.stringify(userData)}`;
}

function explainCoverage(type) {
    return `הסבר על כיסוי ביטוח מסוג: ${type}`;
}

// Helper function to extract license plate from text
function extractLicensePlate(text) {
    // Match patterns for Israeli license plates (7-8 digits)
    const platePattern = /\d{2,3}[-]?\d{2,3}[-]?\d{2,3}/;
    const match = text.match(platePattern);
    if (!match) return null;
    
    // Clean the plate number (remove hyphens and spaces)
    const cleanPlate = match[0].replace(/[- ]/g, '');
    
    // Validate plate length (7-8 digits)
    return (cleanPlate.length >= 7 && cleanPlate.length <= 8) ? cleanPlate : null;
}

// Helper function to check if message is about vehicle details
function isVehicleQuery(message) {
    const vehicleKeywords = [
        'לוחית רישוי',
        'מספר רכב',
        'מידע על הרכב',
        'תמצא את הרכב שלי',
        'מה הרכב לפי',
        'תגיד לי מה הרכב',
        'מה הרכב',
        'פרטי רכב',
        'מה יש על הרכב',
        'מה הרכב הזה',
        'מה המכונית',
        'מה האוטו',
        'תחפש את הרכב',
        'תמצא את המכונית',
        'מידע על המכונית'
    ];
    
    return vehicleKeywords.some(keyword => message.includes(keyword));
}

// Main function to determine which tool to use
export async function handleUserMessage(message) {
    // Check for vehicle-related queries
    if (isVehicleQuery(message)) {
        const licensePlate = extractLicensePlate(message);
        if (licensePlate) {
            return await fetchVehicleData(licensePlate);
        } else {
            return 'לא הצלחתי לזהות את מספר הרכב. נסה לכתוב רק את המספר.';
        }
    } else if (message.includes('quote')) {
        return calculateInsuranceQuote({ age: 30, car: 'Toyota' }); // Example user data
    } else if (message.includes('coverage')) {
        return explainCoverage('basic'); // Example coverage type
    } else {
        return null; // Return null to indicate this should be handled by OpenAI
    }
} 