// 由 content.mjs 生成 DOCX（无第三方依赖，自带 ZIP 写入）与可打印 HTML
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { blocks, meta } from './content.mjs'

const ROOT = path.resolve(import.meta.dirname, '..')
const FIG = path.join(ROOT, 'figures')
const OUT_DOCX = path.join(ROOT, 'Lindoway-上位机-项目总结初稿.docx')
const OUT_HTML = path.join(ROOT, 'Lindoway-上位机-项目总结初稿.html')

// ---------------- ZIP ----------------
const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[i] = c
  }
  return t
})()
function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}
function zip(files) {
  const chunks = []
  const central = []
  let offset = 0
  const now = new Date()
  const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() / 2)) & 0xffff
  const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8')
    const raw = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, 'utf8')
    const crc = crc32(raw)
    let method = 8
    let body = zlib.deflateRawSync(raw, { level: 9 })
    if (body.length >= raw.length) { method = 0; body = raw }
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(dosTime, 10)
    local.writeUInt16LE(dosDate, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    chunks.push(local, name, body)
    const cd = Buffer.alloc(46)
    cd.writeUInt32LE(0x02014b50, 0)
    cd.writeUInt16LE(20, 4)
    cd.writeUInt16LE(20, 6)
    cd.writeUInt16LE(0x0800, 8)
    cd.writeUInt16LE(method, 10)
    cd.writeUInt16LE(dosTime, 12)
    cd.writeUInt16LE(dosDate, 14)
    cd.writeUInt32LE(crc, 16)
    cd.writeUInt32LE(body.length, 20)
    cd.writeUInt32LE(raw.length, 24)
    cd.writeUInt16LE(name.length, 28)
    cd.writeUInt16LE(0, 30)
    cd.writeUInt16LE(0, 32)
    cd.writeUInt16LE(0, 34)
    cd.writeUInt16LE(0, 36)
    cd.writeUInt32LE(0, 38)
    cd.writeUInt32LE(offset, 42)
    central.push(cd, name)
    offset += local.length + name.length + body.length
  }
  const cdBuf = Buffer.concat(central)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(files.length, 8)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(cdBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20)
  return Buffer.concat([...chunks, cdBuf, eocd])
}

// ---------------- 文本工具 ----------------
const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function tokenize(text) {
  const out = []
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g
  let last = 0
  let m
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ t: 'plain', v: text.slice(last, m.index) })
    const s = m[0]
    if (s.startsWith('**')) out.push({ t: 'bold', v: s.slice(2, -2) })
    else out.push({ t: 'code', v: s.slice(1, -1) })
    last = m.index + s.length
  }
  if (last < text.length) out.push({ t: 'plain', v: text.slice(last) })
  return out
}

// ---------------- DOCX ----------------
const TEXT_W = 9070 // twips（A4 减 2.5cm 页边距）
const EMU_W = TEXT_W * 635
const pngSize = (file) => {
  const b = fs.readFileSync(file)
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }
}

let ridSeq = 100
const media = []
const rels = []

function runXml(text, { size, bold, color, font } = {}) {
  return tokenize(text)
    .map((tok) => {
      // rPr 子元素顺序：rFonts → b → color → sz/szCs（严格按 schema）
      const head = []
      const tail = []
      if (bold || tok.t === 'bold') head.push('<w:b/>')
      if (tok.t === 'code') head.push('<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>')
      else if (font) head.push(`<w:rFonts w:ascii="${font}" w:eastAsia="${font}" w:hAnsi="${font}"/>`)
      if (tok.t === 'code') tail.push('<w:color w:val="9A3412"/>')
      else if (color) tail.push(`<w:color w:val="${color}"/>`)
      if (size) tail.push(`<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>`)
      const props = head.length || tail.length ? `<w:rPr>${head.join('')}${tail.join('')}</w:rPr>` : ''
      return `<w:r>${props}<w:t xml:space="preserve">${esc(tok.v)}</w:t></w:r>`
    })
    .join('')
}

function p(text, opts = {}) {
  const { style, indent = true, align, after = 40, before = 0, line = 340, size, color, indLeft, indHanging } = opts
  const pPr = []
  if (style) pPr.push(`<w:pStyle w:val="${style}"/>`)
  pPr.push(`<w:spacing w:before="${before}" w:after="${after}" w:line="${line}" w:lineRule="auto"/>`)
  if (indLeft || indHanging) pPr.push(`<w:ind w:left="${indLeft ?? 0}" w:hanging="${indHanging ?? 0}"/>`)
  else if (indent) pPr.push('<w:ind w:firstLine="420"/>')
  if (align) pPr.push(`<w:jc w:val="${align}"/>`)
  return `<w:p><w:pPr>${pPr.join('')}</w:pPr>${runXml(text, { size, color })}</w:p>`
}

function heading(text, level) {
  const map = { 1: 'Heading1', 2: 'Heading2', 3: 'Heading3' }
  return `<w:p><w:pPr><w:pStyle w:val="${map[level]}"/></w:pPr>${runXml(text)}</w:p>`
}

function figureBlock(b) {
  const file = path.join(FIG, `${b.src}.png`)
  const { w, h } = pngSize(file)
  const cx = Math.round(EMU_W * (b.width ?? 1))
  const cy = Math.round((cx * h) / w)
  const rid = `rId${ridSeq++}`
  media.push({ name: `word/media/${b.src}.png`, data: fs.readFileSync(file) })
  rels.push({ id: rid, target: `media/${b.src}.png` })
  const pic = `<w:p><w:pPr><w:spacing w:before="120" w:after="60" w:line="240" w:lineRule="auto"/><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${ridSeq}" name="${b.src}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${ridSeq}" name="${b.src}.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`
  const cap = `<w:p><w:pPr><w:spacing w:before="0" w:after="160" w:line="260" w:lineRule="auto"/><w:jc w:val="center"/></w:pPr>${runXml(b.caption, { size: 18, color: '4B5563' })}</w:p>`
  return pic + cap
}

function tableBlock(b) {
  const n = b.head.length
  const widths = (b.widths ?? Array(n).fill(100 / n)).map((w) => Math.round((TEXT_W * w) / 100))
  const border = (side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/>`
  const tblPr = `<w:tblPr><w:tblW w:w="${TEXT_W}" w:type="dxa"/><w:jc w:val="center"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(border).join('')}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:left w:w="90" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/><w:right w:w="90" w:type="dxa"/></w:tblCellMar></w:tblPr>`
  const grid = `<w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>`
  const cell = (text, w, { head, keepNext } = {}) =>
    `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${head ? '<w:shd w:val="clear" w:color="auto" w:fill="EFF6FF"/>' : ''}<w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr>${keepNext ? '<w:keepNext/>' : ''}<w:spacing w:before="20" w:after="20" w:line="260" w:lineRule="auto"/>${head ? '<w:jc w:val="center"/>' : ''}</w:pPr>${runXml(text, { size: 19, bold: head })}</w:p></w:tc>`
  const rows = [
    `<w:tr><w:trPr><w:cantSplit/><w:tblHeader/></w:trPr>${b.head.map((t, i) => cell(t, widths[i], { head: true, keepNext: true })).join('')}</w:tr>`,
    ...b.rows.map(
      (r, ri) =>
        `<w:tr><w:trPr><w:cantSplit/></w:trPr>${r.map((t, i) => cell(t, widths[i], { keepNext: ri < b.rows.length - 1 })).join('')}</w:tr>`,
    ),
  ]
  const cap = `<w:p><w:pPr><w:keepNext/><w:spacing w:before="160" w:after="60" w:line="260" w:lineRule="auto"/><w:jc w:val="center"/></w:pPr>${runXml(b.caption, { size: 18, color: '4B5563' })}</w:p>`
  return cap + `<w:tbl>${tblPr}${grid}${rows.join('')}</w:tbl>` + '<w:p><w:pPr><w:spacing w:before="0" w:after="80" w:line="200" w:lineRule="auto"/></w:pPr></w:p>'
}

const bodyParts = []
bodyParts.push(
  `<w:p><w:pPr><w:spacing w:before="0" w:after="60" w:line="300" w:lineRule="auto"/><w:jc w:val="center"/></w:pPr>${runXml(meta.title, { size: 36, bold: true, color: '1D4ED8', font: '黑体' })}</w:p>`,
  `<w:p><w:pPr><w:spacing w:before="0" w:after="80" w:line="300" w:lineRule="auto"/><w:jc w:val="center"/></w:pPr>${runXml(meta.subtitle, { size: 26, bold: true, font: '黑体' })}</w:p>`,
  `<w:p><w:pPr><w:spacing w:before="0" w:after="40" w:line="280" w:lineRule="auto"/><w:jc w:val="center"/></w:pPr>${runXml(meta.owner, { size: 20, color: '4B5563' })}</w:p>`,
  `<w:p><w:pPr><w:spacing w:before="0" w:after="200" w:line="280" w:lineRule="auto"/><w:jc w:val="center"/></w:pPr>${runXml(`2026 年第十六届"毕昇杯"全国大学生电子设计新技术应用创新竞赛　│　${meta.date}`, { size: 20, color: '4B5563' })}</w:p>`,
)

for (const b of blocks) {
  if (b.type === 'h1') bodyParts.push(heading(b.text, 1))
  else if (b.type === 'h2') bodyParts.push(heading(b.text, 2))
  else if (b.type === 'h3') bodyParts.push(heading(b.text, 3))
  else if (b.type === 'p') bodyParts.push(p(b.text))
  else if (b.type === 'li') bodyParts.push(p('· ' + b.text, { indent: false, indLeft: 420, indHanging: 210 }))
  else if (b.type === 'note') bodyParts.push(p(b.text, { size: 18, color: '6B7280', indent: false }))
  else if (b.type === 'figure') bodyParts.push(figureBlock(b))
  else if (b.type === 'table') bodyParts.push(tableBlock(b))
  else if (b.type === 'pagebreak') bodyParts.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>')
}

const sectPr = `<w:sectPr><w:footerReference w:type="default" r:id="rId2"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1418" w:right="1418" w:bottom="1418" w:left="1418" w:header="851" w:footer="851" w:gutter="0"/><w:cols w:space="425"/><w:docGrid w:type="lines" w:linePitch="312"/></w:sectPr>`

const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
<w:body>${bodyParts.join('')}${sectPr}</w:body></w:document>`

const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:eastAsia="宋体" w:hAnsi="Times New Roman" w:cs="Times New Roman"/><w:sz w:val="21"/><w:szCs w:val="21"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:line="340" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="40" w:line="340" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Times New Roman" w:eastAsia="宋体" w:hAnsi="Times New Roman"/><w:sz w:val="21"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="320" w:after="140" w:line="300" w:lineRule="auto"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:rFonts w:ascii="黑体" w:eastAsia="黑体" w:hAnsi="黑体"/><w:b/><w:sz w:val="30"/><w:szCs w:val="30"/><w:color w:val="1D4ED8"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="100" w:line="300" w:lineRule="auto"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:rFonts w:ascii="黑体" w:eastAsia="黑体" w:hAnsi="黑体"/><w:b/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="80" w:line="300" w:lineRule="auto"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:style>
</w:styles>`

const footerXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/><w:jc w:val="center"/></w:pPr>
<w:r><w:rPr><w:sz w:val="17"/><w:color w:val="6B7280"/></w:rPr><w:t xml:space="preserve">${esc(meta.footer)}　　</w:t></w:r>
<w:r><w:rPr><w:sz w:val="17"/><w:color w:val="6B7280"/></w:rPr><w:t xml:space="preserve">第 </w:t></w:r>
<w:r><w:rPr><w:sz w:val="17"/><w:color w:val="6B7280"/></w:rPr><w:fldChar w:fldCharType="begin"/></w:r>
<w:r><w:rPr><w:sz w:val="17"/><w:color w:val="6B7280"/></w:rPr><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>
<w:r><w:rPr><w:sz w:val="17"/><w:color w:val="6B7280"/></w:rPr><w:fldChar w:fldCharType="end"/></w:r>
<w:r><w:rPr><w:sz w:val="17"/><w:color w:val="6B7280"/></w:rPr><w:t xml:space="preserve"> 页</w:t></w:r>
</w:p></w:ftr>`

const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`

const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`

const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>
${rels.map((r) => `<Relationship Id="${r.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${r.target}"/>`).join('\n')}
</Relationships>`

const coreXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>${esc(meta.title)}　${esc(meta.subtitle)}</dc:title>
<dc:creator>Lindoway</dc:creator>
<cp:lastModifiedBy>Lindoway</cp:lastModifiedBy>
<dcterms:created xsi:type="dcterms:W3CDTF">2026-10-19T00:00:00Z</dcterms:created>
<dcterms:modified xsi:type="dcterms:W3CDTF">2026-10-19T00:00:00Z</dcterms:modified>
</cp:coreProperties>`

const appXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
<Application>Lindoway Report Builder</Application><Company>Lindoway</Company>
</Properties>`

fs.writeFileSync(
  OUT_DOCX,
  zip([
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: rootRels },
    { name: 'word/document.xml', data: documentXml },
    { name: 'word/styles.xml', data: stylesXml },
    { name: 'word/footer1.xml', data: footerXml },
    { name: 'word/_rels/document.xml.rels', data: docRels },
    { name: 'docProps/core.xml', data: coreXml },
    { name: 'docProps/app.xml', data: appXml },
    ...media,
  ]),
)

// ---------------- HTML（打印即 A4 排版） ----------------
const figHtml = (b) => {
  const { w, h } = pngSize(path.join(FIG, `${b.src}.png`))
  const src = `figures/${b.src}.svg`
  return `<figure><img src="${src}" width="${Math.round((w / 2) * (b.width ?? 1))}" alt="${esc(b.caption)}"><figcaption>${esc(b.caption)}</figcaption></figure>`
}
const tableHtml = (b) => `<div class="tbl"><div class="tcap">${esc(b.caption)}</div><table>${b.head.map((t) => `<th>${esc(t)}</th>`).join('')}${b.rows.map((r) => `<tr>${r.map((t) => `<td>${esc(t)}</td>`).join('')}</tr>`).join('')}</table></div>`
const inlineHtml = (text) =>
  tokenize(text)
    .map((tok) => (tok.t === 'bold' ? `<strong>${esc(tok.v)}</strong>` : tok.t === 'code' ? `<code>${esc(tok.v)}</code>` : esc(tok.v)))
    .join('')

const htmlBody = blocks
  .map((b) => {
    if (b.type === 'h1') return `<h1>${inlineHtml(b.text)}</h1>`
    if (b.type === 'h2') return `<h2>${inlineHtml(b.text)}</h2>`
    if (b.type === 'p') return `<p>${inlineHtml(b.text)}</p>`
    if (b.type === 'li') return `<p class="li">· ${inlineHtml(b.text)}</p>`
    if (b.type === 'note') return `<p class="note">${inlineHtml(b.text)}</p>`
    if (b.type === 'figure') return figHtml(b)
    if (b.type === 'table') return tableHtml(b)
    if (b.type === 'pagebreak') return '<div style="page-break-after: always;"></div>'
    return ''
  })
  .join('\n')

fs.writeFileSync(
  OUT_HTML,
  `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>${esc(meta.title)} ${esc(meta.subtitle)}</title>
<style>
@page { size: A4; margin: 20mm 18mm; }
body { font-family: "Microsoft YaHei","PingFang SC",serif; font-size: 10.5pt; line-height: 1.65; color:#1f2937; margin:0; background:#e5e7eb; }
.page { width: 210mm; min-height: 297mm; padding: 20mm 18mm; box-sizing: border-box; margin: 0 auto; background:#fff; }
h1 { font-family:"Microsoft YaHei"; font-size: 15.5pt; color:#1d4ed8; margin: 22px 0 10px; padding-bottom:4px; border-bottom:1px solid #dbeafe; page-break-after: avoid; }
p { margin: 0 0 9px; text-indent: 2em; text-align: justify; }
p.li { text-indent: -1.2em; padding-left: 1.2em; }
p.note { font-size: 9pt; color:#6b7280; }
strong { font-weight: 700; }
code { font-family: Consolas, monospace; font-size: 9pt; color:#9a3412; background:#fff7ed; padding:0 2px; }
figure { margin: 14px 0 16px; text-align:center; page-break-inside: avoid; }
figure img { max-width: 100%; }
figcaption { font-size: 9pt; color:#4b5563; margin-top:6px; }
.tbl { margin: 14px 0 16px; page-break-inside: avoid; }
.tcap { font-size: 9pt; color:#4b5563; text-align:center; margin-bottom:5px; }
table { width:100%; border-collapse: collapse; font-size: 8.8pt; }
th, td { border:1px solid #cbd5e1; padding: 5px 6px; vertical-align: middle; text-align:left; }
th { background:#eff6ff; font-weight:700; text-align:center; }
.title { text-align:center; margin-bottom: 6px; }
.title h1.t { border:none; font-size: 20pt; margin:0 0 6px; }
.sub { text-align:center; font-size: 12pt; font-weight:700; margin: 0 0 4px; }
.meta { text-align:center; font-size: 9.5pt; color:#4b5563; margin:0 0 4px; }
.rule { height:2px; background:#1d4ed8; margin: 10px 0 18px; }
@media print { body{background:#fff} .page{margin:0;padding:0;width:auto;min-height:0} }
</style></head><body><div class="page">
<div class="sub">${esc(meta.subtitle)}</div>
<div class="title"><h1 class="t">${esc(meta.title)}</h1></div>
<div class="meta">${esc(meta.owner)}</div>
<div class="meta">2026 年第十六届"毕昇杯"全国大学生电子设计新技术应用创新竞赛　│　${esc(meta.date)}</div>
<div class="rule"></div>
${htmlBody}
</div></body></html>`,
)

console.log('docx:', OUT_DOCX, fs.statSync(OUT_DOCX).size, 'bytes')
console.log('html:', OUT_HTML, fs.statSync(OUT_HTML).size, 'bytes')
console.log('figures:', media.length)
