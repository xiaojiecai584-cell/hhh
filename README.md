# Lindoway · 智能哑铃手机端框架

基于 Web Bluetooth 的智能哑铃姿态监测系统「手机端框架」。本阶段完成框架闭环：
**蓝牙双向收发（含虚拟设备）→ 等比例人体模型 → 标准动作实时演示 → 事件回传与报告 → AI 接口留白（人工输入）**。

技术栈：Vite + React 19 + TypeScript + Three.js + Zustand + Web Bluetooth。

## 运行

```bash
# 安装依赖（沙箱环境需把 npm 缓存重定向到项目内）
npm install

# 本地开发（Web Bluetooth 需 localhost / HTTPS）
npm run dev

# 生产构建
npm run build
```

> 真机演示：`npm run dev` 已开启 `host: true`，手机与电脑同一局域网时，用浏览器访问电脑 IP:5173 即可（Web Bluetooth 需 Android Chrome / Edge；iOS Safari 暂不支持，后续可用 Capacitor 原生蓝牙覆盖）。

## 目录结构

```
src/
├─ core/
│  ├─ ble/           # BLETransport 抽象 + Web/虚拟双实现
│  ├─ protocol/      # 10 字节下发指令 / 12 字节事件包编解码
│  ├─ body/          # 身体数据 + 段长估算
│  ├─ motion/        # 动作模板 + 关键帧插值 + 姿态应用
│  ├─ report/        # 事件流聚合报告
│  └─ analysis/      # Analyzer 接口（AI 留白）+ 建议模板
├─ three/            # 参数化胶囊人体模型
├─ store/            # zustand 状态（连接/身体/动作/报告）
├─ components/       # 3D 视口、关节角曲线、自定义动作表单等
└─ pages/            # 连接 / 身体 / 动作 / 演示 / 报告
```

## 蓝牙协议（草案）

- 下发（手机→设备，10 字节）：`帧头 0xAA + CMD + 动作ID + 主运动轴 + 峰值角度(0.1°) + 腕容限 + 节律 + 行程下限 + 校验(XOR)`。
- 回传（设备→手机，12 字节）：`帧头 0xBB + 事件类型 + 动作ID + 代偿标志位 + 峰值角度 + 耗时 + 节律 + 保留 + 校验`。
- 详情见 `docs/技术方案.md`；与真实固件对齐后仅需改 `core/protocol` 与 BLE UUID。

## AI 接入点

`src/core/analysis/analyzer.ts` 定义了 `Analyzer` 接口与 `analyzerRegistry`。大模型训练完成后：

1. 实现 `Analyzer`（`analyze(report) => AnalysisResult`）。
2. 注册到 `analyzerRegistry`。
3. UI / 报告层零改动。当前由报告页的人工输入替代。

## 里程碑

- [x] M0 脚手架 + 主题 + 页面骨架
- [x] M1 蓝牙传输层 + 虚拟设备 + 协议编解码
- [x] M2 身体数据 + 参数化人体模型
- [x] M3 动作引擎 + 两个预设动作 + 实时演示（3D + 关节角曲线）
- [x] M4 自由输入自定义动作（关键帧）
- [x] M5 事件解析 + 报告引擎 + 人工分析输入
- [ ] M6 打磨：iOS 原生蓝牙（Capacitor）、PWA 安装、代码分包
