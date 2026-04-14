import { randomUUID } from 'node:crypto'
import { importPKCS8, SignJWT } from 'jose'

import { privy } from '@web/lib/auth/privy'
import { prisma } from '@web/lib/prisma'

const DESKTOP_PRIVY_TOKEN_TTL_SECONDS = 5 * 60
const DESKTOP_PRIVY_TOKEN_ISSUER = process.env.PRIVY_CUSTOM_AUTH_ISSUER?.trim() || 'soulidity-desktop'

function getPrivyCustomAuthPrivateKeyPem() {
  const value = process.env.PRIVY_CUSTOM_AUTH_PRIVATE_KEY_PEM?.trim()
  if (!value) {
    throw new Error('PRIVY_CUSTOM_AUTH_PRIVATE_KEY_PEM is required for desktop custom auth')
  }

  return value
}

function getPrivyAppId() {
  const value = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim()
  if (!value) {
    throw new Error('NEXT_PUBLIC_PRIVY_APP_ID is required for desktop custom auth')
  }

  return value
}

async function getDesktopPrivyLinkRecord(accountId: string) {
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: {
      id: true,
      privyDid: true,
    },
  })

  if (!account) {
    throw new Error('Desktop account not found')
  }

  if (!account.privyDid) {
    throw new Error('Desktop account is not linked to a Privy user')
  }

  const linkedCustomAuthUser = await privy.getUserByCustomAuthId(accountId)

  return {
    account,
    linkedCustomAuthUser,
  }
}

export async function getDesktopPrivyCustomAuthState(accountId: string) {
  const { account, linkedCustomAuthUser } = await getDesktopPrivyLinkRecord(accountId)

  if (linkedCustomAuthUser && linkedCustomAuthUser.id !== account.privyDid) {
    return {
      ok: false as const,
      error: 'Desktop wallet auth is linked to a different Privy user. Re-link this device from the web app.',
    }
  }

  return {
    ok: true as const,
    alreadyLinked: Boolean(linkedCustomAuthUser),
  }
}

export async function createDesktopPrivyCustomAuthToken(accountId: string) {
  const nowSeconds = Math.floor(Date.now() / 1000)
  const privateKey = await importPKCS8(getPrivyCustomAuthPrivateKeyPem(), 'ES256')

  return new SignJWT({
    scope: 'desktop-create',
    sid: randomUUID(),
  })
    .setProtectedHeader({ alg: 'ES256', typ: 'JWT' })
    .setSubject(accountId)
    .setIssuer(DESKTOP_PRIVY_TOKEN_ISSUER)
    .setAudience(getPrivyAppId())
    .setIssuedAt(nowSeconds)
    .setExpirationTime(nowSeconds + DESKTOP_PRIVY_TOKEN_TTL_SECONDS)
    .sign(privateKey)
}
