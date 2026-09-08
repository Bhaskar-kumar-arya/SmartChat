import React, { ReactElement } from 'react'
import { render, RenderOptions } from '@testing-library/react'
import { APIProvider } from '@renderer/context/APIContext'
import { ContributionProvider } from '@renderer/context/ContributionContext'
import { PresenceProvider } from '@renderer/context/PresenceContext'
import { IAPIService } from '@renderer/services/IAPIService'
import { createMockApiService } from './mocks/mockApiService'

export interface ExtendedRenderOptions extends Omit<RenderOptions, 'queries'> {
  apiService?: IAPIService
}

export function renderWithProviders(
  ui: ReactElement,
  {
    apiService = createMockApiService(),
    ...renderOptions
  }: ExtendedRenderOptions = {}
) {
  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <APIProvider service={apiService}>
        <ContributionProvider>
          <PresenceProvider>{children}</PresenceProvider>
        </ContributionProvider>
      </APIProvider>
    )
  }

  return {
    apiService,
    ...render(ui, { wrapper: Wrapper, ...renderOptions }),
  }
}

// Re-export everything from @testing-library/react
export * from '@testing-library/react'
export { default as userEvent } from '@testing-library/user-event'
