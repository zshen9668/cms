import type { Bindings } from '../../types'
import type { ContactChannel } from '../contactChannels'
import { getContactChannels, saveContactChannels } from '../contactChannels'

export async function getContactAdmin(env: Bindings): Promise<ContactChannel[]> {
  return getContactChannels(env)
}

export async function updateContactAdmin(env: Bindings, value: ContactChannel[] | { items?: ContactChannel[] }) {
  const items = Array.isArray(value) ? value : (value?.items || [])
  return saveContactChannels(env, items)
}

// Aliases
export const loadContactAdmin = getContactAdmin
