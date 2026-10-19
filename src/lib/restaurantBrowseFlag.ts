export function restaurantBrowseEnabled() {
  return (import.meta.env.VITE_RESTAURANT_BROWSE_ENABLED ?? import.meta.env.VITE_DEMO_MODE) === 'true'
}
