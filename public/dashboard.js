document.addEventListener('DOMContentLoaded', async () => {
    const tableBody = document.querySelector('#sessions-table tbody');
    const exportBtn = document.getElementById('export-btn');

    // Fetch session data from the server
    async function fetchSessions() {
        try {
            const response = await fetch('/dashboard');
            const sessions = await response.json();
            populateTable(sessions);
        } catch (error) {
            console.error('Error fetching sessions:', error);
        }
    }

    // Populate the table with session data
    function populateTable(sessions) {
        tableBody.innerHTML = '';
        sessions.forEach(session => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td data-label="מספר רישוי">${session.plate_number}</td>
                <td data-label="רכב">${session.vehicle_data}</td>
                <td data-label="תאריך ושעה">${new Date(session.created_at).toLocaleString()}</td>
                <td data-label="פעולות">
                    <button onclick="deleteSession('${session.session_id}')">מחק</button>
                </td>
            `;
            tableBody.appendChild(row);
        });
    }

    // Delete a session
    async function deleteSession(sessionId) {
        try {
            await fetch(`/dashboard/${sessionId}`, { method: 'DELETE' });
            fetchSessions(); // Refresh the table
        } catch (error) {
            console.error('Error deleting session:', error);
        }
    }

    // Export session data
    exportBtn.addEventListener('click', async () => {
        try {
            const response = await fetch('/dashboard/export');
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'sessions.json';
            document.body.appendChild(a);
            a.click();
            a.remove();
        } catch (error) {
            console.error('Error exporting sessions:', error);
        }
    });

    // Initial fetch of session data
    fetchSessions();
}); 