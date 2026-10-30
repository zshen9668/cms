import type { Bindings } from '../../types'
import type { NavigationItem } from '../../modules/navigation/service'
import { getNavigation, serializeNavigation } from '../../modules/navigation/service'
import { SettingsStore } from '../../utils/settingsStore'

export async function getNavigationAdmin(env: Bindings): Promise<NavigationItem[]> {
  const settings = await SettingsStore.for(env).getMap('all')
  return getNavigation(settings)
}

export async function updateNavigationAdmin(env: Bindings, value: NavigationItem[] | { items?: NavigationItem[] }) {
  const items = Array.isArray(value) ? value : (value?.items || [])
  await SettingsStore.for(env).set('navigation_json', serializeNavigation(items))
  return items
}

export const loadNavigationAdmin = getNavigationAdmin
