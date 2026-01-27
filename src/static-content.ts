// Development stub - replaced at build time with inlined content
// See scripts/build.ts createStaticContentPlugin()

export const STATIC = {
  continuum_init_guide: await Bun.file(`${import.meta.dir}/static/instructions/continuum_init.md`).text()
}
