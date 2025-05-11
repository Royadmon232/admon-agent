import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Validate required environment variables
const requiredEnvVars = [
    'PORT',
    'NODE_ENV',
    'DB_PATH',
    'SESSION_SECRET'
];

const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);
if (missingEnvVars.length > 0) {
    throw new Error(`Missing required environment variables: ${missingEnvVars.join(', ')}`);
}

// Configuration object
const config = {
    // Server
    port: parseInt(process.env.PORT, 10) || 3000,
    env: process.env.NODE_ENV || 'development',
    isProduction: process.env.NODE_ENV === 'production',

    // Database
    db: {
        path: process.env.DB_PATH || path.join(__dirname, 'data', 'insuranceQuotes.sqlite'),
        options: {
            verbose: process.env.NODE_ENV !== 'production'
        }
    },

    // Security
    security: {
        sessionSecret: process.env.SESSION_SECRET,
        apiKey: process.env.API_KEY,
        rateLimit: {
            windowMs: parseInt(process.env.RATE_LIMIT_WINDOW, 10) * 60 * 1000 || 15 * 60 * 1000,
            max: parseInt(process.env.RATE_LIMIT_MAX, 10) || 100
        }
    },

    // Email
    email: {
        service: process.env.EMAIL_SERVICE || 'gmail',
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    },

    // Logging
    logging: {
        level: process.env.LOG_LEVEL || 'info',
        file: process.env.LOG_FILE || path.join(__dirname, 'logs', 'app.log')
    },

    // Cache
    cache: {
        ttl: parseInt(process.env.CACHE_TTL, 10) || 3600,
        dir: process.env.CACHE_DIR || path.join(__dirname, 'cache')
    },

    // Paths
    paths: {
        root: __dirname,
        public: path.join(__dirname, 'public'),
        uploads: path.join(__dirname, 'public', 'uploads'),
        logs: path.join(__dirname, 'logs'),
        cache: path.join(__dirname, 'cache')
    }
};

// Create required directories
import fs from 'fs';
Object.values(config.paths).forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

export default config; 