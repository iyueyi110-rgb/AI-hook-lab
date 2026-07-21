---
name: AI Hook Lab
description: 面向内容创作者的锐利编辑工作台
colors:
  editorial-red: "#E4002B"
  ink: "#171717"
  graphite: "#525252"
  cool-paper: "#F5F5F3"
  surface: "#FFFFFF"
  line: "#D9D9D6"
  success: "#177245"
  warning: "#9A5B00"
typography:
  display:
    fontFamily: "Arial, Noto Sans SC, Microsoft YaHei, sans-serif"
    fontSize: "clamp(2.25rem, 5vw, 4.5rem)"
    fontWeight: 800
    lineHeight: 0.98
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "Arial, Noto Sans SC, Microsoft YaHei, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 750
    lineHeight: 1.15
  body:
    fontFamily: "Arial, Noto Sans SC, Microsoft YaHei, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.65
  label:
    fontFamily: "Arial, Noto Sans SC, Microsoft YaHei, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 700
    lineHeight: 1.3
rounded:
  sm: "6px"
  md: "10px"
  lg: "14px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.editorial-red}"
    textColor: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: "12px 18px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "10px 14px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "12px 14px"
---

# Design System: AI Hook Lab

## Overview

**Creative North Star: "The Editorial Workbench"**

AI Hook Lab 把编辑部的清晰判断力带进创作工具。冷白纸面和石墨文字承载高密度内容，品牌红只用于最重要的动作、选择与强调。界面的张力来自排版比例、列结构和信息先后，而不是背景花纹或视觉特效。

## Product Context

主要用户是需要快速产出、比较并沉淀多平台内容开头的创作者；次要用户是复盘真实操作、评测集、Prompt 版本和 Bad Case 的产品运营者。产品把结构化创作简报、多版 Hook 生成、模型自评分、人工采用与运营复盘连成一个可验证闭环，但不把模型评分解释成真实点击效果。

品牌性格是锐利、克制、可信。界面像专业编辑部的创作台：有明确观点和节奏，但不让装饰抢走内容本身的注意力。

## Product Design Principles

1. 创作任务先于品牌表演：输入、比较与复用始终是最清晰的主路径。
2. 观点来自编辑结构：用排版、信息层级和留白建立识别度，不依赖装饰光效。
3. 模型判断与人工判断分开：任何评分和指标都标明来源与含义。
4. 同一产品、两种密度：创作台强调聚焦，看板强调扫描，但共享同一组件语言。
5. 每个状态都可信：加载、错误、空态、禁用和反馈必须完整且可恢复。

## Accessibility & Inclusion

默认遵循 WCAG AA。所有交互支持键盘和清晰焦点；侧边面板管理焦点并支持 Escape 关闭；动画支持 `prefers-reduced-motion`；移动端保持可读、可触达且不横向溢出，数据表除外并提供明确的横向滚动容器。

系统明确拒绝蓝紫渐变的通用 AI SaaS、霓虹娱乐工具、重复卡片矩阵、方格纸装饰，以及为了展示效果牺牲操作效率的数据大屏。

**Key Characteristics:**
- 冷静纸面上的高对比编辑结构
- 创作台聚焦，看板可扫描
- 少量、明确、可解释的品牌红
- 状态完整且支持键盘操作

## Colors

色彩像编辑校样：冷白纸、石墨字和一支只在关键位置出现的红笔。

### Primary
- **Editorial Red** (`#E4002B`): 主要动作、当前选择、关键数字与品牌识别。

### Neutral
- **Ink** (`#171717`): 标题、正文主信息和高强调边界。
- **Graphite** (`#525252`): 次要说明和元数据。
- **Cool Paper** (`#F5F5F3`): 页面画布，不带米黄或暖纸色偏。
- **Surface** (`#FFFFFF`): 工作区域、表格和面板。
- **Line** (`#D9D9D6`): 分组边界与表格分隔。

### Named Rules
**The Red Pen Rule.** 品牌红在单屏只承担一个视觉焦点；成功、警告和错误使用真实语义色，不把红色当作万能装饰。

## Typography

**Display Font:** Arial / Noto Sans SC / Microsoft YaHei
**Body Font:** Arial / Noto Sans SC / Microsoft YaHei

**Character:** 使用一套可靠无衬线字体，通过字重、宽度和留白建立编辑感。产品标签不使用展示字体，正文始终优先可读。

### Hierarchy
- **Display** (800, `clamp(2.25rem, 5vw, 4.5rem)`, 0.98): 仅用于工作台主标题。
- **Headline** (750, `1.75rem`, 1.15): 页面和主要区域标题。
- **Title** (700, `1rem`, 1.35): 结果条目、面板与指标分组。
- **Body** (400, `0.9375rem`, 1.65): 说明、Hook 正文与分析，长文限制在 72ch。
- **Label** (700, `0.75rem`, 1.3): 控件标签、元数据和状态，不默认全大写或加宽字距。

### Named Rules
**The One Family Rule.** 产品界面只使用一套无衬线字体，通过层级表达性格，不用随意的字体混搭制造“创意”。

## Elevation

界面默认平坦，以画布、表面和细分隔线组织深度。阴影只用于浮层和正在与用户交互的面板，不给每张卡片添加宽而软的装饰阴影。

### Shadow Vocabulary
- **Panel Lift** (`0 18px 48px rgb(23 23 23 / 0.12)`): 侧边面板和移动端底部面板。
- **Control Lift** (`0 6px 18px rgb(23 23 23 / 0.08)`): 仅用于浮动操作或聚焦状态。

### Named Rules
**The Flat-by-Default Rule.** 静止表面依靠色阶和边界分层，阴影只说明真实层级变化。

## Components

### Buttons
- **Shape:** 克制圆角（10px），文字保持单行。
- **Primary:** 红底白字，`12px 18px`，只用于当前页面最重要动作。
- **Hover / Focus:** 150-220ms 颜色变化；焦点使用 2px 墨色外环和 2px 间距。
- **Secondary:** 白底、细边框、墨色文字；Ghost 只用于低优先级工具动作。

### Chips
- **Style:** 未选中为白底细边框，选中为浅红底与红色边框。
- **State:** 只表达筛选、选择或真实状态，不作为装饰标签。

### Cards / Containers
- **Corner Style:** 主要工作区 14px，内部控件 10px。
- **Background:** 白色表面置于冷白画布。
- **Shadow Strategy:** 默认无阴影，参照 Elevation。
- **Border:** 1px `#D9D9D6`。
- **Internal Padding:** 16-24px。

### Inputs / Fields
- **Style:** 白底、10px 圆角、细边框，标签始终位于输入上方。
- **Focus:** 红色边框配低透明度外环，不能只依赖颜色变化。
- **Error / Disabled:** 错误包含文字说明；禁用状态保持可读但明显降低交互感。

### Navigation
- 64px 共享顶栏；当前页面以文字、底线和 `aria-current` 同时表达。移动端允许缩短标签，不隐藏核心页面关系。

### Hook Result Row
- 最佳候选拥有明确但克制的红色标记；其他候选使用紧凑列表。正文、综合分与主操作始终可见，四维评分和理由按需展开。

## Do's and Don'ts

### Do:
- **Do** 使用 `#F5F5F3`、`#FFFFFF` 和 `#171717` 建立清晰表面层级。
- **Do** 让生成、比较、复制、收藏和采用保持在同一视线流中。
- **Do** 明确区分模型评分、人工满意度和数据来源。
- **Do** 为加载、错误、空态、禁用和成功反馈提供完整状态。
- **Do** 在 390px、768px 和 1440px 宽度验证所有主要流程。

### Don't:
- **Don't** 做成蓝紫渐变的通用 AI SaaS 或霓虹娱乐工具。
- **Don't** 堆满相同卡片或重新加入方格纸式装饰背景。
- **Don't** 用宽阴影、玻璃模糊和发光效果替代真实层级。
- **Don't** 为了展示效果牺牲创作者操作效率或把模型分数包装成真实点击效果。
- **Don't** 给每个区域添加大写宽字距 eyebrow 或编号装饰。
