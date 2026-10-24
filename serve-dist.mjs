// 极简静态服务器：只服务 dist/ 目录，纯 Node 内置模块，无第三方依赖。
// 用途：让 dist/ 能以 http://localhost 方式打开（Chrome 禁止 file:// 下加载 module 脚本，
//       且 Web Bluetooth 只在 localhost / HTTPS 下可用）。
//
// 用法：node serve-dist.mjs        （或双击同目录的「启动（双击我）.bat」）
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, resolve } from 'node:path'
import { exec } from 'node:child_process'

const ROOT = resolve(process.cwd(), 'dist')
// 不读通用的 PORT：很多环境（IDE、其它服务）会把 PORT 设成已被占用的值，
// 导致这里直接 EADDRINUSE。用专用变量名，默认 8788。
const PORT = Number(process.env.LINDOWAY_PORT || 8788)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`)
    // 归一化并限制在 ROOT 内，避免 ../ 越权
    let rel = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '')
    let file = join(ROOT, rel)
    if (!file.startsWith(ROOT)) {
      res.writeHead(403).end('Forbidden')
      return
    }
    let st = await stat(file).catch(() => null)
    if (st?.isDirectory()) {
      file = join(file, 'index.html')
      st = await stat(file).catch(() => null)
    }
    // 单页应用：找不到的路径回退到 index.html（hash 路由其实用不到，兜底而已）
    if (!st) {
      file = join(ROOT, 'index.html')
      st = await stat(file).catch(() => null)
    }
    if (!st) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('未找到 dist/index.html，请先执行 npm run build')
      return
    }
    const body = await readFile(file)
    res.writeHead(200, {
      'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
    })
    res.end(body)
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }).end(String(e))
  }
})

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://localhost:${PORT}/#/main`
  console.log('')
  console.log('  Lindoway 上位机（Web 端）已启动')
  console.log(`  地址：${url}`)
  console.log('')
  console.log('  · 用户界面：/#/main     调试站：/#/debug')
  console.log('  · 连接设备需要 Web Bluetooth（Chrome / Edge，且必须是 localhost 或 HTTPS）')
  console.log('  · 按 Ctrl+C 停止服务')
  console.log('')
  // 自动打开默认浏览器（失败不影响服务）
  const cmd =
    process.platform === 'win32'
      ? `start "" "${url}"`
      : process.platform === 'darwin'
        ? `open "${url}"`
        : `xdg-open "${url}"`
  exec(cmd, () => {})
})
