import { NextRequest, NextResponse } from 'next/server'
import webpush from 'web-push'
import { supabase } from '@/lib/supabase'
import { getRecurring } from '@/lib/queries'

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT!,
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!,
)

// Specific checkpoints, not a continuous "due within N days" window — a
// window check would fire once a day for the same bill on every day it's
// due-soon-or-overdue (3 days out, 2, 1, due today, then every single day
// overdue forever). Instead: one heads-up 3 days out, one on the due date,
// one the day it first goes overdue, then a weekly nag (not daily) for as
// long as it stays unpaid, so a forgotten bill doesn't go silent but also
// doesn't spam every morning.
function shouldNotify(daysUntil: number): boolean {
  if (daysUntil === 3)  return true // heads up
  if (daysUntil === 0)  return true // due today
  if (daysUntil === -1) return true // just went overdue
  if (daysUntil < -1 && Math.abs(daysUntil) % 7 === 0) return true // weekly overdue reminder
  return false
}

// Called by Vercel cron daily. Guards with CRON_SECRET so it can't be
// triggered anonymously.
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Same function the Recurring page uses — identical paid-status and
    // cycle-window computation, so this can never disagree with what the
    // app itself shows for "is this bill paid this cycle."
    const bills = await getRecurring()

    const today = new Date(); today.setHours(0, 0, 0, 0)

    const flagged = bills
      .filter(b => !b.paidThisCycle && b.cycleEnd)
      .map(b => {
        const nextDue = new Date(b.cycleEnd + 'T00:00:00')
        nextDue.setDate(nextDue.getDate() + 1)
        const daysUntil = Math.round((nextDue.getTime() - today.getTime()) / 86400000)
        return { name: b.name, daysUntil }
      })
      .filter(f => shouldNotify(f.daysUntil))

    if (!flagged.length) {
      return NextResponse.json({ ok: true, sent: 0, reason: 'nothing at a notify checkpoint today' })
    }

    const { data: subs } = await supabase.from('push_subscriptions').select('*')
    if (!subs?.length) {
      return NextResponse.json({ ok: true, sent: 0, reason: 'no subscribers' })
    }

    const overdue = flagged.filter(f => f.daysUntil < 0)
    const dueSoon = flagged.filter(f => f.daysUntil >= 0)

    const parts: string[] = []
    if (overdue.length) parts.push(`Overdue: ${overdue.map(f => f.name).join(', ')}`)
    if (dueSoon.length)  parts.push(`Due soon: ${dueSoon.map(f => `${f.name} (${f.daysUntil === 0 ? 'today' : `${f.daysUntil}d`})`).join(', ')}`)

    const payload = JSON.stringify({
      title: 'PaperTrail · Bills Due',
      body:  parts.join(' · '),
      url:   '/expenses',
    })

    const results = await Promise.allSettled(
      subs.map(sub =>
        webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { auth: sub.auth, p256dh: sub.p256dh } },
          payload,
          // Overdue bills can have real consequences (late fees) — worth the
          // heads-up banner; a pure "due in 3 days" reminder doesn't need it.
          { urgency: overdue.length ? 'high' : 'normal', TTL: 86400 },
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
    return NextResponse.json({ ok: true, sent, flagged: flagged.length })

  } catch (e: any) {
    console.error('recurring-alert cron error:', e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
