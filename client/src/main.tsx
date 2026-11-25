import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.tsx';
import { SvgSprite } from './components/Icons.tsx';
import { AuthProvider } from './context/AuthContext.tsx';
import { ConfirmProvider } from './context/ConfirmContext.tsx';
import { ToastProvider } from './context/ToastContext.tsx';
import './styles/app.css';
import './styles/calendar.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <ConfirmProvider>
        <AuthProvider>
          <BrowserRouter>
            <SvgSprite />
            <App />
          </BrowserRouter>
        </AuthProvider>
      </ConfirmProvider>
    </ToastProvider>
  </StrictMode>
);
