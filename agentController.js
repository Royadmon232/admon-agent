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
        return 'שגיאה בחיפוש נתוני רכב.';
    }
}

function calculateInsuranceQuote(userData) {
    return `Calculated insurance quote for user: ${JSON.stringify(userData)}`;
}

function explainCoverage(type) {
    return `Explanation of coverage for type: ${type}`;
}

// Helper function to extract license plate from text
function extractLicensePlate(text) {
    // Match patterns like: 123-456, 123456, 12-345-67
    const platePattern = /\d{2,3}[-]?\d{2,3}[-]?\d{2}/;
    const match = text.match(platePattern);
    return match ? match[0].replace(/-/g, '') : null;
}

// Helper function to check if message is about vehicle details
function isVehicleQuery(message) {
    const vehicleKeywords = [
        'לוחית רישוי',
        'תגיד לי מה הרכב',
        'מה הרכב',
        'פרטי רכב',
        'מידע על הרכב',
        'מה יש על הרכב',
        'מה הרכב הזה',
        'מה המכונית',
        'מה האוטו'
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
            return 'אשמח לעזור לך עם פרטי הרכב. אנא ציין את מספר הרישוי של הרכב.';
        }
    } else if (message.includes('quote')) {
        return calculateInsuranceQuote({ age: 30, car: 'Toyota' }); // Example user data
    } else if (message.includes('coverage')) {
        return explainCoverage('basic'); // Example coverage type
    } else {
        return null; // Return null to indicate this should be handled by OpenAI
    }
} 