import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

export default async function handler(req, res) {
  // We use a fallback secret if the Vercel one is missing
  const JWT_SECRET = process.env.JWT_SECRET || 'gm_lodge_2026_fallback_secret';
  
  // Hardcoding the hashes directly so they cannot be corrupted by Vercel settings
  const USERS = [
    { 
      username: "zypeny@gmail.com", 
      hash: "$2b$10$C8Y4Kz.89V/8A2Kk.W0.OOf5Q7XJmKzV6E.GzP9R4JzV7L3W9X4S." 
    },
    { 
      username: "reception@grandemountainlodge.com", 
      hash: "$2b$10$L9W3Mv.42X/7B1Lj.V1.PPe4R8YKmLvU5F.HzQ8S3KzU6M2V8Y3R." 
    }
  ];

  if (req.method === 'POST') {
    const { username, password } = req.body;

    // Use .trim() and .toLowerCase() to ensure the login is not case-sensitive
    const user = USERS.find(u => u.username.toLowerCase() === username.toLowerCase().trim());

    if (!user) {
      return res.status(401).json({ message: 'Invalid username or password' });
    }

    // Compare the plain text password to the hardcoded hash
    const isPasswordValid = await bcrypt.compare(password, user.hash);
    
    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Invalid username or password' });
    }

    // Success: Generate the Secure Token
    const token = jwt.sign({ username: user.username }, JWT_SECRET, { expiresIn: '2h' });

    // Set the HttpOnly cookie for professional security
    res.setHeader('Set-Cookie', `token=${token}; HttpOnly; Secure; Path=/; Max-Age=7200; SameSite=Strict`);
    
    return res.json({ message: 'Login successful', user: user.username });
  }

  return res.status(405).json({ message: 'Method not allowed' });
}