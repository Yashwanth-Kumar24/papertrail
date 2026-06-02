import { ImageResponse } from 'next/og'

export const size        = { width: 180, height: 180 }
export const contentType = 'image/png'

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{
        width: 180, height: 180,
        background: '#1D6F50',
        borderRadius: 40,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        {/* Receipt shape */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          justifyContent: 'center',
          gap: 10,
        }}>
          <div style={{
            width: 72, height: 88,
            border: '8px solid white',
            borderRadius: 8,
            display: 'flex',
            flexDirection: 'column',
            padding: '28px 10px 12px',
            gap: 8,
            position: 'relative',
          }}>
            <div style={{ width: 38, height: 7, background: 'white', borderRadius: 4 }}/>
            <div style={{ width: 26, height: 7, background: 'white', borderRadius: 4 }}/>
          </div>
        </div>
      </div>
    ),
    { ...size }
  )
}
