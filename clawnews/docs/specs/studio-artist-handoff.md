# Soulidity Studio Artist Handoff

状态：v0.1 draft  
用途：给画师/KOC 说明如何准备可接入 Soulidity Studio 的 OC 捏人素材。

## 1. 画师交付物

每个模板包至少包含：

- `template.json`：模板 manifest。
- `cover.png`：模板封面。
- `parts/`：所有透明 PNG 部件。
- `preview/`：可选，示例捏人成图。

建议目录：

```text
template-name/
  template.json
  cover.png
  parts/
    background_nebula_default.png
    hairBack_wave_default.png
    hairFront_side_default.png
    eyes_bright_default.png
    mouth_calm_default.png
    outfit_jacket_default.png
    accessory_halo_default.png
  preview/
    sample-01.png
```

## 2. PNG 规格

- 格式：PNG。
- 背景：透明。
- 推荐尺寸：1024 x 1024。
- 锚点：默认中心点 `512, 512`。
- 命名：`slot_part_variant.png`。
- 文件名：仅使用英文、数字、下划线、短横线。

## 3. Slot 标准

MVP 支持：

| Slot | 用途 | 示例 |
| --- | --- | --- |
| `background` | 背景 | `background_nebula_default.png` |
| `hairBack` | 后发层 | `hairBack_wave_default.png` |
| `hairFront` | 前发/刘海 | `hairFront_side_default.png` |
| `eyes` | 眼睛 | `eyes_bright_default.png` |
| `mouth` | 嘴巴 | `mouth_calm_default.png` |
| `outfit` | 服装 | `outfit_jacket_default.png` |
| `accessory` | 配饰 | `accessory_halo_default.png` |

推荐渲染顺序：

```text
background
skin/body
hairBack
outfit
eyes
mouth
hairFront
accessory
```

## 4. 授权类型

Studio MVP 支持三类：

- `free-remix`：可自由捏人和导出，适合冷启动模板。
- `paid-commercial`：商业使用需付费或分成。
- `world-locked`：绑定某个世界观、游戏或活动。

建议第一批画师使用 `free-remix` 或 `paid-commercial`，方便测试转化。

## 5. 版税建议

- 免费模板：`0-300 bps`。
- 付费商业模板：`300-800 bps`。
- 世界观限定模板：按合作协议设置。

`100 bps = 1%`。

## 6. 当前开发状态

`/studio` 已有 Creator Kit 本地工作台：

- 录入模板信息。
- 上传 PNG 图层。
- 自动推断 slot。
- 标记警告。
- 导出 `studio.creator-template.v1` manifest。

后续要接：

- 后端存储。
- 图片像素/透明度/尺寸校验。
- 模板审核。
- 画师收益统计。
- Soulidity 链上资产溯源。
