export function recipientCardScopeEnabled(role: string, recipient: boolean) {
  return (import.meta.env.VITE_RECIPIENT_CARD_SCOPE_ENABLED ?? import.meta.env.VITE_DEMO_MODE) === 'true'
    && role === 'user' && recipient
}
