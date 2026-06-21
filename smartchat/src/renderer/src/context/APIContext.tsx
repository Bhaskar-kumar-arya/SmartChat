import React, { createContext, useContext } from 'react'
import { IAPIService } from '../services/IAPIService'

type APIServiceType = IAPIService

const APIContext = createContext<APIServiceType | undefined>(undefined)

export function APIProvider({ service, children }: { service: IAPIService; children: React.ReactNode }) {
  return (
    <APIContext.Provider value={service}>
      {children}
    </APIContext.Provider>
  )
}

export function useAPI() {
  const context = useContext(APIContext)
  if (!context) {
    throw new Error('useAPI must be used within an APIProvider')
  }
  return context
}
