# Soulidity 框架图资源

日期：2026-10-04。

正文与唯一可编辑图源位于 [全链上 OC 生态与产品架构](../../SOULIDITY_PROBLEM_PRODUCT_ARCHITECTURE_CN.md) 的四个 Mermaid 代码块。

| 文件名 | 图的用途 |
| --- | --- |
| onchain-model | 全链上业务、去中心化内容与运行端的整体关系 |
| product-map | 产品关系与分工 |
| oc-journey | Maker 路径的 OC 用户流程 |
| technical-architecture | AC/SO 前端、身份、存储、授权与运行端的逻辑依赖 |

每张图提供 SVG 和 PNG。SVG 适合缩放与后续排版，PNG 适合直接预览；两者由同一图源渲染。当前使用 Mermaid 11.4.1 的 neutral 主题，SVG 中含 XHTML 标签布局，PNG 为浏览器 2 倍像素输出。SVG 换行标签已规范为有效 XML；不支持 foreignObject 的排版工具请使用 PNG。更新正文图源后应同时重新生成对应文件并核对文字、连线与换行。

产品图实线表示确定的职责或已有实现关系，虚线表示规划、可选或待验收接入。用户流程图表达目标操作及恢复分支。技术图和全链上总图表达逻辑依赖，不表示层间自动同步。四图均不能单独证明生产验收；分享时应附正文的状态与边界说明。

`render-manifest.json` 记录图源和导出文件哈希，用来检查导出物是否与正文图源一致，不作为产品测试或链上发布证据。
