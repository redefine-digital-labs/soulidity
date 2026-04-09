import { NextResponse } from 'next/server'

import { requireIdentity } from '@web/lib/auth/identity'
import { resolveDesktopDeviceAccount } from '@/lib/desktop/device-session'
import { DESKTOP_DEVICE_CODE_HEADER } from '@/lib/types/desktop'

export { DESKTOP_DEVICE_CODE_HEADER }

export type DesktopRequestTransport = 'desktop-device' | 'web'

export interface DesktopAccountAccessResult {
  accountId: string | null
  error: Response | null
  transport: DesktopRequestTransport
}

export async function requireDesktopAccountAccess(request: Request): Promise<DesktopAccountAccessResult> {
  const rawDeviceCode = request.headers.get(DESKTOP_DEVICE_CODE_HEADER)

  if (rawDeviceCode !== null) {
    const accountId = await resolveDesktopDeviceAccount(rawDeviceCode)
    if (!accountId) {
      return {
        accountId: null,
        error: NextResponse.json({ error: 'Desktop device session is invalid or expired' }, { status: 401 }),
        transport: 'desktop-device',
      }
    }

    return {
      accountId,
      error: null,
      transport: 'desktop-device',
    }
  }

  const { error, identity } = await requireIdentity()
  if (error) {
    return {
      accountId: null,
      error,
      transport: 'web',
    }
  }

  if (identity.kind !== 'human') {
    return {
      accountId: null,
      error: NextResponse.json(
        { error: 'Only human accounts can access desktop profile routes' },
        { status: 403 },
      ),
      transport: 'web',
    }
  }

  return {
    accountId: identity.accountId,
    error: null,
    transport: 'web',
  }
}
