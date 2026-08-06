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
    const { title, body, url, excludeEndpoint } = await req.json()

    const { data: allSubs } = await supabase.from('push_subscriptions').select('*')
    // Skip the device that triggered this — without an auth/identity system,
    // the caller's own current push subscription endpoint (looked up client-
    // side, see lib/push.ts) is the only reliable way to know "don't notify
    // myself about my own action." Previously every subscribed device,
    // including the sender's own, got notified on every save.
    const subs = excludeEndpoint
      ? (allSubs ?? []).filter(s => s.endpoint !== excludeEndpoint)
      : (allSubs ?? [])
    if (!subs.length) return NextResponse.json({ ok: true, sent: 0 })

    const payload = JSON.stringify({ title, body, url: url ?? '/receipts' })

    const results = await Promise.allSettled(
      subs.map(sub =>
        webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { auth: sub.auth, p256dh: sub.p256dh } },
          payload,
          {
            // 'normal' (not 'high') — a new receipt is informational, not
            // urgent; 'high' triggers a heads-up banner + sound on Android,
            // more disruptive than routine household activity warrants.
            urgency: 'normal',
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
