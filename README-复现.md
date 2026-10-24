# Lindoway 上位机（Web 端）· 复现说明

本包内含源码、已构建产物、协议与算法文档、以及全部验证脚本。

## 一、直接看效果（推荐：双击 `启动（双击我）.bat`）

解压后**双击 `启动（双击我）.bat`**，会在 `http://localhost:8788` 起一个本地服务并自动打开浏览器。
关闭那个黑窗口即停止服务。

> ⚠️ **不要直接双击 `index.html`**，两个原因：
> 1. 包根目录的 `index.html` 是**源码入口**（引用 `/src/main.tsx`），只有 Vite 开发服务器能解析；
> 2. 即使双击 `dist/index.html` 也不行——Chrome 会以 CORS 策略拦截 `file://` 下的 module 脚本，
>    且 Web Bluetooth 只在 `localhost` 或 HTTPS 下可用。

也可以手动起服务：

```powershell
node serve-dist.mjs          # 本包自带，纯 Node 无依赖，端口 8788
# 或用其它静态服务器
npx serve dist
```

浏览器打开 `http://localhost:8788/#/main`（用户界面）或 `/#/debug`（调试站）。

**注意**：必须用 `localhost` 访问，不要用局域网 IP，否则 Web Bluetooth 不可用。

## 二、从源码重新构建

```powershell
npm ci           # 按 package-lock.json 精确还原依赖
npm run build    # tsc --noEmit && vite build  →  输出到 dist/
```

要求 Node.js ≥ 20。构建脚本会先做 TypeScript 全量类型检查，再打包。

## 三、验证算法与协议（无需设备）

```powershell
node scripts/verify-contract.mjs        # 数据契约 24 项
node scripts/test-grammar.mjs           # 计数算法：次数/停顿/节律/行程/噪声/晃动
node scripts/verify-count-position.mjs  # 计数发生在底部而非顶端
node scripts/replay-count.mjs           # 真实录音回放 8 项
node scripts/smoke-render.mjs           # 页面渲染冒烟检查
node scripts/diagnose-counter.mjs       # 213 条单次样本的识别率与拒因统计
```

以上脚本都通过 Vite 的 SSR 加载真实的 `src/` 源码，**跑的就是线上同一份代码**。

## 四、用真实录音定标参数

调试站（`#/debug`）录制整组数据 → 「导出原始数据（JSON）」→ 得到
`lindoway-raw-*.json`，可直接用于定标：

```powershell
node scripts/analyze-real.mjs "lindoway-raw-坐姿推举-12reps-xxx.json"
node scripts/fit-real.mjs     "lindoway-raw-坐姿推举-12reps-xxx.json"
node scripts/fit-multi.mjs    "慢速.json" "快速.json"
```

- `analyze-real.mjs`：统计 |ω| / |a_vert| 分布，反解停顿门槛
- `fit-real.mjs`：用**真正的 RepCounter** 对单份数据做参数网格搜索
- `fit-multi.mjs`：多份数据联合搜索，找同时满足所有真值的参数

## 五、目录说明

| 路径 | 内容 |
|---|---|
| `src/core/protocol/` | 帧编解码与类型（`0x01` 姿态、`0x02` 动作开始、`0x80` ACK、`0x82`/`0x83` 下行） |
| `src/core/ble/` | 传输抽象与 Web Bluetooth 实现 |
| `src/core/analysis/` | 计数算法（`repCounter.ts`）、按动作参数（`repOptions.ts`）、错误分类、数据契约 |
| `src/store/` | Zustand 状态层 |
| `src/pages/` | 用户界面（`TrainingPage`）与调试站（`ConnectPage`） |
| `dist/` | 已构建产物 |
| `docs/技术方案.md` | 技术方案，含协议与算法说明 |
| `docs/采样程序设计.md` | 数据采集协议（工况矩阵、导出格式、校验规则） |
| `report/` | 项目总结汇报（docx / pdf / html / 图） |
| `scripts/` | 全部验证与定标脚本 |

## 六、当前状态（构建时的版本）

- 启动权在**设备端**：设备发 `0x02` 动作开始事件，App 只等待与响应，不下发 `0x82`
- 计数模型：**每个明显停顿记 0.5 次**，攒满两个为 1 次（坐姿推举专用）
- 参数由**真实整组录音**（12 次 / 55.9 s / 50 Hz）定标
- 站姿侧平举不套用停顿模型，沿用角速度与姿态回落判据
- 已知未解决：快速节奏（11.5 次 / 44.6 s）只数出 9 次，疑为快速时停顿时长低于
  300 ms 确认窗口，待"快速但停顿明确"的数据分离因素后定位
