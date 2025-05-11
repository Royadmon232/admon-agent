# Doni – Virtual Insurance Agent

An AI-powered insurance agent providing 24/7 support and guidance for insurance quotes and information.

## Features

- Smart intent recognition for natural language processing
- Real-time insurance quote calculations
- Interactive dashboard with statistics and charts
- Secure API endpoints
- Automated database backups
- Performance monitoring and logging
- Comprehensive error handling

## Prerequisites

- Node.js >= 18.0.0
- SQLite3
- npm or yarn

## Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/doni-insurance-agent.git
cd doni-insurance-agent
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file based on `.env.example`:
```bash
cp .env.example .env
```

4. Update the `.env` file with your configuration:
```env
PORT=3000
NODE_ENV=development
DB_PATH=./data/insuranceQuotes.sqlite
SESSION_SECRET=your-secret-key
API_KEY=your-api-key
```

## Development

Start the development server:
```bash
npm run dev
```

Run tests:
```bash
npm test
```

Lint code:
```bash
npm run lint
```

Format code:
```bash
npm run format
```

## Production

1. Build the application:
```bash
npm run build
```

2. Start the production server:
```bash
npm start
```

## Project Structure

```
doni-insurance-agent/
├── config.js           # Configuration management
├── server.js          # Main application entry
├── price.js           # Quote calculation logic
├── public/            # Static files
│   ├── css/
│   ├── js/
│   └── images/
├── middleware/        # Express middleware
│   ├── security.js    # Security features
│   └── validation.js  # Input validation
├── utils/            # Utility functions
│   ├── monitoring.js  # Logging and metrics
│   └── backup.js     # Database backup
├── tests/            # Test files
└── data/            # Database files
```

## API Endpoints

### Quotes

- `POST /api/quotes`
  - Calculate insurance quotes
  - Requires API key
  - Request body: User data (age, gender, car details, etc.)

### Dashboard

- `GET /api/dashboard/stats`
  - Get dashboard statistics
  - Requires API key

- `GET /api/dashboard/quotes`
  - Get recent quotes
  - Requires API key
  - Query parameters: date, name, insuranceType

### Health Check

- `GET /health`
  - Check application health
  - Returns system metrics

## Security Features

- Rate limiting
- API key authentication
- Input validation and sanitization
- Security headers (Helmet)
- XSS protection
- SQL injection prevention

## Monitoring

- Request timing
- Error logging
- Performance metrics
- Health checks
- Automated backups

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details. 