import { channelsToContactMethods, getContactChannelsFromSettings } from '../modules/contactChannels/service'
export type ContactMethods = { phones: string[]; wechats: string[]; qqs: string[] }

/**
 * Compatibility adapter for older templates and route code.
 * New code should use contactChannels accessor directly.
 * Legacy fields are migration fallback only.
 */
export function getContactMethods(settings: Record<string, string>): ContactMethods {
  // getContactChannelsFromSettings owns the legacy fallback and, importantly,
  // preserves an explicitly empty canonical contact_channels configuration.
  return channelsToContactMethods(getContactChannelsFromSettings(settings))
}

