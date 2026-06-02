import { NextRequest, NextResponse } from 'next/server'
import webpush from 'web-push'
import { supabase } from '@/lib/supabase'

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT!,
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!,
)

export async function POST(req: NextRequest) {
  try {
    const { title, body, url } = await req.json()

    const { data: subs } = await supabase.from('push_subscriptions').select('*')
    if (!subs?.length) return NextResponse.json({ ok: true, sent: 0 })

    const payload = JSON.stringify({ title, body, url: url ?? '/receipts' })

    const results = await Promise.allSettled(
      subs.map(sub =>
        webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { auth: sub.auth, p256dh: sub.p256dh } },
          payload,
          {
            urgency: 'high', // triggers banner/heads-up on Android
            TTL:     3600,   // retry for 1 hour if device is offline
          }
        )
      )
    )

    // Remove subscriptions the push service says are gone (device uninstalled app etc.)
    const expired = results
      .map((r, i) => r.status === 'rejected' && (r.reason as any)?.statusCode === 410
        ? subs[i].endpoint : null)
      .filter(Boolean) as string[]

    if (expired.length) {
      await supabase.from('push_subscriptions').delete().in('endpoint', expired)
    }

    return NextResponse.json({ ok: true, sent: results.filter(r => r.status === 'fulfilled').length })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
