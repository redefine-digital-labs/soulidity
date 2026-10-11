import { headers } from 'next/headers'

export function getRequestHeaders() {
  return headers()
}
