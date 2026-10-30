import type { ContactChannel } from './types'
import { filterContactChannels, getContactChannelsFromSettings } from './service'

/**
 * Unified contact entry point for white-label rendering.
 * New code should use this instead of reading legacy contact_* settings directly.
 */
export function getActiveContactChannels(
  settings: Record<string, string>,
  surface?: 'header' | 'footer' | 'contact' | 'ai',
): ContactChannel[] {
  const channels = getContactChannelsFromSettings(settings)
  return surface ? filterContactChannels(channels, surface) : channels
}
