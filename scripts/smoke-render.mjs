// 界面冒烟测试：用 SSR 渲染各套界面，抓渲染期异常并断言关键元素。
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

async function renderApp(hash, mutate) {
  globalThis.location = { pathname: '/', hash }
  globalThis.history = { replaceState() {} }
  server.moduleGraph.invalidateAll()
  // 必须先把 App 载入并缓存，再去改 store，否则改的是另一个模块实例
  const { default: App } = await server.ssrLoadModule('/src/App.tsx')
  if (mutate) await mutate()
  return renderToString(React.createElement(App))
}

// ---- 1. 用户界面（未开始运动）----
let html = await renderApp('')
{
  const tabCount = (html.match(/class="tabbar__item/g) || []).length
  const has = (s) => html.includes(s)
  console.log(`\n[主界面 · 待机] ${html.length} 字节，标签数 ${tabCount}`)
  check('有「连接设备」按钮', has('连接设备'))
  check('有「选择动作」', has('选择动作'))
  check('有「本组目标次数」', has('本组目标次数'))
  check('有「开始」按钮', has('>开始<'))
  check('有「调试」入口', has('调试'))
  check('未开始时不显示全屏计数器', !has('live__count'))
  check('不含 UUID 地址字段', !has('UUID'))
  check('不含 BLE 参数面板', !has('BLE 参数'))
  check('不含原始帧调试区', !has('调试 · 接收数据'))
  check('不含设备类型切换', !has('设备类型'))
  check('底部 5 个标签', tabCount === 5, `实际 ${tabCount}`)
}

// ---- 2. 运动进行中（全屏界面）----
// 注意：zustand v5 的 SSR 快照取的是 getInitialState()，renderToString 观察不到 setState，
// 所以这里直接渲染纯展示层 LiveSessionView（与 store 解耦的那个）。
{
  server.moduleGraph.invalidateAll()
  const { LiveSessionView } = await server.ssrLoadModule('/src/components/LiveSession.tsx')
  const html = renderToString(
    React.createElement(LiveSessionView, {
      name: '坐姿推举',
      repCount: 12,
      targetReps: 20,
      clock: '00:42',
      reached: false,
      onStop: () => {},
    }),
  )
  const has = (s) => html.includes(s)
  console.log(`\n[运动进行中 · 全屏] ${html.length} 字节`)
  check('全屏容器', has('class="live"'))
  check('大号次数 = 12', has('live__count') && has('>12<'))
  check('目标次数', has('/ 20 次'))
  check('动作名', has('坐姿推举'))
  check('计时 00:42', has('00:42'))
  check('进度条 60%', has('width:60%'))
  check('有「结束」按钮', has('live__stop') && has('>结束<'))
  check('不含任何调试信息', !has('UUID') && !has('调试 · 接收数据') && !has('BLE 参数'))
}

// ---- 3. 调试站 ----
html = await renderApp('#/debug')
{
  const tabCount = (html.match(/class="tabbar__item/g) || []).length
  const has = (s) => html.includes(s)
  console.log(`\n[调试站] ${html.length} 字节，标签数 ${tabCount}`)
  check('有设备类型切换', has('设备类型'))
  check('含 BLE 参数面板（地址入口）', has('BLE 参数'))
  check('含原始帧调试区', has('调试 · 接收数据'))
  check('标题带「调试」标识', has('app__mode'))
  check('底部 3 个标签', tabCount === 3, `实际 ${tabCount}`)
}

console.log(`\n${failures === 0 ? '全部通过' : `${failures} 项未通过`}`)
await server.close()
process.exit(failures === 0 ? 0 : 1)
