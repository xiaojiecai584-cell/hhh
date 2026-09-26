// 界面冒烟测试：用 SSR 把 App 渲染成字符串，抓渲染期异常与关键元素是否出现。
// 运行：node scripts/smoke-render.mjs
import { createServer } from 'vite'

const server = await createServer({
  configFile: 'vite.config.ts',
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
})
const React = await import('react')
const { renderToString } = await import('react-dom/server')

let failures = 0
const check = (name, cond, extra = '') => {
  console.log(`  ${cond ? '✓' : '✗'} ${name}${extra ? `  ${extra}` : ''}`)
  if (!cond) failures++
}

for (const route of ['main', 'debug']) {
  // 通过 hash 让 useAppStore 初始化到对应路由
  globalThis.location = { pathname: '/', hash: route === 'debug' ? '#/debug' : '' }
  globalThis.history = { replaceState() {} }
  // 必须清掉模块缓存：useAppStore 是模块级单例，否则第二次仍拿第一次的 route
  server.moduleGraph.invalidateAll()
  const { default: App } = await server.ssrLoadModule('/src/App.tsx')
  let html = ''
  try {
    html = renderToString(React.createElement(App))
  } catch (e) {
    console.log(`\n[${route}] 渲染抛异常：`, e.message)
    failures++
    continue
  }
  const tabCount = (html.match(/class="tabbar__item/g) || []).length
  const has = (s) => html.includes(s)
  console.log(`\n[${route}] 渲染成功，${html.length} 字节，标签数 ${tabCount}`)
  if (route === 'main') {
    check('有「连接设备」按钮', has('连接设备'))
    check('有「选择动作」', has('选择动作'))
    check('有「本组目标次数」', has('本组目标次数'))
    check('有大号计数区', has('train__count'))
    check('有「开始」按钮', has('>开始<'))
    check('有「调试」入口', has('调试'))
    check('不含 UUID 地址字段', !has('UUID'))
    check('不含 BLE 参数面板', !has('BLE 参数'))
    check('不含原始帧调试区', !has('调试 · 接收数据'))
    check('不含设备类型切换', !has('设备类型'))
    check('底部 5 个标签', tabCount === 5, `实际 ${tabCount}`)
  } else {
    check('有设备类型切换', has('设备类型'))
    // UUID 字段在「配置」折叠面板里，默认不展开；面板本身存在于调试站即为正确
    check('含 BLE 参数面板（地址入口，调试站保留）', has('BLE 参数'))
    check('含原始帧调试区', has('调试 · 接收数据'))
    check('标题带「调试」标识', has('app__mode'))
    check('底部 3 个标签', tabCount === 3, `实际 ${tabCount}`)
  }
}

console.log(`\n${failures === 0 ? '全部通过' : `${failures} 项未通过`}`)
await server.close()
process.exit(failures === 0 ? 0 : 1)
