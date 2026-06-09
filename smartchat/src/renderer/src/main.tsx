import './styles/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { APIProvider } from './context/APIContext'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <APIProvider>
      <App />
    </APIProvider>
  </StrictMode>
)

