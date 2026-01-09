const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

// Use environment variables for these!
const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
// This hash is for the password 'yourpassword'
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || '$2a$08$92ZkDrGVS3W5ZJi.6m6.fOewE7G8ZivS0.fR1C5ZpP9Z3Z5Z3Z5Z3'; 

export default async function handler(req, res) {
  if (req.method === 'POST') {
    const { username, password } = req.body;

    if (username !== ADMIN_USERNAME) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const isPasswordValid = await bcrypt.compare(password, ADMIN_PASSWORD_HASH);
    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '1h' });

    // Set a cookie so the browser remembers the login
    res.setHeader('Set-Cookie', `token=${token}; HttpOnly; Secure; Path=/; Max-Age=3600`);
    return res.json({ message: 'Login successful' });
  }

  return res.status(405).json({ message: 'Method not allowed' });
}
