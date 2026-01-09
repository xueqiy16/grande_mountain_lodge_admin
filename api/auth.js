import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

const JWT_SECRET = process.env.JWT_SECRET;

const USERS = [
  { username: process.env.ADMIN_USERNAME_1, hash: process.env.ADMIN_PASSWORD_HASH_1 },
  { username: process.env.ADMIN_USERNAME_2, hash: process.env.ADMIN_PASSWORD_HASH_2 }
];

export default async function handler(req, res) {
  if (req.method === 'POST') {
    const { username, password } = req.body;

    const user = USERS.find(u => u.username === username);

    if (!user) {
      return res.status(401).json({ message: 'Invalid username or password' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.hash);
    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Invalid username or password' });
    }

    const token = jwt.sign({ username: user.username }, JWT_SECRET, { expiresIn: '2h' });

    res.setHeader('Set-Cookie', `token=${token}; HttpOnly; Secure; Path=/; Max-Age=7200; SameSite=Strict`);
    return res.json({ message: 'Login successful', user: user.username });
  }

  return res.status(405).json({ message: 'Method not allowed' });
}