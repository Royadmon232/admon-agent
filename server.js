// server.js
// Main entry point for the Doni application
// This file sets up the Express server, applies middleware, and defines API routes.
// Ensure all environment variables are set in config.js or .env before starting the server.
// For any changes, ensure backward compatibility and test thoroughly.

import express from 'express';
import compression from 'compression';
import cors from 'cors';
import { config } from './config.js';
import { securityHeaders, rateLimiter, validateApiKey, validateRequest } from './middleware/security.js';
import { startRequestTimer, endRequestTimer, logError, healthCheck } from './utils/monitoring.js';
import { createBackup, cleanupOldBackups } from './utils/backup.js';
import logger from './utils/monitoring.js';
import { validateAndSanitizeInputs } from './middleware/inputValidation.js';

const app = express();

// Security middleware
app.use(securityHeaders);
app.use(rateLimiter);
app.use(validateRequest);

// Basic middleware
app.use(cors());
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request timing
app.use(startRequestTimer);
app.use((req, res, next) => {
    res.on('finish', () => endRequestTimer(req, res));
    next();
});

// Static files
app.use(express.static('public', {
    maxAge: '1d',
    etag: true
}));

// API routes
app.use('/api', validateApiKey, (req, res, next) => {
    // API routes will be added here
    next();
});

app.use('/api/contact-human', validateApiKey, validateAndSanitizeInputs, (req, res) => {
    // Handle contact human logic
    res.json({ message: 'Contact request received' });
});

app.use('/api/admin-login', validateApiKey, validateAndSanitizeInputs, (req, res) => {
    // Handle admin login logic
    res.json({ message: 'Admin login successful' });
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json(healthCheck());
});

// Error handling
app.use((err, req, res, next) => {
    logError(err, req);
    res.status(500).json({
        error: 'Internal Server Error',
        message: config.isProduction ? 'An unexpected error occurred' : err.message
    });
});

// Start server
const server = app.listen(config.port, () => {
    logger.info(`Server running on port ${config.port} in ${config.env} mode`);
    
    // Schedule daily backup
    setInterval(async () => {
        try {
            await createBackup();
            await cleanupOldBackups();
        } catch (error) {
            logger.error('Scheduled backup failed:', error);
        }
    }, 24 * 60 * 60 * 1000);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    logger.info('SIGTERM received. Starting graceful shutdown...');
    server.close(() => {
        logger.info('Server closed');
        process.exit(0);
    });
}); 