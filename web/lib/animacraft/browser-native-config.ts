import { readNativeReceiveTarget } from './native-receive'

/** One public release tuple shared with the SDK. No private/server-name fallback. */
export function getBrowserNativeReceiveTarget() {
  return readNativeReceiveTarget({
    NEXT_PUBLIC_SUI_NETWORK: process.env.NEXT_PUBLIC_SUI_NETWORK,
    NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID: process.env.NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID,
    NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID: process.env.NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID,
    NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON: process.env.NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON,
  })
}
