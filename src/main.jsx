import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { supabaseConfigError } from './lib/supabase'

const root = createRoot(document.getElementById('root'))

if (supabaseConfigError) {
  root.render(
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#f8fafc',
      fontFamily: 'system-ui, sans-serif',
      padding: 24
    }}>
      <div style={{
        maxWidth: 520,
        background: 'white',
        border: '1px solid #e2e8f0',
        borderRadius: 16,
        padding: 32,
        boxShadow: '0 10px 25px -5px rgba(0,0,0,0.06)'
      }}>
        <h1 style={{ margin: '0 0 12px', fontSize: 22, color: '#0f172a' }}>LodgeOS cannot start</h1>
        <p style={{ margin: '0 0 16px', color: '#64748b', lineHeight: 1.5 }}>{supabaseConfigError}</p>
        <pre style={{
          margin: 0,
          background: '#f1f5f9',
          padding: 16,
          borderRadius: 8,
          fontSize: 13,
          color: '#1e293b',
          overflowX: 'auto'
        }}>{`VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_or_publishable_key`}</pre>
        <p style={{ margin: '16px 0 0', fontSize: 13, color: '#94a3b8' }}>
          Get both values from the Supabase dashboard → Project Settings → API.
          Use the <strong>anon / public</strong> key, not the service-role secret.
        </p>
      </div>
    </div>
  )
} else {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
