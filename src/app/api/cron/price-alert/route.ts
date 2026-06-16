import { NextRequest, NextResponse } from 'next/server'
import webpush from 'web-push'
import { supabase } from '@/lib/supabase'

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
    // ── Count return candidates ─────────────────────────────
    const { data: items, error: itemErr } = await supabase
      .from('item_purchase_history')
      .select('item_code, name, final_price, purchase_date')
      .order('purchase_date', { ascending: false })
      .limit(2000)

    if (itemErr) throw new Error(itemErr.message)

    // Group by item identity (item_code if present, else name)
    const groups = new Map<string, { latest: number; max: number }>()
    for (const row of items ?? []) {
      const key = row.item_code ?? row.name?.toLowerCase().trim()
      if (!key) continue
      const price = Number(row.final_price)
      if (!groups.has(key)) {
        groups.set(key, { latest: price, max: price })
      } else {
        const g = groups.get(key)!
        g.max = Math.max(g.max, price)
      }
    }

    // Candidate = item bought more than once where max > latest (price dropped — return opportunity)
    let candidateCount = 0
    for (const g of groups.values()) {
      if (g.max > g.latest) candidateCount++
    }

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
