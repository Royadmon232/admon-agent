import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import logger from '../utils/monitoring.js';

// Rate limiting
export const rateLimiter = rateLimit({
    windowMs: config.security.rateLimit.windowMs,
    max: config.security.rateLimit.max,
    message: 'Too many requests from this IP, please try again later.',
    handler: (req, res) => {
        logger.warn(`Rate limit exceeded for IP: ${req.ip}`);
        res.status(429).json({
            error: 'Too many requests',
            message: 'Please try again later'
        });
    }
});

// Security headers
export const securityHeaders = helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'"],
            fontSrc: ["'self'"],
            objectSrc: ["'none'"],
            mediaSrc: ["'self'"],
            frameSrc: ["'none'"]
        }
    },
    crossOriginEmbedderPolicy: true,
    crossOriginOpenerPolicy: true,
    crossOriginResourcePolicy: { policy: "same-site" },
    dnsPrefetchControl: { allow: false },
    frameguard: { action: "deny" },
    hidePoweredBy: true,
    hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true
    },
    ieNoOpen: true,
    noSniff: true,
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    xssFilter: true
});

// API key validation
export const validateApiKey = (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    
    if (!apiKey || apiKey !== config.security.apiKey) {
        logger.warn(`Invalid API key attempt from IP: ${req.ip}`);
        return res.status(401).json({
            error: 'Unauthorized',
            message: 'Invalid API key'
        });
    }
    
    next();
};

// Request validation
export const validateRequest = (req, res, next) => {
    // Check for suspicious patterns
    const suspiciousPatterns = [
        /\.\.\//,  // Directory traversal
        /<script>/i,  // XSS attempts
        /exec\(/i,  // Command injection
        /eval\(/i   // Code injection
    ];
    
    const checkValue = (value) => {
        if (typeof value === 'string') {
            return suspiciousPatterns.some(pattern => pattern.test(value));
        }
        return false;
    };
    
    // Check query parameters
    if (Object.values(req.query).some(checkValue)) {
        logger.warn(`Suspicious query parameters from IP: ${req.ip}`);
        return res.status(400).json({
            error: 'Invalid request',
            message: 'Suspicious input detected'
        });
    }
    
    // Check body parameters
    if (req.body && Object.values(req.body).some(checkValue)) {
        logger.warn(`Suspicious body parameters from IP: ${req.ip}`);
        return res.status(400).json({
            error: 'Invalid request',
            message: 'Suspicious input detected'
        });
    }
    
    next();
}; 