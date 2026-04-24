'use client'

import { createContext, useCallback, useContext, useState } from 'react'
import type { KioskNft } from '@/lib/hooks/use-kiosk-nfts'

export interface WrapPublishResult {
  txDigest: string
  soulOnChainId: string
  provenanceKind: string
  originRef: string
}

interface WrapContextValue {
  // Step 1 — Select NFT
  selectedNft: KioskNft | null
  setSelectedNft: (nft: KioskNft | null) => void

  // Step 2 — Soul Layers
  charFile: File | null
  setCharFile: (file: File | null) => void
  memoryFile: File | null
  setMemoryFile: (file: File | null) => void
  skillsFile: File | null
  setSkillsFile: (file: File | null) => void
  spriteSheetFile: File | null
  setSpriteSheetFile: (file: File | null) => void
  spriteConfigFile: File | null
  setSpriteConfigFile: (file: File | null) => void
  spriteVisibility: 'public' | 'private'
  setSpriteVisibility: (visibility: 'public' | 'private') => void
  royalty: number
  setRoyalty: (v: number) => void

  // Result
  publishResult: WrapPublishResult | null
  setPublishResult: (v: WrapPublishResult | null) => void

  reset: () => void
}

const WrapContext = createContext<WrapContextValue | null>(null)

export const wrapSteps = [
  { label: 'Select NFT' },
  { label: 'Soul Layers' },
  { label: 'Preview & Sign' },
  { label: 'Done' },
]

export function WrapProvider({ children }: { children: React.ReactNode }) {
  const [selectedNft, setSelectedNft] = useState<KioskNft | null>(null)
  const [charFile, setCharFile] = useState<File | null>(null)
  const [memoryFile, setMemoryFile] = useState<File | null>(null)
  const [skillsFile, setSkillsFile] = useState<File | null>(null)
  const [spriteSheetFile, setSpriteSheetFile] = useState<File | null>(null)
  const [spriteConfigFile, setSpriteConfigFile] = useState<File | null>(null)
  const [spriteVisibility, setSpriteVisibility] = useState<'public' | 'private'>('private')
  const [royalty, setRoyalty] = useState(500)
  const [publishResult, setPublishResult] = useState<WrapPublishResult | null>(null)

  const reset = useCallback(() => {
    setSelectedNft(null)
    setCharFile(null)
    setMemoryFile(null)
    setSkillsFile(null)
    setSpriteSheetFile(null)
    setSpriteConfigFile(null)
    setSpriteVisibility('private')
    setRoyalty(500)
    setPublishResult(null)
  }, [])

  return (
    <WrapContext value={{
      selectedNft, setSelectedNft,
      charFile, setCharFile,
      memoryFile, setMemoryFile,
      skillsFile, setSkillsFile,
      spriteSheetFile, setSpriteSheetFile,
      spriteConfigFile, setSpriteConfigFile,
      spriteVisibility, setSpriteVisibility,
      royalty, setRoyalty,
      publishResult, setPublishResult,
      reset,
    }}>
      {children}
    </WrapContext>
  )
}

export function useWrap() {
  const ctx = useContext(WrapContext)
  if (!ctx) throw new Error('useWrap must be used within WrapProvider')
  return ctx
}
