import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const { image } = await req.json()
    if (!image) return NextResponse.json({ error: 'No image' }, { status: 400 })

    const apiKey = process.env.GOOGLE_VISION_API_KEY
    if (!apiKey) return NextResponse.json({ error: 'Google Vision key not configured' }, { status: 500 })

    const response = await fetch(
      `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{
            image: { content: image },
            features: [{ type: 'TEXT_DETECTION', maxResults: 1 }],
          }]
        }),
      }
    )

    if (!response.ok) {
      const err = await response.json()
      console.error('Google Vision error:', err)
      return NextResponse.json({ error: 'Google Vision request failed' }, { status: 502 })
    }

    const data = await response.json()
    const text = data.responses?.[0]?.textAnnotations?.[0]?.description ?? ''

    if (!text) return NextResponse.json({ error: 'No text detected in image' }, { status: 422 })

    return NextResponse.json({ text })

  } catch (e: any) {
    console.error('OCR route error:', e)
    return NextResponse.json({ error: e.message ?? 'Unknown error' }, { status: 500 })
  }
}