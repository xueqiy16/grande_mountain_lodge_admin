import React, { useState } from 'react';
import { supabase } from './lib/supabase';

const Login = ({ onLogin }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    
    try {
      // 1. Use Supabase Client to sign in directly
      // This automatically handles session storage in LocalStorage
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email: username, // Your 'username' field currently holds the email
        password: password,
      });

      if (authError) {
        throw authError;
      }

      // 2. Success! Pass the data.session to your existing onLogin prop
      // This ensures App.js (or your parent component) knows login was successful
      if (data.session) {
        onLogin(data.session);
      }
      
    } catch (err) {
      setError(err.message || 'Invalid email or password');
      setLoading(false);
    }
  };

  return (
    <div style={{ 
      display: 'flex', 
      justifyContent: 'center', 
      alignItems: 'center', 
      height: '100vh', 
      backgroundColor: '#f8fafc' 
    }}>
      <div style={{ 
        width: '100%', 
        maxWidth: '440px', 
        backgroundColor: 'white', 
        padding: '40px', 
        borderRadius: '24px', 
        boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.05)',
        border: '1px solid #e2e8f0'
      }}>
        <h1 style={{ 
          fontSize: '32px', 
          fontWeight: '800', 
          color: '#1e293b', 
          marginBottom: '32px',
          letterSpacing: '-0.025em'
        }}>Admin Login</h1>

        <form onSubmit={handleLogin}>
          {error && (
            <div style={{ 
              backgroundColor: '#fef2f2', 
              color: '#991b1b', 
              padding: '12px', 
              borderRadius: '8px', 
              marginBottom: '20px',
              fontSize: '14px'
            }}>
              {error}
            </div>
          )}

          <div style={{ marginBottom: '20px' }}>
            <label style={{ 
              display: 'block', 
              fontSize: '12px', 
              fontWeight: '700', 
              color: '#64748b', 
              textTransform: 'uppercase',
              marginBottom: '8px' 
            }}>Username</label>
            <input 
              type="text" 
              placeholder="Enter your username"
              value={username} 
              onChange={(e) => setUsername(e.target.value)}
              style={{ 
                width: '100%', 
                padding: '12px 16px', 
                borderRadius: '12px', 
                border: '1px solid #e2e8f0',
                fontSize: '16px',
                outline: 'none',
                boxSizing: 'border-box'
              }}
              required 
            />
          </div>

          <div style={{ marginBottom: '32px' }}>
            <label style={{ 
              display: 'block', 
              fontSize: '12px', 
              fontWeight: '700', 
              color: '#64748b', 
              textTransform: 'uppercase',
              marginBottom: '8px' 
            }}>Password</label>
            <input 
              type="password" 
              placeholder="••••••••"
              value={password} 
              onChange={(e) => setPassword(e.target.value)}
              style={{ 
                width: '100%', 
                padding: '12px 16px', 
                borderRadius: '12px', 
                border: '1px solid #e2e8f0',
                fontSize: '16px',
                outline: 'none',
                boxSizing: 'border-box'
              }}
              required 
            />
          </div>

          <button 
            type="submit" 
            disabled={loading}
            style={{ 
              width: '100%', 
              padding: '14px', 
              borderRadius: '12px', 
              backgroundColor: '#d97706', 
              color: 'white', 
              border: 'none', 
              fontSize: '16px', 
              fontWeight: '600', 
              cursor: 'pointer',
              transition: 'background-color 0.2s'
            }}
            onMouseOver={(e) => e.target.style.backgroundColor = '#b45309'}
            onMouseOut={(e) => e.target.style.backgroundColor = '#d97706'}
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default Login;