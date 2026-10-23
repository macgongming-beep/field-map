export function recipientCardScopeEnabled(role: string, recipient: boolean) {
  return import.meta.env.VITE_DEMO_MODE === 'true'
    && import.meta.env.VITE_RECIPIENT_CARD_SCOPE_ENABLED === 'true'
    && role === 'user' && recipient
}
