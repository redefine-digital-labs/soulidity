import { getRequiredPublicEnv } from '@web/lib/souls/config'
import { suiClient } from '@web/lib/sui'

type NormalizedMoveModuleLike = {
  exposedFunctions?: Record<string, { parameters?: unknown[] | null } | null> | null
}

export type SoulPublishPackageCompatibility = {
  packageId: string
  supportsFixedPricePublish: boolean
  supportsPersonalKioskPublish: boolean
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null
}

function normalizedHex(value: string | null | undefined) {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim().toLowerCase()
  return trimmed.startsWith('0x')
    ? '0x' + trimmed.slice(2).replace(/^0+/, '')
    : trimmed.replace(/^0+/, '')
}

function getFunctionParameters(
  moduleShape: NormalizedMoveModuleLike | null | undefined,
  functionName: string,
) {
  const exposedFunctions = asRecord(moduleShape?.exposedFunctions)
  const functionShape = exposedFunctions ? asRecord(exposedFunctions[functionName]) : null
  return Array.isArray(functionShape?.parameters) ? functionShape.parameters : null
}

function matchesStructParameter(
  value: unknown,
  options: {
    kind?: 'value' | 'reference' | 'mutableReference'
    address?: string
    module: string
    name: string
  },
) {
  const wrapped = asRecord(value)
  const target = options.kind === 'reference'
    ? asRecord(wrapped?.Reference)
    : options.kind === 'mutableReference'
      ? asRecord(wrapped?.MutableReference)
      : wrapped
  const struct = asRecord(target?.Struct)

  if (!struct) {
    return false
  }

  const addressMatches = !options.address || normalizedHex(String(struct.address)) === normalizedHex(options.address)
  return addressMatches
    && struct.module === options.module
    && struct.name === options.name
}

function matchesCurrentFixedPricePublishAbi(parameters: unknown[] | null, packageId: string) {
  if (!parameters || parameters.length !== 9) {
    return false
  }

  return matchesStructParameter(parameters[0], {
    kind: 'mutableReference',
    module: 'market',
    name: 'MarketConfig',
  })
    && matchesStructParameter(parameters[1], { module: 'string', name: 'String' })
    && matchesStructParameter(parameters[2], { module: 'string', name: 'String' })
    && matchesStructParameter(parameters[3], { module: 'string', name: 'String' })
    && matchesStructParameter(parameters[4], { module: 'option', name: 'Option' })
    && matchesStructParameter(parameters[5], { module: 'blob', name: 'Blob' })
    && parameters[6] === 'U64'
    && parameters[7] === 'U16'
    && matchesStructParameter(parameters[8], {
      kind: 'mutableReference',
      address: '0x2',
      module: 'tx_context',
      name: 'TxContext',
    })
}

function matchesCurrentPersonalKioskPublishAbi(parameters: unknown[] | null, packageId: string) {
  if (!parameters || parameters.length !== 11) {
    return false
  }

  return matchesStructParameter(parameters[0], {
    kind: 'reference',
    module: 'market',
    name: 'MarketConfig',
  })
    && matchesStructParameter(parameters[1], {
      kind: 'mutableReference',
      module: 'kiosk',
      name: 'Kiosk',
    })
    && matchesStructParameter(parameters[2], {
      kind: 'reference',
      module: 'personal_kiosk',
      name: 'PersonalKioskCap',
    })
    && matchesStructParameter(parameters[3], { module: 'string', name: 'String' })
    && matchesStructParameter(parameters[4], { module: 'string', name: 'String' })
    && matchesStructParameter(parameters[5], { module: 'string', name: 'String' })
    && matchesStructParameter(parameters[6], { module: 'option', name: 'Option' })
    && matchesStructParameter(parameters[7], { module: 'blob', name: 'Blob' })
    && parameters[8] === 'U64'
    && parameters[9] === 'U16'
    && matchesStructParameter(parameters[10], {
      kind: 'mutableReference',
      address: '0x2',
      module: 'tx_context',
      name: 'TxContext',
    })
}

function matchesMintToKioskAbi(parameters: unknown[] | null) {
  if (!parameters || parameters.length !== 8) {
    return false
  }

  return matchesStructParameter(parameters[0], {
    kind: 'mutableReference',
    module: 'market',
    name: 'MarketConfig',
  })
    && matchesStructParameter(parameters[1], { module: 'string', name: 'String' })
    && matchesStructParameter(parameters[2], { module: 'string', name: 'String' })
    && matchesStructParameter(parameters[3], { module: 'string', name: 'String' })
    && matchesStructParameter(parameters[4], { module: 'option', name: 'Option' })
    && matchesStructParameter(parameters[5], { module: 'blob', name: 'Blob' })
    && parameters[6] === 'U16'
    && matchesStructParameter(parameters[7], {
      kind: 'mutableReference',
      address: '0x2',
      module: 'tx_context',
      name: 'TxContext',
    })
}

function matchesMintInPersonalKioskAbi(parameters: unknown[] | null) {
  if (!parameters || parameters.length !== 10) {
    return false
  }

  return matchesStructParameter(parameters[0], {
    kind: 'reference',
    module: 'market',
    name: 'MarketConfig',
  })
    && matchesStructParameter(parameters[1], {
      kind: 'mutableReference',
      module: 'kiosk',
      name: 'Kiosk',
    })
    && matchesStructParameter(parameters[2], {
      kind: 'reference',
      module: 'personal_kiosk',
      name: 'PersonalKioskCap',
    })
    && matchesStructParameter(parameters[3], { module: 'string', name: 'String' })
    && matchesStructParameter(parameters[4], { module: 'string', name: 'String' })
    && matchesStructParameter(parameters[5], { module: 'string', name: 'String' })
    && matchesStructParameter(parameters[6], { module: 'option', name: 'Option' })
    && matchesStructParameter(parameters[7], { module: 'blob', name: 'Blob' })
    && parameters[8] === 'U16'
    && matchesStructParameter(parameters[9], {
      kind: 'mutableReference',
      address: '0x2',
      module: 'tx_context',
      name: 'TxContext',
    })
}

export async function getSoulPublishPackageCompatibility(): Promise<SoulPublishPackageCompatibility | null> {
  const packageId = getRequiredPublicEnv('NEXT_PUBLIC_SOUL_OBJECT_PACKAGE_ID')

  try {
    const marketModule = await suiClient.getNormalizedMoveModule({
      package: packageId,
      module: 'market',
    }) as NormalizedMoveModuleLike

    return {
      packageId,
      supportsFixedPricePublish: matchesMintToKioskAbi(
        getFunctionParameters(marketModule, 'mint_to_kiosk'),
      ),
      supportsPersonalKioskPublish: matchesMintInPersonalKioskAbi(
        getFunctionParameters(marketModule, 'mint_in_personal_kiosk'),
      ),
    }
  } catch {
    return null
  }
}

export function getSoulPublishCompatibilityErrorMessage(
  packageId: string,
  reason: 'fixedPrice' | 'personalKiosk',
) {
  const detail = reason === 'personalKiosk'
    ? 'does not expose the personal-kiosk publish ABI'
    : 'does not match the current fixed-price publish ABI'

  return `Current Soul package deployment is outdated. NEXT_PUBLIC_SOUL_OBJECT_PACKAGE_ID (${packageId}) ${detail}. Redeploy soul_object and update the package ID before publishing.`
}
