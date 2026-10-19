# Lindoway 上位机 · 项目总结汇报（初稿）

本目录是「上位机（Web 端）」部分的汇报初稿，内容与插图均为初版，供组内评审后并入总汇报。

## 交付物

| 文件 | 说明 |
| --- | --- |
| `Lindoway-上位机-项目总结初稿.docx` | 主交付物，A4、11 页，可直接编辑（Word 已验证可正常打开） |
| `Lindoway-上位机-项目总结初稿.pdf` | 同版 PDF，用于预览与打印 |
| `Lindoway-上位机-项目总结初稿.html` | 网页版（浏览器打开，Ctrl+P 可再导出 PDF） |
| `figures/fig1-architecture.svg` | 图 1 上位机系统总体原理图（矢量源） |
| `figures/fig2-layers.svg` | 图 2 上位机软件分层架构（矢量源） |
| `figures/fig3-main-flow.svg` | 图 3 上位机主程序流程图（矢量源） |
| `figures/fig4-algorithm.svg` | 图 4 在线计数与代偿判别算法流程图（矢量源） |
| `figures/fig5-sequence.svg` | 图 5 通信与数据流时序（矢量源） |
| `figures/*.png` | 同名 2 倍分辨率 PNG，可直接拖进 PPT / Word |

## 内容范围

只覆盖上位机：BLE 通信与协议解析、在线计数与代偿判别、组内分析与报告生成。
设备端电路原理图、固件、结构件不在此稿范围，图 1 仅约定接口与数据格式。

## 重新生成

```powershell
# 1) 改完 figures/*.svg 后重新导出 PNG（需要本机 Edge）
# 2) 重新生成 docx 与 html
node report/tools/build.mjs
# 3) docx -> pdf（需要本机 Word）
cscript //nologo report/tools/docx2pdf.vbs "report\Lindoway-上位机-项目总结初稿.docx" "report\Lindoway-上位机-项目总结初稿.pdf"
```

- 正文文字与图表清单在 `tools/content.mjs`，改这一处即可，DOCX 与 HTML 同步更新。
- 插图在 `figures/*.svg`，改完需按上面的第 1 步重新导出 PNG。
- 配色：主色 `#1D4ED8`，设备端灰 `#6B7280`，服务端绿 `#059669`，提示黄 `#F59E0B`。

## 评审时建议重点核对

1. 表 3 的计数参数是否与真机标定结果一致；
2. 表 5 第一条：主控到底是 MSPM0G3507 还是 ESP32-S3（申报材料与代码注释不一致）；
3. 第十节的实测识别率来自历史样本回放，需真机复核后才能引用。
