import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import './styles/index.css';

// Apply persisted theme before first render — prevents flash of wrong theme
// Inlined here to avoid circular import and ensure it runs synchronously
try {
  const stored = localStorage.getItem('fundedwealth-terminal-theme');
  if (stored === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
  }
} catch (_) {
  // localStorage unavailable — default to dark, no action needed
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 5000,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>
);
