import { NextRequest, NextResponse } from 'next/server'
import webpush from 'web-push'
import { supabase } from '@/lib/supabase'

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT!,
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!,
)

const THRESHOLD = 0.80

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // ── Active budgets ─────────────────────────────────────
    const { data: budgets, error: bErr } = await supabase
      .from('budgets')
      .select('category, amount')
      .eq('active', true)
      .gt('amount', 0)

    if (bErr) throw new Error(bErr.message)
    if (!budgets?.length) return NextResponse.json({ ok: true, sent: 0, reason: 'no active budgets' })

    // ── Current month spending per category ────────────────
    const now      = new Date()
    const month    = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const from     = `${month}-01`
    const lastDay  = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
    const to       = `${month}-${String(lastDay).padStart(2, '0')}`

    const { data: receipts } = await supabase
      .from('receipts')
      .select('category, total')
      .gte('purchase_date', from)
      .lte('purchase_date', to)
      .gt('total', 0)

    const spending: Record<string, number> = {}
    for (const r of receipts ?? []) {
      const cat = r.category ?? 'other'
      spending[cat] = (spending[cat] ?? 0) + Number(r.total)
    }

    // ── Find categories over threshold ─────────────────────
    const over = budgets.filter(b => {
      const spent = spending[b.category] ?? 0
      return spent / b.amount >= THRESHOLD
    })

    if (!over.length) return NextResponse.json({ ok: true, sent: 0, reason: 'no categories over threshold' })

    // ── Fetch subscribers ──────────────────────────────────
    const { data: subs } = await supabase.from('push_subscriptions').select('*')
    if (!subs?.length) return NextResponse.json({ ok: true, sent: 0, reason: 'no subscribers' })

    const lines = over.map(b => {
      const spent = spending[b.category] ?? 0
      const pct   = Math.round((spent / b.amount) * 100)
      return `${b.category} ${pct}%`
    })

    const payload = JSON.stringify({
      title: 'PaperTrail · Budget Alert',
      body:  `${over.length} categor${over.length === 1 ? 'y is' : 'ies are'} at or near limit: ${lines.join(', ')}`,
      url:   '/finance',
    })

    const results = await Promise.allSettled(
      subs.map(sub =>
        webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { auth: sub.auth, p256dh: sub.p256dh } },
          payload,
          { urgency: 'normal', TTL: 86400 },
        )
      )
    )

    // Clean up expired subscriptions
    const expired = results
      .map((r, i) => r.status === 'rejected' && (r.reason as any)?.statusCode === 410
        ? subs[i].endpoint : null)
      .filter(Boolean) as string[]
    if (expired.length) {
      await supabase.from('push_subscriptions').delete().in('endpoint', expired)
    }

    const sent = results.filter(r => r.status === 'fulfilled').length
    return NextResponse.json({ ok: true, sent, over: lines })

  } catch (e: any) {
    console.error('budget-alert cron error:', e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
