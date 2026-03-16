import crypto from 'node:crypto'

export function generateInviteCode(byteLength = 8): string {
  return crypto.randomBytes(byteLength).toString('hex').toUpperCase()
}
