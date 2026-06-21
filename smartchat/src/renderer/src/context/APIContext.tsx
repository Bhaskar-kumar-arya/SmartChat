import React, { createContext, useContext } from 'react'
import { api } from '../services/api.service'
import { IAPIService } from '../services/IAPIService'

type APIServiceType = IAPIService

const APIContext = createContext<APIServiceType | undefined>(undefined)

export function APIProvider({ children }: { children: React.ReactNode }) {
  return (
    <APIContext.Provider value={api}>
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
