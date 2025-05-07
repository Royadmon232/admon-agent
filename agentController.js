// Simulated agent system

// Mock functions representing different tools
function fetchVehicleData(licensePlate) {
    return `Fetched data for vehicle with license plate: ${licensePlate}`;
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