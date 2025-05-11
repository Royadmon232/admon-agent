import winston from 'winston';
import { config } from '../config.js';

// Configure Winston logger
const logger = winston.createLogger({
    level: config.logging.level,
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.File({ 
            filename: config.logging.file,
            maxsize: 5242880, // 5MB
            maxFiles: 5
        }),
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.simple()
            )
        })
    ]
});

// Performance monitoring
const performanceMetrics = {
    responseTimes: new Map(),
    errorCount: 0,
    requestCount: 0
};

export const startRequestTimer = (req) => {
    const start = process.hrtime();
    req._startTime = start;
};

export const endRequestTimer = (req, res) => {
    if (!req._startTime) return;
    
    const [seconds, nanoseconds] = process.hrtime(req._startTime);
    const duration = seconds * 1000 + nanoseconds / 1000000;
    
    performanceMetrics.responseTimes.set(req.path, 
        (performanceMetrics.responseTimes.get(req.path) || 0) + duration);
    performanceMetrics.requestCount++;
};

export const logError = (error, req) => {
    performanceMetrics.errorCount++;
    logger.error({
        message: error.message,
        stack: error.stack,
        path: req?.path,
        method: req?.method,
        timestamp: new Date().toISOString()
    });
};

export const getMetrics = () => {
    const avgResponseTimes = {};
    performanceMetrics.responseTimes.forEach((total, path) => {
        avgResponseTimes[path] = total / performanceMetrics.requestCount;
    });

    return {
        totalRequests: performanceMetrics.requestCount,
        errorRate: performanceMetrics.errorCount / performanceMetrics.requestCount,
        averageResponseTimes: avgResponseTimes
    };
};

// Health check
export const healthCheck = () => {
    return {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        metrics: getMetrics()
    };
};

export default logger; 