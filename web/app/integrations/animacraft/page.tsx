import type { Metadata } from 'next'
import { Suspense } from 'react'
import { AnimacraftIntegrationEntry } from './client-entry'

export const metadata: Metadata = {
  title: 'Animacraft Integration',
  description: 'Verify and receive an already completed native Animacraft Soul.',
  robots: { index: false, follow: false },
}

export default function AnimacraftIntegrationPage() {
  return <Suspense fallback={<p role="status">Loading Animacraft handoff…</p>}><AnimacraftIntegrationEntry /></Suspense>
}
