const allowUnsigned = process.env.SOULIDITY_ALLOW_UNSIGNED_MAC_BUILD === '1'

if (allowUnsigned) {
  process.exit(0)
}

const hasSigningIdentity = Boolean(process.env.CSC_LINK || process.env.CSC_NAME)
const hasAppleIdNotary = Boolean(
  process.env.APPLE_ID &&
    process.env.APPLE_APP_SPECIFIC_PASSWORD &&
    process.env.APPLE_TEAM_ID,
)
const hasAppleApiKeyNotary = Boolean(
  process.env.APPLE_API_KEY &&
    process.env.APPLE_API_KEY_ID &&
    process.env.APPLE_API_ISSUER,
)

if (!hasSigningIdentity || (!hasAppleIdNotary && !hasAppleApiKeyNotary)) {
  console.error(
    [
      'mac release requires signing and notarization configuration.',
      'Set CSC_LINK or CSC_NAME, plus Apple notarization env vars.',
      'For local unsigned builds, run package:mac:unsigned instead.',
    ].join(' '),
  )
  process.exit(1)
}
