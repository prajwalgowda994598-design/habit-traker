// middleware.js — JWT auth middleware
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'habitforge-super-secret-change-in-prod';

function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer '))
    return res.status(401).json({ error: 'Missing or invalid Authorization header.' });

  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.userId;
    req.userName = payload.name;
    next();
  } catch {
    return res.status(401).json({ error: 'Token expired or invalid. Please log in again.' });
  }
}

module.exports = { authenticate };
