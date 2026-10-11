# Soulidity Studio Product Requirements

版本：v0.1 draft  
状态：待确认  
目标：将 OC 捏人、Agent 人格配置、小游戏角色启动能力从 Soulidity 主站中解耦，形成可独立运行、可嵌入、可对接多平台的创作者工具。

## 1. 背景与结论

现有 Soulidity / clawnews 已经具备较完整的链上后半段能力：Soul 合约、内容版本、授权 Grant、付费访问、交易市场、Agent API、Walrus / Seal 存储等。

当前缺口在前半段：普通用户和创作者缺少一个低门槛工具，把 OC 从“想法 / 图像 / 人格设定”变成可保存、可预览、可上链、可交易、可接入 Agent 的标准角色包。

因此建议将编辑器作为独立产品：

**Soulidity Studio = OC / Agent / Game Character Creator**

它不直接绑定某个交易市场，也不强制用户上链。Studio 输出标准化角色包，后续可以接入：

- Soulidity：铸造成 Soul，进入链上授权与交易体系。
- OKX：作为创作者工具、NFT/资产发行入口或活动编辑器嵌入。
- 小游戏：作为角色创建器，输出游戏可读取的角色配置。
- 第三方 AI Agent：读取 Agent persona、skills、avatar 等配置运行角色。

## 2. 产品定位

Soulidity Studio 是一个面向 OC 创作者、AI Agent 玩家和游戏项目方的可嵌入角色创作器。

它的核心任务不是“卖 OC”，而是帮助用户完成：

```text
捏角色
→ 写档案
→ 配人格和技能
→ 预览 Agent 表现
→ 保存为标准角色包
→ 按需发布到 Soulidity / OKX / 游戏 / 第三方 Agent
```

## 3. 产品原则

1. Studio 独立于链上交易。
   用户可以不懂钱包、不上链，也能完成创作、保存和预览。

2. 输出标准化。
   Studio 的核心资产不是某个页面，而是一套 `Character Package` 标准。

3. OC 与 Agent 一体设计。
   OC 是外观和世界观，Agent 是人格和能力。两者在同一角色包内表达。

4. 发布目标可插拔。
   Soulidity、OKX、小游戏、第三方 Agent 都是 export target，不应该写死在编辑器核心逻辑里。

5. 先做可用闭环，再做素材生态。
   MVP 先让用户捏出角色、试聊、保存；画手工坊、收益分账、素材市场放到后续阶段。

## 4. 目标用户

### 4.1 OC 玩家

想像捏咔一样快速捏出原创角色，保存角色档案，分享给朋友或后续出售。

核心诉求：

- 操作简单。
- 角色好看。
- 能写设定。
- 可以导出图片和角色卡。

### 4.2 AI Agent 玩家

想把 OC 变成一个可聊天、可协作、有设定边界的 AI 角色。

核心诉求：

- 能配置人格、口吻、禁忌、技能。
- 能试聊。
- 能把角色带到某个 AI 程序里。
- 能证明这个 Agent 属于自己。

### 4.3 种子画手 / KOC

想投稿素材、做模板、吸引用户使用自己的部件，后续获得收益。

核心诉求：

- 上传素材。
- 管理素材包。
- 查看使用量。
- 后续参与收益分成。

### 4.4 游戏 / 活动方

想用 Studio 作为活动角色创建器或游戏前置角色创建器。

核心诉求：

- 定制模板。
- 限定素材。
- 输出游戏可读配置。
- 验证角色来源和持有关系。

### 4.5 平台接入方

例如 Soulidity 主站、OKX 活动页、第三方 Agent 应用。

核心诉求：

- 嵌入简单。
- 接收标准输出。
- 可配置主题和模板。
- 可接收发布成功回调。

## 5. 产品形态

Studio 应支持三种运行形态。

### 5.1 独立站点

用户访问 Studio 独立域名，完成角色创作、保存、导出、发布。

适合：

- Soulidity 官方创作入口。
- KOC 内测。
- 公开活动。

### 5.2 嵌入式组件

作为 iframe / SDK 组件嵌入到外部平台。

适合：

- OKX 活动页。
- 游戏官网。
- 合作方页面。

### 5.3 内部路由

作为 Soulidity web app 的 `/studio` 或 `/create` 新版入口。

适合：

- 当前 clawnews 项目先行落地。
- 直接复用现有 auth、upload、mint、market 能力。

## 6. 核心用户旅程

### 6.1 旅程 A：捏 OC

```text
进入 Studio
→ 选择通用模板
→ 使用图层编辑器捏角色
→ 填写 OC 档案
→ 保存草稿
→ 导出图片 / 分享角色卡
```

MVP 目标：不上链也可以完成。

### 6.2 旅程 B：捏 Agent

```text
进入 Studio
→ 选择 Agent 模板
→ 捏外观
→ 填写 OC 档案
→ 配置 Agent 人格和技能
→ 右侧试聊预览
→ 保存 Agent 草稿
→ 可选发布到 Soulidity
```

MVP 目标：用户能明确感受到“这个角色活了”。

### 6.3 旅程 C：发布到 Soulidity

```text
Studio 角色草稿
→ 点击发布到 Soulidity
→ 上传 cover / soul.md / memory.md / skills.zip / persona.json
→ 触发钱包签名
→ Mint 成链上 Soul
→ 返回 Soul detail / My Souls
```

MVP 目标：复用现有 Soulidity 创建与上链能力，不重写合约。

### 6.4 旅程 D：接入 OKX 或活动平台

```text
外部平台打开 Studio
→ 传入 templateId / campaignId / callbackUrl
→ 用户完成创作
→ Studio 输出 Character Package
→ 外部平台接收 packageId / export payload
→ 外部平台决定是否 mint / 上架 / 发放奖励
```

MVP 目标：先定义标准，不必第一版真的接 OKX。

### 6.5 旅程 E：小游戏角色启动

```text
游戏选择角色创建入口
→ Studio 加载游戏专属模板
→ 用户捏角色
→ 输出 gameCharacter 配置
→ 游戏读取配置进入世界
→ 可选链上验证持有关系
```

MVP 目标：预留数据结构和模板类型，游戏集成放 P2。

## 7. MVP 范围

### 7.1 P0 必须做

#### 模板选择

- 展示模板列表。
- 支持模板类型：General、Agent、Game。
- 模板卡展示：封面、名称、简介、标签、可用部件数。
- 支持从 URL 参数指定模板：`?templateId=...`。

#### 2D 捏人编辑器

- 部位 / 部件 / 色板三级结构。
- 基础部位：
  - 背景
  - 身体 / 肤色
  - 发型后层
  - 脸型
  - 眼睛
  - 眉毛
  - 嘴巴
  - 服装
  - 发型前层
  - 配饰
- 图层实时预览。
- 支持撤销 / 重做。
- 支持随机生成。
- 支持保存为 PNG。

#### OC 档案

- 名称。
- 简介。
- 性别设定。
- 年龄设定。
- 性格标签。
- 世界观。
- 背景故事。
- 可见性。

#### Agent 配置

- 说话风格。
- 口头禅。
- 禁忌话题。
- 专长领域。
- 知识边界。
- 回复长度。
- 情绪反应模式。
- 主动性。
- 技能标签。

#### Agent Prompt 生成

- 根据 OC 档案 + Agent 配置生成 system prompt。
- 展示 prompt 摘要，不暴露过多内部模板。
- 支持“试聊预览”。

#### 草稿保存

- 保存角色草稿。
- 草稿可再次编辑。
- 草稿包含视觉配置、档案、Agent 配置、导出图片。

#### 标准导出

- 导出 `Character Package` JSON。
- 导出 `soul.md`。
- 导出 `memory.md`。
- 导出 `persona.json`。
- 导出 `skills.json` 或 `skills.zip`。
- 导出 cover PNG。

### 7.2 P1 应该做

- 发布到 Soulidity。
- 接入现有 upload / mint / market flow。
- My Characters 页面。
- Agent 试聊使用真实 LLM API。
- Studio 内置发布目标选择：Download、Soulidity、External Callback。
- Creator Kit：画师模板草稿、PNG 图层导入、slot/part/variant 标注、license/royalty 元数据、manifest 导出。

### 7.3 P2 后续做

- 素材投稿后台。
- 画手素材包。
- 素材收益统计。
- 游戏模板接入。
- OKX 嵌入模式。
- 多主题白标。
- Agent 版本历史和链上人格升级。

## 8. 非目标

MVP 不做：

- 完整素材市场。
- 拍卖。
- 复杂关系图谱。
- 多人协作编辑。
- 复杂 Live2D / 3D 编辑。
- 自研完整 Agent Runtime。
- 强制用户上链。
- 钱包注册作为默认入口。

## 9. 标准数据结构

### 9.1 Character Package

Studio 的核心输出是 `CharacterPackage`。

```ts
interface CharacterPackage {
  schemaVersion: 'studio.character.v1'
  packageId: string
  createdAt: string
  updatedAt: string
  source: {
    app: 'soulidity-studio'
    templateId: string
    campaignId?: string
    externalRef?: string
  }
  visual: VisualConfig
  profile: CharacterProfile
  agent?: AgentPersona
  game?: GameCharacterConfig
  exports: ExportArtifacts
}
```

### 9.2 Visual Config

```ts
interface VisualConfig {
  canvas: {
    width: number
    height: number
  }
  layers: Array<{
    slot: string
    partId: string
    variantId?: string
    color?: string
    opacity?: number
    transform?: {
      x: number
      y: number
      scale: number
      rotation: number
    }
  }>
  renderedImageUrl?: string
  renderedImageHash?: string
}
```

### 9.3 Character Profile

```ts
interface CharacterProfile {
  name: string
  description: string
  gender?: string
  age?: string
  personalityTags: string[]
  world?: string
  backstory?: string
  visibility: 'private' | 'unlisted' | 'public'
}
```

### 9.4 Agent Persona

```ts
interface AgentPersona {
  enabled: boolean
  speechStyle: string
  catchphrases: string[]
  tabooTopics: string[]
  expertise: string[]
  knowledgeBoundaries: string[]
  replyLength: 'short' | 'medium' | 'long'
  emotionMode: 'empathetic' | 'neutral' | 'playful'
  proactive: boolean
  skills: string[]
  promptPreview?: string
  version: number
}
```

### 9.5 Game Character Config

```ts
interface GameCharacterConfig {
  enabled: boolean
  gameId: string
  archetype?: string
  stats?: Record<string, number>
  traits?: string[]
  unlockRules?: Array<{
    type: 'template' | 'asset' | 'soulidity-package' | 'campaign'
    value: string
  }>
}
```

### 9.6 Export Artifacts

```ts
interface ExportArtifacts {
  coverPng?: {
    url?: string
    hash?: string
    fileName: string
  }
  soulMarkdown?: {
    content: string
    hash?: string
  }
  memoryMarkdown?: {
    content: string
    hash?: string
  }
  personaJson?: {
    content: AgentPersona
    hash?: string
  }
  skillsArchive?: {
    url?: string
    hash?: string
    fileName: string
  }
}
```

## 10. 与 Soulidity 的映射

Studio 不直接知道链上细节，但 Soulidity adapter 需要完成以下映射：

| Studio 输出 | Soulidity 当前能力 |
| --- | --- |
| cover PNG | cover image upload |
| `soul.md` | `KIND_SOUL_DOC` 内容 |
| `memory.md` | `KIND_MEMORY` 内容 |
| `persona.json` | typed content 或 state config |
| `skills.zip` / `skills.json` | skills content |
| Character Package hash | content hash / provenance |
| 发布到市场 | existing market listing |
| Agent 使用 | existing grant / agent access API |

原则：

- Studio 只调用 adapter。
- Adapter 负责上传、签名、mint、mirror、market listing。
- 合约不因 Studio MVP 重新设计。

## 11. 外部接入协议

### 11.1 初始化参数

外部平台打开 Studio 时，可传入：

```ts
interface StudioLaunchParams {
  mode: 'standalone' | 'embed' | 'soulidity' | 'external'
  templateId?: string
  campaignId?: string
  allowedTemplateTypes?: Array<'general' | 'agent' | 'game'>
  exportTargets?: Array<'download' | 'soulidity' | 'callback'>
  callbackUrl?: string
  theme?: 'soulidity-dark' | 'light' | 'partner'
  locale?: 'zh-CN' | 'en-US'
}
```

### 11.2 完成事件

```ts
interface StudioCompleteEvent {
  type: 'studio.character.completed'
  packageId: string
  packageHash: string
  templateId: string
  campaignId?: string
  artifacts: ExportArtifacts
}
```

### 11.3 发布事件

```ts
interface StudioPublishEvent {
  type: 'studio.character.published'
  target: 'soulidity' | 'okx' | 'game' | 'callback'
  packageId: string
  externalRef?: string
  txDigest?: string
  objectId?: string
}
```

## 12. 信息架构

MVP 页面建议：

```text
/studio
  模板选择

/studio/editor
  左侧：部位和部件
  中间：角色画布
  右侧：颜色、随机、保存、下一步

/studio/profile
  OC 档案

/studio/agent
  Agent 人格和技能
  Prompt 摘要
  试聊预览

/studio/review
  角色卡预览
  输出文件预览
  保存草稿 / 下载 / 发布

/studio/creator
  画师模板规格
  PNG 图层导入
  slot / part / variant 标注
  license / royalty 设置
  creator-template manifest 预览与导出

/studio/my
  我的角色草稿和已发布角色
```

## 13. UI/UX 要求

### 13.1 整体风格

- Studio 可以沿用 Soulidity 深色品牌，但要比 market 更“创作工具”。
- 信息密度应高于落地页，低于交易终端。
- 主画布是第一视觉中心。
- 按钮和工具栏尽量图标化。
- 不在界面上解释过多 Web3 概念。

### 13.2 编辑器布局

桌面端：

```text
顶部：模板名 / 保存状态 / 导出 / 发布
左侧：Slot 列表
中间：画布
右侧：部件网格 / 色板 / 属性
底部：步骤进度
```

移动端：

```text
顶部：保存和步骤
中间：画布
底部：抽屉式部件选择
```

### 13.3 Agent 预览

- 左侧为人格表单。
- 右侧为角色卡 + 试聊窗口。
- 每次表单变更后 prompt preview 可更新。
- 试聊不要求强记忆，只验证人格风格。

## 14. 技术需求

### 14.1 前端

- React / Next.js。
- 编辑器状态建议使用 Zustand 或轻量 reducer。
- 图层渲染可先使用 DOM canvas / HTML img stack；如果后续复杂再引入 Pixi.js。
- 需要导出 PNG。
- 需要支持 autosave。

### 14.2 后端

- 草稿存储。
- 模板和素材管理。
- 图片合成服务。
- Character Package 生成。
- Prompt 生成服务。
- Soulidity adapter。

### 14.3 存储

MVP 可使用现有项目存储方式：

- 数据库保存草稿和配置。
- 对象存储保存渲染图与素材。
- 发布 Soulidity 时再上传 Walrus / Seal。

### 14.4 权限

- 未登录用户可试用编辑器，但保存草稿需要登录。
- 下载本地 package 可允许未登录，视运营策略决定。
- 发布到 Soulidity / 外部平台需要登录或外部 session。

## 15. 验收标准

### 15.1 P0 验收

- 用户能从模板进入编辑器。
- 用户能选择至少 6 类部位，每类至少 3 个部件。
- 用户能实时看到角色变化。
- 用户能填写 OC 档案。
- 用户能填写 Agent 配置。
- 系统能生成 persona JSON 和 prompt preview。
- 用户能保存草稿并再次打开编辑。
- 用户能导出 Character Package。
- 用户能导出 cover PNG。

### 15.2 P1 验收

- 用户能从 Studio 发布到 Soulidity。
- 发布后能在 My Souls / Soul detail 看到角色。
- 发布内容包含 cover、soul.md、memory.md、persona / skills。
- Agent API 能读取发布后的 persona。
- 用户能在发布前选择是否上架。

### 15.3 外部接入验收

- Studio 能通过 URL 参数锁定模板。
- Studio 能在完成后发出标准 complete event。
- 外部平台能拿到 packageId 和 artifacts。
- Studio 不依赖 Soulidity 登录态也能运行基础编辑。

## 16. 里程碑

### Phase 0：产品确认

交付：

- PRD 确认。
- Character Package schema 确认。
- MVP 页面范围确认。
- 与现有 Soulidity create flow 的关系确认。

### Phase 1：Studio P0

交付：

- 模板选择。
- 捏人编辑器。
- OC 档案。
- Agent 配置。
- 草稿保存。
- package 导出。
- Creator Kit 本地 manifest 工作台。

### Phase 2：Soulidity Adapter

交付：

- 发布到 Soulidity。
- 复用现有 upload / mint。
- My Characters 与 My Souls 跳转。
- Agent persona 读取。

### Phase 3：嵌入和外部平台

交付：

- iframe / SDK 启动参数。
- complete / publish event。
- callback target。
- partner theme。

### Phase 4：创作者生态

交付：

- 素材投稿。
- 素材包。
- 使用量统计。
- 收益展示。

## 17. 关键风险

| 风险 | 说明 | 应对 |
| --- | --- | --- |
| 素材不足 | 编辑器体验依赖素材量 | MVP 内置少量高质量通用素材，启动 KOC 素材计划 |
| 过早绑定链上 | 用户未创作完成前被钱包打断 | Studio 坚持先草稿后发布 |
| Agent 效果一般 | 配置完但试聊不惊艳 | 先做好 prompt 模板和技能预设 |
| 输出标准过重 | 外部平台接入成本高 | 保持 schema 简洁，复杂字段 optional |
| 与现有 create flow 重叠 | 旧上传式创建和 Studio 创建并存混乱 | Studio 作为新版 create，旧流程保留为 advanced upload |
| OKX 接入不确定 | 外部合作节奏不可控 | 先做标准和 callback，不把 OKX 作为 P0 阻塞项 |

## 18. 需要确认的问题

1. Studio 第一版是否直接替代当前 `/create`，还是先作为 `/studio` 并行上线？
2. MVP 是否必须支持真实 AI 试聊，还是先生成 prompt preview？
3. Agent persona 在 Soulidity 发布时，第一版放入 `memory.md` / `soul.md`，还是新增独立 `persona.json` typed content？
4. 未登录用户是否允许完整编辑并下载 package？
5. P0 是否需要内置素材管理后台，还是直接用静态模板素材？
6. 第一版是否要做 OKX callback 标准，还是只在文档预留？
7. 游戏模板第一版是否只做类型预留，不做真实验证？

## 19. 推荐决策

建议第一版采用：

- 路由：新增 `/studio`，不立即替换 `/create`。
- 编辑器：静态模板素材 + 前端实时合成。
- AI：先做 prompt preview，若环境变量具备 LLM key，再开启试聊。
- 输出：必须生成 Character Package。
- Soulidity：P1 接入现有 mint flow。
- OKX / 游戏：P0 只定义标准，不做真实对接。
- 旧 create：保留为 advanced upload，避免影响当前链上流程。

这个路径风险最低，同时能尽快验证核心产品判断：

**用户是否愿意先在 Studio 捏出一个 OC / Agent，再把它发布成 Soul。**
