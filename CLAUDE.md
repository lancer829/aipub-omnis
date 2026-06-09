# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 这个项目是什么

**AI Pub（AI 私人会所）** —— 一个 **AI 剧本杀**。玩家建一个场景、选一段剧本、邀请几个 AI 角色，角色围着剧本各怀鬼胎地往下演；玩家扮演**监察者（Overseer）**，可以点名、塞情报、补背景来引导剧情。

形态决定（v0）：**不做像素 2D 场景，用 IM 群聊的 UI**。一个「场景」= 一个群聊；场景图 = 群聊背景/标题图；角色 = 名字 + 头像 + 气泡；监察者通过输入框发消息和 @ 角色来介入。

> 完整概念设计（包含未来的 HD 像素 2D 世界、角色自由走动、上传图→AI 生成像素人等**已推迟到后续**的玩法）见外部文档：
> `D:\File\Obsidian Vault\Alex Wiki Vault\02_Projects\AI Pub\AI Pub - 「AI私人会所」项目概念设计.md`

## 当前状态（重要）

项目**尚未 scaffold**。目录里只有：
- `character-sandbox.jsx` —— 早期原型（**旧设计**：单文件 React，一个「导演大脑」单脑生成所有人台词，Anthropic API，面向小说作者测声线）。**仅作视觉与表单的参考**，群聊台逻辑会按下面的 v0 架构重做。
- `init.md` —— 最初的初始化指令（Vite + React 那套），其中的 **Anthropic API 假设已作废**（见下方后端决定）。

没有 `package.json` / `node_modules` / `.env` / git。第一步是建一个真正的 Vite 工程。

## 技术栈与命令

- React 18 + Vite，纯 JavaScript（不上 TypeScript）
- 样式：inline styles（CSS-in-JS），不引 Tailwind / UI 库
- 持久化：`localStorage`（原型里的 `window.storage` 是 Claude Artifact 专属 API，**本地必须换成 localStorage**）
- LLM 后端：**DeepSeek**（用户只有 DeepSeek / Gemini key，无 Claude key）。DeepSeek 是 **OpenAI 兼容**接口 —— 用 `openai` SDK 指向 `https://api.deepseek.com`，模型如 `deepseek-chat`，env `VITE_DEEPSEEK_API_KEY`。Gemini 作为备选后端。浏览器直连需 `dangerouslyAllowBrowser`。

scaffold 后的常用命令：
```bash
npm create vite@latest . -- --template react   # 在当前目录建工程
npm install
npm install openai                              # DeepSeek 走 OpenAI 兼容 SDK
npm run dev                                      # http://localhost:5173
```

## 核心架构（v0 群聊剧本杀）

三类数据，存 localStorage：
- **角色**：`{ id, name, avatar, color, personality, hobbies, speechStyle, background }` —— 跨场景复用。
- **场景（= 群聊）**：`{ id, name, bgImage, script, cast, messages }`。`script` = 公开故事背景；`cast` = 入场角色 + **每个角色在本场的秘密目标**（per-scene 分配，同一角色在不同剧本可演不同立场）。
- **消息**：`{ id, type: 'overseer'|'character'|'system'|'whisper', speakerName, characterId, content, timestamp }`。

### 对话引擎（不要退回到原型的「单脑」做法）

原型用一次调用让一个模型同时决定谁说话 + 扮演他 + 返回 JSON —— 会串味、轮次发木、JSON 易碎。**v0 改成两段式：**

1. **导演（选人）**：一次轻量调用，判断此刻谁最该开口（仅当玩家点「下一句」而没指定目标时需要）。
2. **演员（生成台词）**：用**那个角色专属的 system prompt** 单独生成一句，**流式**输出。

**节奏 = 一句一停（玩家驱动，无自动连演循环）：**
- 「下一句」按钮 → 导演选人 → 该角色流式说一句。
- `@某角色` → 跳过导演，直接逼该角色说。

### 监察者（Overseer）机制 —— 这是项目的「魂」

- **公开消息**：监察者在输入框发的普通消息 = 对全场说的旁白/补背景，人人可见。
- **私聊（whisper）**：单独拎一个角色塞情报/策反，**其他角色看不到**，只进 TA 的上下文。
- **暴露 twist**：玩家**第一次出任何手** → 全场角色察觉「有只手在操控这个世界」(全局触发) → 之后角色台词可以拐向监察者，主动拉拢/策反/激怒玩家。用一个 `overseerRevealed` 状态位控制，flip 后改变所有角色的 system prompt。

### 上下文隔离（各怀鬼胎的关键）

每个角色调用时，其 system prompt 只包含：**公开剧本 + 该角色自己的秘密目标 + 可见聊天记录 + 只发给 TA 的私聊**。**绝不把别的角色的秘密目标喂给它。** 玩家（监察者）能看到全部，角色之间互相看不到秘密。

## 开发约定与注意

- **保持单文件结构**（核心逻辑写在 `src/App.jsx`，便于快速迭代），与原型一致。
- **无 key 也要能跑**：内置一个「假演员」（本地按人设拼占位台词）作为后端 fallback，让全流程在没有 API key 时也能点起来跑通；接上 DeepSeek 后一处配置切换即可。
- **别用脆弱的 JSON 解析**驱动台词（原型 `JSON.parse(raw.slice(s, e+1))` 的坑）；演员调用直接出纯文本台词，说话人由调用方已知。
- v0 暂不做：删除/导出/重 roll/改句 —— 留作核心循环跑通后的第二轮补丁。
