import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { cleanupForgeSteelServiceWorkers } from './lib/serviceWorkerCleanup'

void cleanupForgeSteelServiceWorkers({ reload: true })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
