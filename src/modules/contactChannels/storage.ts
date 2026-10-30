import type { Bindings } from '../../types'
import type { ContactChannel } from './types'
import { CONTACT_CHANNELS_KEY } from './types'
import { getContactChannelsFromSettings, serializeContactChannels } from './service'
import { SettingsStore } from '../../utils/settingsStore'

export async function getContactChannels(env: Bindings, tenantId = 1): Promise<ContactChannel[]> {
  if (!env.DB) return []
  try {
    const store = SettingsStore.forTenant(env, tenantId)
    const value = await store.get(CONTACT_CHANNELS_KEY)
    if (value) {
      return getContactChannelsFromSettings({ contact_channels: String(value) })
    }
    // Migrate from legacy fields once
    const legacy = await store.getMany([
      'contact_phone', 'contact_phones', 'contact_wechat', 'contact_wechats', 'contact_qqs',
    ])
    return getContactChannelsFromSettings(legacy)
  } catch {
    return []
  }
}

export async function saveContactChannels(env: Bindings, items: ContactChannel[], tenantId = 1): Promise<void> {
  if (!env.DB) throw new Error('D1 is required')
  const store = SettingsStore.forTenant(env, tenantId)
  const value = serializeContactChannels(items || [])
  await store.set(CONTACT_CHANNELS_KEY, value)
}
