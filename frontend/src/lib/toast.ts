export const UI_TOAST_EVENT = '__ai_reporter_ui_toast__'

export const emitToast = (type: 'success' | 'error', message: string) => {
  window.dispatchEvent(new CustomEvent(UI_TOAST_EVENT, { detail: { type, message } }))
}

export const toastSuccess = (message: string) => emitToast('success', message)
export const toastError = (message: string) => emitToast('error', message)

export const confirmDiscardUnsaved = (scopeLabel = 'this form') =>
  window.confirm(`You have unsaved changes in ${scopeLabel}. Discard them?`)
