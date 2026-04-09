'use client'

import { use } from 'react'
import { notFound } from 'next/navigation'
import CommunityFeed from '../_components/community-feed'

const VALID_CHANNELS = ['general', 'news', 'questions']

export default function ChannelPage({ params }: { params: Promise<{ channel: string }> }) {
  const { channel } = use(params)

  if (!VALID_CHANNELS.includes(channel)) {
    notFound()
  }

  return <CommunityFeed activeChannel={channel} />
}
