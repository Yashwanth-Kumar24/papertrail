import { ImageResponse } from 'next/og'

export const size        = { width: 32, height: 32 }
export const contentType = 'image/png'

export default function Icon() {
  return new ImageResponse(
    (
      <div style={{
        width: 32, height: 32,
        background: '#1D6F50',
        borderRadius: 7,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <div style={{
          width: 16, height: 20,
          border: '2px solid white',
          borderRadius: 2,
          display: 'flex',
          flexDirection: 'column',
          padding: '6px 3px 3px',
          gap: 3,
          position: 'relative',
        }}>
          <div style={{ width: 8, height: 2, background: 'white', borderRadius: 1 }}/>
          <div style={{ width: 5, height: 2, background: 'white', borderRadius: 1 }}/>
        </div>
      </div>
    ),
    { ...size }
  )
}
