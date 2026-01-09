const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const JWT_SECRET = process.env.JWT_SECRET;

// Store users in a simple array for easy checking
const USERS = [
  { username: process.env.ADMIN_USERNAME_1, hash: process.env.ADMIN_PASSWORD_HASH_1 },
  { username: process.env.ADMIN_USERNAME_2, hash: process.env.ADMIN_PASSWORD_HASH_2 }
];

export default async function handler(req, res) {
  if (req.method === 'POST') {
    const { username, password } = req.body;

    // 1. Find the user in our list
    const user = USERS.find(u => u.username === username);

    if (!user) {
      return res.status(401).json({ message: 'Invalid username or password' });
    }

    // 2. Compare the password with the shredded "confetti" (hash)
    const isPasswordValid = await bcrypt.compare(password, user.hash);
    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Invalid username or password' });
    }

    // 3. Create the wristband (token)
    const token = jwt.sign({ username: user.username }, JWT_SECRET, { expiresIn: '2h' });

    // 4. Set the "Unstealable" Cookie
    res.setHeader('Set-Cookie', `token=${token}; HttpOnly; Secure; Path=/; Max-Age=7200; SameSite=Strict`);
    return res.json({ message: 'Login successful', user: user.username });
  }

  return res.status(405).json({ message: 'Method not allowed' });
}