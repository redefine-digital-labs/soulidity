import type {
  ParsedInnerInstruction,
  ParsedInstruction,
  ParsedTransactionWithMeta,
} from '@solana/web3.js'

import { getUsdcMint, solanaConnection } from './solana'

export interface SolanaPaymentVerification {
  success: boolean
  sender: string
  recipient: string
  amount: bigint
  mint?: string
  timestampMs?: number
}

const SOLANA_RPC_TIMEOUT_MS = 10_000

function getParsedInstructions(tx: ParsedTransactionWithMeta): ParsedInstruction[] {
  const topLevel = tx.transaction.message.instructions.filter(
    (instruction): instruction is ParsedInstruction => 'parsed' in instruction,
  )

  const inner =
    tx.meta?.innerInstructions?.flatMap((entry: ParsedInnerInstruction) =>
      entry.instructions.filter(
        (instruction): instruction is ParsedInstruction => 'parsed' in instruction,
      ),
    ) ?? []

  return [...topLevel, ...inner]
}

export async function verifySolanaTransaction(
  txSignature: string,
  expectedSender: string,
  expectedRecipient: string,
  expectedAmount: bigint,
  currency: 'SOL' | 'USDC',
): Promise<{ ok: true; verification: SolanaPaymentVerification } | { ok: false; error: string }> {
  let tx: ParsedTransactionWithMeta | null

  try {
    tx = await withTimeout(
      solanaConnection.getParsedTransaction(txSignature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      }),
      SOLANA_RPC_TIMEOUT_MS,
    )
  } catch (error) {
    if (error instanceof Error && error.message === 'SOLANA_RPC_TIMEOUT') {
      return { ok: false, error: 'Transaction lookup timed out' }
    }
    return { ok: false, error: 'Transaction not found on Solana' }
  }

  if (!tx) {
    return { ok: false, error: 'Transaction not found' }
  }

  if (tx.meta?.err) {
    return { ok: false, error: `Transaction failed: ${JSON.stringify(tx.meta.err)}` }
  }

  const parsed =
    currency === 'SOL'
      ? findMatchingSolTransfer(tx, expectedSender, expectedRecipient)
      : findMatchingSplTransfer(tx, getUsdcMint().toBase58(), expectedSender, expectedRecipient)

  if (!parsed) {
    return {
      ok: false,
      error: currency === 'SOL' ? 'No SOL transfer found in transaction' : 'No USDC transfer found in transaction',
    }
  }

  if (parsed.sender !== expectedSender) {
    return { ok: false, error: 'Sender mismatch' }
  }

  if (parsed.recipient !== expectedRecipient) {
    return { ok: false, error: 'Recipient mismatch' }
  }

  if (parsed.amount < expectedAmount) {
    return { ok: false, error: 'Amount insufficient' }
  }

  return {
    ok: true,
    verification: {
      ...parsed,
      timestampMs: tx.blockTime ? tx.blockTime * 1000 : undefined,
    },
  }
}

export function parseSolTransfer(tx: ParsedTransactionWithMeta): SolanaPaymentVerification | null {
  for (const instruction of getParsedInstructions(tx)) {
    if (instruction.program === 'system' && instruction.parsed?.type === 'transfer') {
      const info = instruction.parsed.info as {
        source?: string
        destination?: string
        lamports?: string | number
      }

      if (!info.source || !info.destination || info.lamports === undefined) {
        continue
      }

      return {
        success: true,
        sender: info.source,
        recipient: info.destination,
        amount: BigInt(info.lamports),
      }
    }
  }

  return null
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('SOLANA_RPC_TIMEOUT')), timeoutMs)
      }),
    ])
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
  }
}

export function parseSplTransfer(
  tx: ParsedTransactionWithMeta,
  expectedMint: string,
): SolanaPaymentVerification | null {
  for (const instruction of getParsedInstructions(tx)) {
    if (instruction.program !== 'spl-token') {
      continue
    }

    const type = instruction.parsed?.type
    if (type !== 'transferChecked') {
      continue
    }

    const info = instruction.parsed.info as {
      authority?: string
      destination?: string
      amount?: string | number
      mint?: string
      tokenAmount?: { amount?: string }
    }

    const mint = info.mint || ''
    if (mint !== expectedMint) {
      continue
    }

    if (!info.destination || !info.authority) {
      continue
    }

    const amount = info.amount ?? info.tokenAmount?.amount
    if (amount === undefined) {
      continue
    }

    return {
      success: true,
      sender: info.authority,
      recipient: info.destination,
      amount: BigInt(amount),
      mint,
    }
  }

  return null
}

function findMatchingSolTransfer(
  tx: ParsedTransactionWithMeta,
  expectedSender: string,
  expectedRecipient: string,
): SolanaPaymentVerification | null {
  for (const instruction of getParsedInstructions(tx)) {
    if (instruction.program !== 'system' || instruction.parsed?.type !== 'transfer') {
      continue
    }

    const info = instruction.parsed.info as {
      source?: string
      destination?: string
      lamports?: string | number
    }

    if (
      !info.source ||
      !info.destination ||
      info.lamports === undefined ||
      info.source !== expectedSender ||
      info.destination !== expectedRecipient
    ) {
      continue
    }

    return {
      success: true,
      sender: info.source,
      recipient: info.destination,
      amount: BigInt(info.lamports),
    }
  }

  return null
}

function findMatchingSplTransfer(
  tx: ParsedTransactionWithMeta,
  expectedMint: string,
  expectedSender: string,
  expectedRecipient: string,
): SolanaPaymentVerification | null {
  for (const instruction of getParsedInstructions(tx)) {
    if (instruction.program !== 'spl-token' || instruction.parsed?.type !== 'transferChecked') {
      continue
    }

    const info = instruction.parsed.info as {
      authority?: string
      destination?: string
      amount?: string | number
      mint?: string
      tokenAmount?: { amount?: string }
    }

    if (
      info.mint !== expectedMint ||
      !info.authority ||
      !info.destination ||
      info.authority !== expectedSender ||
      info.destination !== expectedRecipient
    ) {
      continue
    }

    const amount = info.amount ?? info.tokenAmount?.amount
    if (amount === undefined) {
      continue
    }

    return {
      success: true,
      sender: info.authority,
      recipient: info.destination,
      amount: BigInt(amount),
      mint: info.mint,
    }
  }

  return null
}
