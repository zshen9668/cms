export type ContactChannelType =
  | 'phone'
  | 'wechat'
  | 'qq'
  | 'email'
  | 'whatsapp'
  | 'telegram'
  | 'address'
  | 'custom'

export type ContactChannelDisplay = {
  header?: boolean
  footer?: boolean
  contact?: boolean
  ai?: boolean
}

export type ContactChannel = {
  id: string
  type: ContactChannelType
  label: string
  value: string
  enabled: boolean
  sortOrder: number
  openUrl?: string | undefined
  /** Optional QR/media URL, normally backed by R2. */
  qrUrl?: string | undefined
  locale?: string
  display?: ContactChannelDisplay
}

export type ContactChannelsConfig = {
  items: ContactChannel[]
}

export const CONTACT_CHANNELS_KEY = 'contact_channels'