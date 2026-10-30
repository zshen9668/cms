import type { Bindings } from '../../types'
import type { LanguageOption } from '../languageManager'
import { getLanguages, saveLanguages } from '../languageManager'

export async function getLanguageAdmin(env: Bindings): Promise<LanguageOption[]> {
  return getLanguages(env)
}

export async function updateLanguageAdmin(env: Bindings, value: LanguageOption[] | { items?: LanguageOption[] }) {
  const items = Array.isArray(value) ? value : (value?.items || [])
  return saveLanguages(env, items)
}

export const loadLanguageAdmin = getLanguageAdmin
