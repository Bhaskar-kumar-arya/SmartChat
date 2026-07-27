import React, { createContext, useContext, useEffect, useState } from 'react'
import { ContributionRegistrySnapshot } from '../types/contribution.types'
import { useAPI } from './APIContext'

const ContributionContext = createContext<ContributionRegistrySnapshot>({})

export interface ContributionProviderProps {
  children: React.ReactNode
}

export function ContributionProvider({ children }: ContributionProviderProps) {
  const api = useAPI()
  const [snapshot, setSnapshot] = useState<ContributionRegistrySnapshot>({})

  useEffect(() => {
    let mounted = true

    api.getContributions()
      .then((data) => {
        if (mounted && data) {
          setSnapshot(data)
        }
      })
      .catch((err: unknown) => {
        console.error('[ContributionContext] Failed to load initial snapshot:', err)
      })

    const unsubscribe = api.onContributionsUpdated((updatedSnapshot) => {
      if (mounted && updatedSnapshot) {
        setSnapshot(updatedSnapshot)
      }
    })

    return () => {
      mounted = false
      unsubscribe()
    }
  }, [api])

  return (
    <ContributionContext.Provider value={snapshot}>
      {children}
    </ContributionContext.Provider>
  )
}

export function useContributionSnapshot(): ContributionRegistrySnapshot {
  return useContext(ContributionContext)
}

export { ContributionContext }
