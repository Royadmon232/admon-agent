import validator from 'validator';

// Function to sanitize input
function sanitizeInput(input) {
    return validator.escape(input.trim());
}

// Middleware to validate and sanitize inputs
function validateAndSanitizeInputs(req, res, next) {
    const { name, phone, email, text } = req.body;

    // Validate inputs
    if (!name || !validator.isAlpha(name, 'he-IL')) {
        return res.status(400).json({ error: 'שם לא תקין' });
    }
    if (!phone || !validator.isMobilePhone(phone, 'he-IL')) {
        return res.status(400).json({ error: 'מספר טלפון לא תקין' });
    }
    if (!email || !validator.isEmail(email)) {
        return res.status(400).json({ error: 'כתובת אימייל לא תקינה' });
    }
    if (text && !validator.isAscii(text)) {
        return res.status(400).json({ error: 'תשובה לא תקינה' });
    }

    // Sanitize inputs
    req.body.name = sanitizeInput(name);
    req.body.phone = sanitizeInput(phone);
    req.body.email = sanitizeInput(email);
    req.body.text = text ? sanitizeInput(text) : '';

    next();
}

export { validateAndSanitizeInputs }; 