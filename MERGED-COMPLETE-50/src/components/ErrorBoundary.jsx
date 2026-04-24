'use client';
import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    // Log to console for debugging
    console.error('🔴 ErrorBoundary caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: '40px 20px', textAlign: 'center', background: '#fef2f2',
          borderRadius: 16, border: '2px solid #fecaca', margin: 16,
          fontFamily: 'system-ui, sans-serif'
        }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>⚠️</div>
          <h2 style={{ fontSize: 18, fontWeight: 800, color: '#991b1b', margin: '0 0 8px' }}>
            {this.props.label || 'Something went wrong'}
          </h2>
          <p style={{ fontSize: 13, color: '#b91c1c', margin: '0 0 4px' }}>
            حدث خطأ — يرجى المحاولة مرة أخرى
          </p>
          <p style={{ fontSize: 11, color: '#dc2626', margin: '0 0 16px', maxWidth: 400, marginInline: 'auto' }}>
            {this.state.error?.message || 'Unknown error'}
          </p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            <button onClick={() => this.setState({ hasError: false, error: null, errorInfo: null })}
              style={{
                padding: '8px 20px', background: '#ef4444', color: 'white',
                border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700,
                cursor: 'pointer'
              }}>
              🔄 Retry / إعادة المحاولة
            </button>
            <button onClick={() => window.location.reload()}
              style={{
                padding: '8px 20px', background: 'white', color: '#64748b',
                border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13,
                fontWeight: 600, cursor: 'pointer'
              }}>
              Reload Page
            </button>
          </div>
          {this.props.showDetails && this.state.errorInfo && (
            <details style={{ marginTop: 16, textAlign: 'left' }}>
              <summary style={{ fontSize: 11, color: '#94a3b8', cursor: 'pointer' }}>
                Technical Details
              </summary>
              <pre style={{
                fontSize: 10, color: '#64748b', background: '#f8fafc',
                padding: 12, borderRadius: 8, overflow: 'auto', maxHeight: 200,
                marginTop: 8, textAlign: 'left', whiteSpace: 'pre-wrap'
              }}>
                {this.state.error?.toString()}
                {'\n\n'}
                {this.state.errorInfo?.componentStack}
              </pre>
            </details>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}

// Inline wrapper for individual sections
export function SafeSection({ children, label }) {
  return (
    <ErrorBoundary label={label}>
      {children}
    </ErrorBoundary>
  );
}
