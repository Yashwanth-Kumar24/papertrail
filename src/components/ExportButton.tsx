'use client'

interface Props {
  dateFrom: string
  dateTo:   string
  preset:   string
  receiptCount: number
  totalSpent:   number
}

const fmtDate = (iso: string) =>
  iso ? new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''

const money = (n: number) => `$${Number(n).toFixed(2)}`

export default function ExportButton({ dateFrom, dateTo, preset, receiptCount, totalSpent }: Props) {
  function doExport() {
    // Build period label
    const period = preset
      ? preset
      : (dateFrom && dateTo)
        ? `${fmtDate(dateFrom)} – ${fmtDate(dateTo)}`
        : 'All time'

    // Inject a temporary print-only header above the page content
    const existing = document.getElementById('pt-print-header')
    if (existing) existing.remove()

    const header = document.createElement('div')
    header.id = 'pt-print-header'
    header.className = 'print-header'
    header.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;">
        <div>
          <div style="font-size:20px;font-weight:700;margin-bottom:4px;">PaperTrail — Spending Summary</div>
          <div style="font-size:12px;color:#555;">Period: ${period}</div>
        </div>
        <div style="text-align:right;font-size:12px;color:#555;">
          <div>Generated ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
          <div>${receiptCount} receipt${receiptCount !== 1 ? 's' : ''} · Total ${money(totalSpent)}</div>
        </div>
      </div>
    `

    // Insert before .pg-head inside .page
    const page = document.querySelector('.page')
    const pgHead = document.querySelector('.pg-head')
    if (page && pgHead) {
      page.insertBefore(header, pgHead)
    } else if (page) {
      page.prepend(header)
    }

    window.print()

    // Clean up after print dialog closes
    setTimeout(() => {
      const el = document.getElementById('pt-print-header')
      if (el) el.remove()
    }, 1000)
  }

  return (
    <button
      onClick={doExport}
      className="no-print"
      style={{
        fontSize: 12,
        padding: '5px 14px',
        borderRadius: 'var(--r)',
        border: '1px solid var(--border2)',
        background: 'transparent',
        cursor: 'pointer',
        fontWeight: 500,
        fontFamily: 'var(--sans)',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        color: 'var(--ink2)',
      }}
      title="Export spending summary as PDF"
    >
      ↓ Export
    </button>
  )
}
