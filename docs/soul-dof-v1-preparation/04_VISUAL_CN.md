# 视觉、画布与适配契约

目标：Complete的作品在Soulidity、Loadout、Showcase、第三方容器一致；装配权利与视觉变换分开。

## 数据合同候选

Scene：source/version、canvasWidth/Height、原点/轴方向、单位、Renderer版本、颜色空间、背景、Outputs、hash。Part/Slot：稳定PartID、语义类别、容量1、坐标系/锚点、允许表示/权限、mask与层策略。Representation：固定Item/Style、RenderPiece列表、内容hash、尺寸/padding/锚点、layer refs、SmartColor声明。Adapter：准确源表示→目标Scene/Slot、转换矩阵与版本、范围/兼容规则、hash。Layout：选中单位的局部dx/dy、等比scale、允许rotation/color、recipeHash/revision。

这些是R1待实现的schema合同，不伪造已存在的标准类型。必须定义浮点到链上定点整数的转换、范围和舍入；禁止JS/UI与Move各自使用不一致量化。

## 渲染顺序

验证准确来源/许可/表示hash → 选目标Adapter → 从源画布坐标映射目标Slot → 应用Creator范围内局部微调 → 按固定层/遮罩/RenderPiece组合 → SmartColor允许色域 → 多Outputs输出及recipeHash。

局部微调不得修改源Style、遮罩或全局层序。以Anchor为变换中心，不让透明padding改变对齐。不同纵横比禁止直接stretch；unsupported没有“看起来差不多”的自动成功状态。

## R1真实验证集

A为现有1024方形多片机器人Maker；B必须是不同尺寸/纵横比/锚点的真实Maker。B未准备与发布，当前演示素材不算B。至少验证同源genesis像素、Free原ID拆下再装、跨Maker适配、Bound卸下重装、颜色联动、透明padding、多片前后遮挡、Empty、不同Outputs、窄屏/高DPI、缺素材/hash错误/旧Renderer。

UI范围、链上数值范围、layout保存读回必须相同。记录真实源/候选/环境/Renderer版本、golden图和观察图、差异区域/容许依据。仅检测文件存在或截图打开不证明视觉一致。

用户可“恢复默认”“预览”“保存微调”；失败保留最后成功recipe与待编辑值，禁止写入无法复现外观的组合。上架前固定准确layout和recipeHash。
