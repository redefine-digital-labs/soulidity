import type { Metadata } from 'next'
import DownloadClient from './download-client'

const title = 'Download Soulidity Desktop'
const description = 'The Soulidity Desktop Companion: a floating AI partner that links your Souls, agents, and CLI hooks into one local control surface.'
export const metadata: Metadata = {
  title, description, alternates: { canonical: '/download' },
  openGraph: { title: `${title} · Soulidity`, description, url: '/download', type: 'website' },
  twitter: { card: 'summary_large_image', title: `${title} · Soulidity`, description },
}

export default function DownloadPage() { return <DownloadClient /> }
