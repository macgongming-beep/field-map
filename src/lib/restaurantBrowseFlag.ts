export function restaurantBrowseEnabled() {
  return import.meta.env.VITE_DEMO_MODE === 'true'
}
