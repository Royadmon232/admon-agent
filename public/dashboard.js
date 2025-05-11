document.addEventListener('DOMContentLoaded', async () => {
    // Chart instances
    let quotesChart = null;
    let companiesChart = null;

    // DOM Elements
    const tableBody = document.getElementById('quotes-table-body');
    const dateFilter = document.getElementById('date-filter');
    const nameFilter = document.getElementById('name-filter');
    const insuranceTypeFilter = document.getElementById('insurance-type-filter');
    const totalQuotesElement = document.getElementById('total-quotes');
    const averageQuoteElement = document.getElementById('average-quote');
    const todayUsersElement = document.getElementById('today-users');

    // Initialize charts
    function initCharts() {
        // Quotes over time chart
        const quotesCtx = document.getElementById('quotes-chart').getContext('2d');
        quotesChart = new Chart(quotesCtx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: 'מספר הצעות מחיר ליום',
                    data: [],
                    borderColor: '#3498db',
                    tension: 0.1
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    title: {
                        display: true,
                        text: 'הצעות מחיר לאורך זמן'
                    }
                }
            }
        });

        // Companies comparison chart
        const companiesCtx = document.getElementById('companies-chart').getContext('2d');
        companiesChart = new Chart(companiesCtx, {
            type: 'bar',
            data: {
                labels: [],
                datasets: [{
                    label: 'ממוצע הצעות מחיר',
                    data: [],
                    backgroundColor: '#2ecc71'
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    title: {
                        display: true,
                        text: 'ממוצע הצעות מחיר לפי חברה'
                    }
                }
            }
        });
    }

    // Format currency
    function formatCurrency(amount) {
        return new Intl.NumberFormat('he-IL', {
            style: 'currency',
            currency: 'ILS'
        }).format(amount);
    }

    // Format date
    function formatDate(date) {
        return new Date(date).toLocaleDateString('he-IL');
    }

    // Update statistics
    function updateStats(quotes) {
        const total = quotes.length;
        const average = quotes.reduce((sum, quote) => sum + quote.price, 0) / total;
        const today = new Date().toLocaleDateString('he-IL');
        const todayCount = quotes.filter(quote => 
            new Date(quote.created_at).toLocaleDateString('he-IL') === today
        ).length;

        totalQuotesElement.textContent = total;
        averageQuoteElement.textContent = formatCurrency(average);
        todayUsersElement.textContent = todayCount;
    }

    // Update top companies
    function updateTopCompanies(quotes) {
        const companyCounts = {};
        quotes.forEach(quote => {
            companyCounts[quote.company] = (companyCounts[quote.company] || 0) + 1;
        });

        const sortedCompanies = Object.entries(companyCounts)
            .sort(([,a], [,b]) => b - a)
            .slice(0, 3);

        for (let i = 0; i < 3; i++) {
            const company = sortedCompanies[i] || ['-', 0];
            document.getElementById(`top-company-${i + 1}`).textContent = company[0];
            document.getElementById(`top-company-${i + 1}-count`).textContent = `${company[1]} הצעות`;
        }
    }

    // Update charts
    function updateCharts(quotes) {
        // Quotes over time
        const quotesByDate = {};
        quotes.forEach(quote => {
            const date = formatDate(quote.created_at);
            quotesByDate[date] = (quotesByDate[date] || 0) + 1;
        });

        quotesChart.data.labels = Object.keys(quotesByDate);
        quotesChart.data.datasets[0].data = Object.values(quotesByDate);
        quotesChart.update();

        // Companies comparison
        const companies = [...new Set(quotes.map(q => q.company))];
        const averages = companies.map(company => {
            const companyQuotes = quotes.filter(q => q.company === company);
            return {
                company,
                average: companyQuotes.reduce((sum, q) => sum + q.price, 0) / companyQuotes.length
            };
        });

        companiesChart.data.labels = averages.map(a => a.company);
        companiesChart.data.datasets[0].data = averages.map(a => a.average);
        companiesChart.update();
    }

    // Populate table
    function populateTable(quotes) {
        tableBody.innerHTML = '';
        quotes.forEach(quote => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${formatDate(quote.created_at)}</td>
                <td>${quote.name || '-'}</td>
                <td>${quote.insurance_type}</td>
                <td>${quote.company}</td>
                <td>${formatCurrency(quote.price)}</td>
                <td>${quote.age}</td>
                <td>${quote.gender}</td>
                <td>${quote.car_type}</td>
                <td>${quote.car_year}</td>
                <td>${quote.car_engine}</td>
            `;
            tableBody.appendChild(row);
        });
    }

    // Fetch and filter quotes
    async function fetchQuotes() {
        try {
            const response = await fetch('/api/quotes?' + new URLSearchParams({
                date: dateFilter.value,
                name: nameFilter.value,
                insuranceType: insuranceTypeFilter.value
            }));
            const quotes = await response.json();
            
            updateStats(quotes);
            updateTopCompanies(quotes);
            updateCharts(quotes);
            populateTable(quotes);
        } catch (error) {
            console.error('Error fetching quotes:', error);
        }
    }

    // Event listeners for filters
    dateFilter.addEventListener('change', fetchQuotes);
    nameFilter.addEventListener('input', fetchQuotes);
    insuranceTypeFilter.addEventListener('change', fetchQuotes);

    // Initialize
    initCharts();
    fetchQuotes();
}); 