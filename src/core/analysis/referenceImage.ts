export interface ReferenceImage {
  thumburl: string
  url: string
  title: string
  descriptionurl: string
}

interface CommonsPage {
  title?: string
  imageinfo?: { thumburl?: string; url?: string; descriptionurl?: string }[]
}

/** 通过 Wikimedia Commons 检索真实动作参考图（无需 key，支持浏览器 CORS） */
export async function fetchReferenceImage(query: string): Promise<ReferenceImage | null> {
  const q = query.trim()
  if (!q) return null
  const params = new URLSearchParams({
    action: 'query',
    generator: 'search',
    gsrsearch: `${q} filetype:bitmap`,
    gsrnamespace: '6',
    gsrlimit: '10',
    prop: 'imageinfo',
    iiprop: 'url',
    iiurlwidth: '600',
    format: 'json',
    origin: '*',
  })
  try {
    const res = await fetch(`https://commons.wikimedia.org/w/api.php?${params.toString()}`)
    if (!res.ok) return null
    const data = (await res.json()) as { query?: { pages?: Record<string, CommonsPage> } }
    const pages = data.query?.pages
    if (!pages) return null
    const items = Object.values(pages)
      .filter((p) => p?.imageinfo?.[0]?.thumburl)
      .map((p) => ({
        thumburl: p.imageinfo![0].thumburl!,
        url: p.imageinfo![0].url || p.imageinfo![0].thumburl!,
        title: p.title || '',
        descriptionurl: p.imageinfo![0].descriptionurl || '',
      }))
    return items[0] ?? null
  } catch {
    return null
  }
}
