import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

export default async function handler(req, res) {
  // Move variables inside to ensure they are loaded on every request
  const JWT_SECRET = process.env.JWT_SECRET;
  const USERS = [
    { username: process.env.ADMIN_USERNAME_1, hash: process.env.ADMIN_PASSWORD_HASH_1 },
    { username: process.env.ADMIN_USERNAME_2, hash: process.env.ADMIN_PASSWORD_HASH_2 }
  ];

  if (req.method === 'POST') {
    const { username, password } = req.body;

    // DEBUG LOGS: Check Vercel 'Logs' tab to see if these are 'true'
    console.log("Attempting login for:", username);
    console.log("Configured User 1:", !!process.env.ADMIN_USERNAME_1);
    console.log("Configured Hash 1:", !!process.env.ADMIN_PASSWORD_HASH_1);

    // 1. Find the user (with .trim() to prevent extra space errors)
    const user = USERS.find(u => u.username?.trim() === username?.trim());

    if (!user) {
      console.log("Error: User not found in database list");
      return res.status(401).json({ message: 'Invalid username or password' });
    }

    // 2. Compare the password
    const isPasswordValid = await bcrypt.compare(password, user.hash);
    
    if (!isPasswordValid) {
      console.log("Error: Password comparison failed for user:", username);
      return res.status(401).json({ message: 'Invalid username or password' });
    }

    // 3. Success!
    const token = jwt.sign({ username: user.username }, JWT_SECRET, { expiresIn: '2h' });
    res.setHeader('Set-Cookie', `token=${token}; HttpOnly; Secure; Path=/; Max-Age=7200; SameSite=Strict`);
    
    return res.json({ message: 'Login successful', user: user.username });
  }

  return res.status(405).json({ message: 'Method not allowed' });
}