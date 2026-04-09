import type { Metadata } from 'next'
import { AppProviders } from '@/components/providers/app-providers'
import { AppShell } from '@/components/layout/app-shell'
import './globals.css'

export const metadata: Metadata = {
  title: 'Soulidity — On-chain Soul Ownership',
  description:
    'On-chain ownership infrastructure for digital entities — original characters, AI agents, and everything in between.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <body className="overflow-x-hidden">
        <AppProviders>
          <AppShell>
            {children}
          </AppShell>
        </AppProviders>
      </body>
    </html>
  )
}
