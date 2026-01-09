export default function handler(req, res) {
  // This tells the browser to delete the "wristband" (cookie) immediately
  res.setHeader(
    'Set-Cookie', 
    'token=; HttpOnly; Secure; Path=/; Max-Age=0; SameSite=Strict'
  );
  
  return res.json({ message: 'Logged out successfully' });
}