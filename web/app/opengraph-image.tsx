import { ImageResponse } from 'next/og'

export const runtime = 'edge'
export const alt = 'Soulidity — On-chain Soul Ownership'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '72px',
          background:
            'radial-gradient(1200px 600px at 85% 5%, rgba(168,85,247,0.45) 0%, rgba(15,17,26,0) 60%), radial-gradient(800px 500px at 5% 95%, rgba(245,158,11,0.28) 0%, rgba(15,17,26,0) 55%), #0F111A',
          color: '#F5F5F7',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 32 32"
            width="64"
            height="64"
          >
            <path
              d="M16 6 C 10.5 6, 7 10, 7 15 C 7 19, 9.5 22, 13 23"
              stroke="#A855F7"
              strokeWidth="3"
              strokeLinecap="round"
              fill="none"
            />
            <path
              d="M16 6 C 21.5 6, 25 10, 25 15 C 25 19, 22.5 22, 19 23"
              stroke="#A855F7"
              strokeWidth="3"
              strokeLinecap="round"
              fill="none"
            />
            <circle cx="16" cy="15" r="4" fill="#F59E0B" />
            <path
              d="M13 25 L 13 28 L 19 28 L 19 25"
              stroke="#A855F7"
              strokeWidth="3"
              strokeLinejoin="round"
              strokeLinecap="round"
              fill="none"
            />
          </svg>
          <span
            style={{
              fontSize: '36px',
              fontWeight: 800,
              letterSpacing: '-0.02em',
            }}
          >
            Soulidity
          </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div
            style={{
              fontSize: '78px',
              lineHeight: 1.05,
              fontWeight: 800,
              letterSpacing: '-0.03em',
              maxWidth: '900px',
            }}
          >
            On-chain Soul Ownership
          </div>
          <div
            style={{
              fontSize: '28px',
              color: '#9B8EC4',
              maxWidth: '820px',
              lineHeight: 1.4,
            }}
          >
            Mint, grant, and trade digital entities — original characters and
            AI agents — on Sui.
          </div>
        </div>
        <div
          style={{
            display: 'flex',
            gap: '12px',
            fontSize: '20px',
            color: '#9B8EC4',
          }}
        >
          <span style={{ color: '#F59E0B', fontWeight: 700 }}>Sui</span>
          <span>·</span>
          <span>Walrus</span>
          <span>·</span>
          <span>Seal</span>
          <span>·</span>
          <span>USDC</span>
        </div>
      </div>
    ),
    { ...size },
  )
}
