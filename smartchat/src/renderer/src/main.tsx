import './styles/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { APIProvider } from './context/APIContext'
import { ContributionProvider } from './context/ContributionContext'
import { ErrorBoundary } from './components/common/ErrorBoundary'
import { api } from './services/api.service'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <APIProvider service={api}>
        <ContributionProvider>
          <App />
        </ContributionProvider>
      </APIProvider>
    </ErrorBoundary>
  </StrictMode>
)

