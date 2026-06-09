# 角色沙盒 · Claude Code 初始化指令

## 项目概述

构建一个 AI 驱动的角色扮演工具，供小说作者测试虚构角色的声线和人物关系。
核心体验：创建角色 → 拉进场景 → 像 IM 软件一样让他们对话演绎。

三个核心模块：
角色档案 — 可以上传头像、选主色、填性格/爱好/说话风格/背景故事。数据持久化存储，下次打开还在。
演绎场景 — 把任意N个角色拉进一个「房间」，取个场景名字，进去。
Stage（舞台） — IM风格，底部有个「导演」输入框。你有两种操作模式：

发送旁白/场景描述 → 角色自动回应一轮，然后停
点「▶ 自动」→ 角色持续对话，AI会自己判断谁下一个说话，2秒一轮，直到你按「⏸ 暂停」

对话是怎么工作的： 每次请求都带完整的角色档案 + 全部对话历史，让Claude决定谁发言、说什么。角色声线一致性靠system prompt里的人设卡维持。

---

## 技术栈
仅供参考，可替换
- **框架**: React 18 + Vite
- **语言**: JavaScript（无需 TypeScript）
- **样式**: 纯 CSS-in-JS（inline styles），不引入 Tailwind 或 UI 库
- **持久化**: localStorage
- **AI**: Anthropic API（`claude-sonnet-4-20250514`），需要从环境变量读取 API Key

---

## 初始化步骤

```bash
npm create vite@latest character-sandbox -- --template react
cd character-sandbox
npm install
npm install @anthropic-ai/sdk
```

创建 `.env` 文件：
```
VITE_ANTHROPIC_API_KEY=your_key_here
```

---

## 核心代码

将以下内容完整写入 `src/App.jsx`，**不要拆分成多个组件文件**，保持单文件结构便于后续迭代。

原型代码位于同目录下的 `character-sandbox.jsx`，直接使用，但必须做以下改动：

### 必须修改：Storage 层

将 `window.storage`（Claude Artifact 专属 API）替换为 `localStorage`：

```js
// 替换前（Artifact 专属，本地不可用）
const store = {
  async get(k) {
    try { const r = await window.storage.get(k); return r ? JSON.parse(r.value) : null; }
    catch { return null; }
  },
  async set(k, v) { try { await window.storage.set(k, JSON.stringify(v)); } catch {} }
};

// 替换后（localStorage）
const store = {
  async get(k) {
    try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; }
    catch { return null; }
  },
  async set(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); }
    catch (e) { console.error('Storage error:', e); }
  }
};
```

### 必须修改：API 调用

将 API 调用中的 hardcoded endpoint 替换为通过环境变量获取 Key 的方式：

```js
// 替换前
const res = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ model: 'claude-sonnet-4-20250514', ... })
});

// 替换后（使用 SDK）
import Anthropic from '@anthropic-ai/sdk';
const client = new Anthropic({ apiKey: import.meta.env.VITE_ANTHROPIC_API_KEY, dangerouslyAllowBrowser: true });

const msg = await client.messages.create({
  model: 'claude-sonnet-4-20250514',
  max_tokens: 600,
  system: buildPrompt(...),
  messages: [{ role: 'user', content: '请继续演绎，输出下一句台词的JSON。' }]
});
const raw = msg.content[0].text;
```

---

## 数据结构（供参考，无需修改）

```js
// 角色
{ id, name, avatar, color, personality, hobbies, speechStyle, background }

// 场景（含对话历史）
{ id, name, characterIds: string[], messages: Message[] }

// 消息
{ id, type: 'director'|'character'|'system', speakerName, characterId, content, timestamp }
```

---

## 功能清单（MVP 已实现，待扩展）

### 已实现
- [x] 角色创建：头像上传、主色选择、性格/爱好/说话风格/背景填写
- [x] 角色编辑（点击卡片进入）
- [x] 创建演绎场景（任意选N个角色）
- [x] 导演模式：发送旁白/场景描述
- [x] 自动演绎：AI判断谁发言，2秒一轮，可随时暂停
- [x] 对话历史持久化

### 待扩展（优先级排序）
1. **删除角色 / 删除场景**（目前无法删除）
2. **导出对话为 Markdown**（用于 Obsidian 存档）
3. **手动触发下一轮**（当前发送导演指令会自动触发，有时不需要）
4. **重新生成最后一句**（导演觉得角色声线不对时用）
5. **场景初始化提示词**（创建场景时可以预设一段背景描述）
6. **多导演 / 协作模式**（暂缓）

---

## 运行

```bash
npm run dev
```

打开 `http://localhost:5173` 即可。
