import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { AppToaster } from './components/common/AppToaster.jsx';
import { SocketProvider } from './context/SocketContext.jsx';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <SocketProvider>
          <App />
          <AppToaster />
        </SocketProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
