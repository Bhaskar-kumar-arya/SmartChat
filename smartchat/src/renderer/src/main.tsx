import './styles/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { APIProvider } from './context/APIContext'
import { api } from './services/api.service'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <APIProvider service={api}>
      <App />
    </APIProvider>
  </StrictMode>
)

