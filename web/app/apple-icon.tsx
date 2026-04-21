import { ImageResponse } from 'next/og'

export const runtime = 'edge'
export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background:
            'linear-gradient(135deg, #2C1462 0%, #0F111A 80%)',
        }}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 32 32"
          width="140"
          height="140"
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
      </div>
    ),
    { ...size },
  )
}
