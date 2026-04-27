import React from 'react'

interface ModalProps {
  title: string
  onClose: () => void
  children: React.ReactNode
  width?: number
}

export const Modal = ({ title, onClose, children, width = 480 }: ModalProps) => (
  <div
    style={{
      position: 'fixed', inset: 0, background: 'oklch(0% 0 0/0.4)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
    }}
    onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
  >
    <div style={{
      width, maxWidth: '95vw', maxHeight: '90vh', background: 'var(--surface)',
      borderRadius: 14, boxShadow: '0 24px 60px oklch(0% 0 0/0.18)',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      <div style={{
        padding: '18px 24px', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
      }}>
        <div style={{ fontWeight: 700, fontSize: 16 }}>{title}</div>
        <button type="button" aria-label="Close" onClick={onClose}
          style={{ fontSize: 20, color: 'var(--text-3)', padding: '4px 8px' }}>×</button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
        {children}
      </div>
    </div>
  </div>
)
