import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

export default async function handler(req, res) {
  const JWT_SECRET = process.env.JWT_SECRET || 'gm_lodge_2026_fallback_secret';
  
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

    // --- DEBUG LOGS ---
    console.log("LOGIN ATTEMPTED FOR:", username);
    console.log("PASSWORD LENGTH RECEIVED:", password ? password.length : 0);
    // ------------------

    const user = USERS.find(u => u.username.toLowerCase() === username.toLowerCase().trim());

    if (!user) {
      console.log("USER NOT FOUND IN HARDCODED LIST");
      return res.status(401).json({ message: 'Invalid username or password' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.hash);
    
    // --- DEBUG LOGS ---
    console.log("BCRYPT COMPARISON RESULT:", isPasswordValid);
    // ------------------

    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Invalid username or password' });
    }

    const token = jwt.sign({ username: user.username }, JWT_SECRET, { expiresIn: '2h' });
    res.setHeader('Set-Cookie', `token=${token}; HttpOnly; Secure; Path=/; Max-Age=7200; SameSite=Strict`);
    
    return res.json({ message: 'Login successful', user: user.username });
  }

  return res.status(405).json({ message: 'Method not allowed' });
}