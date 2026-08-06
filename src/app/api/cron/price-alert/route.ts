import { NextRequest, NextResponse } from 'next/server'
import webpush from 'web-push'
import { supabase } from '@/lib/supabase'
import { getReturnCandidates } from '@/lib/queries'

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT!,
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!,
)

// Called by Vercel cron every Saturday at 9am UTC.
// Guards with CRON_SECRET so it can't be triggered anonymously.
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // ── Skip if no receipts added in the last 7 days ────────
    const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()
    const { count: recentCount } = await supabase
      .from('receipts')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', since)

    if (!recentCount) {
      return NextResponse.json({ ok: true, sent: 0, reason: 'no new receipts this week' })
    }

    // ── Count return candidates ─────────────────────────────
    // Calls the exact same function the Prices page uses (getReturnCandidates
    // in lib/queries.ts, backed by the get_return_candidates() DB function)
    // so the cron can never disagree with what the app itself shows — a
    // separate row-capped implementation used to live here and could
    // silently under-count on a large receipt history.
    const candidates = await getReturnCandidates()
    const candidateCount = candidates.length

    // No candidates → skip notification (no noise)
    if (candidateCount === 0) {
      return NextResponse.json({ ok: true, sent: 0, reason: 'no candidates' })
    }

    // ── Fetch subscribers ──────────────────────────────────
    const { data: subs } = await supabase.from('push_subscriptions').select('*')
    if (!subs?.length) {
      return NextResponse.json({ ok: true, sent: 0, reason: 'no subscribers' })
    }

    const payload = JSON.stringify({
      title: 'PaperTrail · Price Alerts',
      body:  `${candidateCount} item${candidateCount !== 1 ? 's' : ''} may qualify for a return or price match — tap to review`,
      url:   '/prices?mode=returns',
    })

    const results = await Promise.allSettled(
      subs.map(sub =>
        webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { auth: sub.auth, p256dh: sub.p256dh } },
          payload,
          { urgency: 'normal', TTL: 43200 }, // 12h TTL — notification stays relevant until end of day
        )
      )
    )

    // Clean up expired subscriptions (device unregistered)
    const expired = results
      .map((r, i) => r.status === 'rejected' && (r.reason as any)?.statusCode === 410
        ? subs[i].endpoint : null)
      .filter(Boolean) as string[]

    if (expired.length) {
      await supabase.from('push_subscriptions').delete().in('endpoint', expired)
    }

    const sent = results.filter(r => r.status === 'fulfilled').length
    return NextResponse.json({ ok: true, sent, candidates: candidateCount })

  } catch (e: any) {
    console.error('price-alert cron error:', e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
