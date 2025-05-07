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

// Main function to determine which tool to use
function handleUserMessage(message) {
    if (message.includes('vehicle')) {
        return fetchVehicleData('123-456'); // Example license plate
    } else if (message.includes('quote')) {
        return calculateInsuranceQuote({ age: 30, car: 'Toyota' }); // Example user data
    } else if (message.includes('coverage')) {
        return explainCoverage('basic'); // Example coverage type
    } else {
        return 'Sorry, I did not understand your request.';
    }
}

// Export the main function
module.exports = { handleUserMessage }; 