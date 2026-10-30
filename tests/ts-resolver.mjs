// Node --import 钩子：让 node --test 直接运行 tests/*.ts。
// 源码内部导入沿用无扩展名风格（由 Wrangler/esbuild 解析），
// Node 原生 ESM 解析器不补 .ts，这里在解析失败时尝试追加 .ts/.tsx/index.ts。
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context)
  } catch (e) {
    const canRetry = (specifier.startsWith('./') || specifier.startsWith('../')) && (e?.code === 'ERR_MODULE_NOT_FOUND' || e?.code === 'ERR_UNSUPPORTED_DIR_IMPORT')
    if (!canRetry) throw e
    for (const suffix of ['.ts', '.tsx', '/index.ts']) {
      try {
        return await nextResolve(specifier + suffix, context)
      } catch {
        // 尝试下一个候选
      }
    }
    throw e
  }
}
