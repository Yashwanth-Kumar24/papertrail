'use client'

const FEATURES = [
  {
    icon: '🏪',
    title: 'Costco, supercharged',
    points: [
      'Import all your Costco receipts in one tap',
      'Scan the barcode straight from PaperTrail — no Costco app needed',
      'Track item prices over time and catch price drops',
      'Spot return opportunities before the 90-day window closes',
      "Search any item you've ever bought, instantly",
    ],
  },
  {
    icon: '🧾',
    title: 'Every receipt, organized',
    points: [
      'Scan paper receipts with your camera — AI extracts every item',
      'Log who paid, the store, date, category, and notes',
      'Filter and search across your entire purchase history',
      'Bulk-delete duplicates or old receipts with ease',
    ],
  },
  {
    icon: '📊',
    title: 'Know where your money goes',
    points: [
      'Spending breakdown by category, store, and payer',
      'Monthly trends with heatmaps and top-store rankings',
      'Month-over-month digest so nothing sneaks up on you',
    ],
  },
  {
    icon: '💳',
    title: 'Bills & budgets',
    points: [
      'Track recurring bills — rent, subscriptions, insurance',
      "Mark bills paid each cycle and see what's still due",
      'Set category budgets and watch your spending stay in range',
    ],
  },
  {
    icon: '🛒',
    title: 'Never forget an item',
    points: [
      'Shared household shopping list — add from anywhere',
      'Check things off as you shop, reset when done',
    ],
  },
]

interface Props {
  open:    boolean
  onClose: () => void
  // isFirstVisit: true → "Welcome" title + "Let's go →" button (no × in corner)
  //               false → "How PaperTrail works" title + "Got it" button + × in corner
  isFirstVisit?: boolean
}

export default function OnboardingModal({ open, onClose, isFirstVisit = false }: Props) {
  if (!open) return null

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.5)',
      overflowY: 'auto',
      overflowX: 'hidden',
    }}>
      <div style={{
        minHeight: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px 16px',
        boxSizing: 'border-box',
      }}>
      <div style={{
        background: 'var(--cream)',
        borderRadius: 16,
        width: '100%',
        maxWidth: 520,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 24px 64px rgba(0,0,0,0.22)',
      }}>
        {/* Header */}
        <div style={{
          padding: '24px 28px 18px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 12,
        }}>
          <div>
            <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:6}}>
              <img
                src="/icon-192.png" alt="PaperTrail"
                width={28} height={28}
                style={{borderRadius:6}}
                onError={e => (e.currentTarget.style.display='none')}
              />
              <span style={{fontSize:18,fontWeight:700,color:'var(--ink)'}}>
                {isFirstVisit ? 'Welcome to PaperTrail' : 'How PaperTrail works'}
              </span>
            </div>
            <p style={{fontSize:13,color:'var(--ink2)',margin:0,lineHeight:1.5}}>
              Your household receipt tracker — here&apos;s what makes it worth opening every time you shop.
            </p>
          </div>
          {!isFirstVisit && (
            <button
              onClick={onClose}
              aria-label="Close"
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 22, lineHeight: 1, color: 'var(--ink3)',
                padding: '0 2px', flexShrink: 0,
              }}
            >×</button>
          )}
        </div>

        {/* Feature list */}
        <div style={{padding:'20px 28px',display:'flex',flexDirection:'column',gap:20}}>
          {FEATURES.map(f => (
            <div key={f.title}>
              <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8}}>
                <span style={{fontSize:18}}>{f.icon}</span>
                <span style={{fontSize:14,fontWeight:700,color:'var(--ink)'}}>{f.title}</span>
              </div>
              <ul style={{margin:0,paddingLeft:20,display:'flex',flexDirection:'column',gap:4}}>
                {f.points.map(p => (
                  <li key={p} style={{fontSize:13,color:'var(--ink2)',lineHeight:1.5}}>{p}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{
          padding: '16px 28px',
          borderTop: '1px solid var(--border)',
          flexShrink: 0,
          display: 'flex',
          justifyContent: 'flex-end',
        }}>
          <button
            onClick={onClose}
            style={{
              background: 'var(--green)', color: '#fff',
              border: 'none', borderRadius: 8,
              padding: '10px 28px', fontSize: 14, fontWeight: 600,
              cursor: 'pointer', fontFamily: 'var(--sans)',
            }}
          >
            {isFirstVisit ? "Let's go →" : 'Got it'}
          </button>
        </div>
      </div>
      </div>
    </div>
  )
}
