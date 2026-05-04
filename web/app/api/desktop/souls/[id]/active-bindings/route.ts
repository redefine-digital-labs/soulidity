import { NextResponse } from 'next/server'

import { requireDesktopIdentity } from '@/lib/desktop/auth'
import { prisma } from '@/lib/prisma'
import { KIND_AUDIO, KIND_SPRITE, downloadPolicyFromU8 } from '@soulidity/sdk'

export const dynamic = 'force-dynamic'

interface ActiveBinding {
  kind: number
  kindName: string
  name: string
  versionIndex: number
  downloadPolicy: ReturnType<typeof downloadPolicyFromU8> | null
}

/**
 * Returns the current `SoulContent.active_table` projections (KIND_SPRITE +
 * KIND_AUDIO) mirrored on `SoulAsset`. CLAUDE.md declares mirror is
 * "presentation truth" for active bindings; the column is updated by
 * `ActiveBindingUpdated` events post-TX.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  const auth = await requireDesktopIdentity(request)
  if (auth.error) {
    return auth.error
  }

  const soul = await prisma.soulAsset.findUnique({
    where: { onChainId: id },
    select: {
      onChainId: true,
      activeSpriteName: true,
      activeSpriteVersionIndex: true,
      activeSpriteDownloadPolicy: true,
      activeVoiceName: true,
      activeVoiceVersionIndex: true,
      activeVoiceDownloadPolicy: true,
    },
  })

  if (!soul) {
    return NextResponse.json({ error: 'Soul not found' }, { status: 404 })
  }

  const bindings: ActiveBinding[] = []

  if (soul.activeSpriteName && soul.activeSpriteVersionIndex !== null) {
    bindings.push({
      kind: KIND_SPRITE,
      kindName: 'sprite',
      name: soul.activeSpriteName,
      versionIndex: soul.activeSpriteVersionIndex,
      downloadPolicy: parseDownloadPolicy(soul.activeSpriteDownloadPolicy),
    })
  }

  if (soul.activeVoiceName && soul.activeVoiceVersionIndex !== null) {
    bindings.push({
      kind: KIND_AUDIO,
      kindName: 'audio',
      name: soul.activeVoiceName,
      versionIndex: soul.activeVoiceVersionIndex,
      downloadPolicy: parseDownloadPolicy(soul.activeVoiceDownloadPolicy),
    })
  }

  return NextResponse.json({ activeBindings: bindings })
}

function parseDownloadPolicy(value: string | null): ActiveBinding['downloadPolicy'] {
  if (value === 'public' || value === 'owner_only' || value === 'allowlist') {
    return value
  }
  return null
}
