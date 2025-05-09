document.addEventListener('DOMContentLoaded', () => {
    // Check if user is logged in
    const isLoggedIn = sessionStorage.getItem('isLoggedIn');

    if (!isLoggedIn) {
        // Redirect to landing page if not logged in
        window.location.href = 'landing.html';
    }
});

function handleLogin() {
    // ... existing login logic ...
    if (result.success) {
        sessionStorage.setItem('isLoggedIn', 'true');
        window.location.href = 'dashboard.html';
    }
    // ... existing login logic ...
} 