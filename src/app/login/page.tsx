'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!password.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        router.push('/');
        router.refresh();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? 'Incorrect password');
      }
    } catch {
      setError('Network error — is the dev server running?');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '2rem',
    }}>
      <div style={{
        width: '100%',
        maxWidth: 360,
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 12,
        padding: '2.5rem 2rem',
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
      }}>
        <div style={{ marginBottom: '2rem', textAlign: 'center' }}>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: 6 }}>
            Simprosys QA
          </div>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            Sign in to continue
          </div>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label htmlFor="password" style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoFocus
              autoComplete="current-password"
              placeholder="Enter password"
              style={{
                padding: '10px 14px',
                background: 'rgba(255,255,255,0.05)',
                border: `1px solid ${error ? 'var(--error)' : 'rgba(255,255,255,0.12)'}`,
                borderRadius: 8,
                color: 'var(--text-main)',
                fontSize: '0.9rem',
                outline: 'none',
                transition: 'border-color 0.15s',
              }}
            />
          </div>

          {error && (
            <div style={{
              fontSize: '0.8rem',
              color: 'var(--error)',
              padding: '8px 12px',
              background: 'rgba(247,85,85,0.1)',
              borderRadius: 6,
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !password.trim()}
            style={{
              padding: '10px 0',
              background: loading ? 'rgba(94,106,210,0.5)' : 'var(--accent)',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              fontSize: '0.9rem',
              fontWeight: 600,
              cursor: loading ? 'not-allowed' : 'pointer',
              transition: 'background 0.15s',
              marginTop: 4,
            }}
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <div style={{ marginTop: '1.5rem', fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'center' }}>
          Set <code style={{ fontFamily: 'var(--font-geist-mono)', fontSize: '0.72rem' }}>ADMIN_PASSWORD</code> in{' '}
          <code style={{ fontFamily: 'var(--font-geist-mono)', fontSize: '0.72rem' }}>.env.local</code> to change the password.
        </div>
      </div>
    </main>
  );
}
