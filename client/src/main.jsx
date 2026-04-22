import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { AppToaster } from './components/common/AppToaster.jsx';
import { SocketProvider } from './context/SocketContext.jsx';
import './index.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <SocketProvider>
        <App />
        <AppToaster />
      </SocketProvider>
    </BrowserRouter>
  </StrictMode>,
);
