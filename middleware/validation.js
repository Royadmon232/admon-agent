import { body, param, query, validationResult } from 'express-validator';

// Validation middleware
export const validate = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
    next();
};

// Quote validation rules
export const quoteValidation = [
    body('age')
        .isInt({ min: 18, max: 100 })
        .withMessage('Age must be between 18 and 100'),
    
    body('gender')
        .isIn(['male', 'female'])
        .withMessage('Gender must be either male or female'),
    
    body('carType')
        .isString()
        .trim()
        .notEmpty()
        .withMessage('Car type is required'),
    
    body('carYear')
        .isInt({ min: 1900, max: new Date().getFullYear() })
        .withMessage('Invalid car year'),
    
    body('carEngine')
        .isInt({ min: 50, max: 10000 })
        .withMessage('Invalid engine size'),
    
    body('insuranceType')
        .isIn(['חובה', 'צד ג', 'מקיף', 'combined'])
        .withMessage('Invalid insurance type'),
    
    body('name')
        .optional()
        .isString()
        .trim()
        .isLength({ min: 2, max: 100 })
        .withMessage('Name must be between 2 and 100 characters'),
    
    body('email')
        .optional()
        .isEmail()
        .normalizeEmail()
        .withMessage('Invalid email address'),
    
    body('phone')
        .optional()
        .matches(/^[0-9+\-\s()]{9,15}$/)
        .withMessage('Invalid phone number')
];

// Query parameter validation
export const queryValidation = [
    query('date')
        .optional()
        .isDate()
        .withMessage('Invalid date format'),
    
    query('name')
        .optional()
        .isString()
        .trim()
        .isLength({ min: 2, max: 100 })
        .withMessage('Invalid name format'),
    
    query('insuranceType')
        .optional()
        .isIn(['חובה', 'צד ג', 'מקיף', 'combined'])
        .withMessage('Invalid insurance type')
];

// Parameter validation
export const paramValidation = [
    param('id')
        .isInt()
        .withMessage('Invalid ID format')
];

// Sanitize input
export const sanitizeInput = (req, res, next) => {
    // Sanitize query parameters
    if (req.query) {
        Object.keys(req.query).forEach(key => {
            if (typeof req.query[key] === 'string') {
                req.query[key] = req.query[key].trim();
            }
        });
    }

    // Sanitize body parameters
    if (req.body) {
        Object.keys(req.body).forEach(key => {
            if (typeof req.body[key] === 'string') {
                req.body[key] = req.body[key].trim();
            }
        });
    }

    next();
};

// Error handling middleware
export const errorHandler = (err, req, res, next) => {
    console.error(err.stack);

    // Handle specific error types
    if (err.name === 'ValidationError') {
        return res.status(400).json({
            error: 'Validation Error',
            details: err.message
        });
    }

    if (err.name === 'UnauthorizedError') {
        return res.status(401).json({
            error: 'Unauthorized',
            details: 'Invalid or missing authentication'
        });
    }

    // Default error response
    res.status(500).json({
        error: 'Internal Server Error',
        details: process.env.NODE_ENV === 'production' 
            ? 'An unexpected error occurred' 
            : err.message
    });
}; 