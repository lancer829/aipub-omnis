# 修改说明：OpenRouter 免费模型 429 → 加退避重试 + 修正错误前缀

## 背景 / 为什么改

- 用户用 OpenRouter 的 `cognitivecomputations/dolphin-mistral-24b-venice-edition:free`（无审查免费模型），App 里频繁报 `DeepSeek 429`。
- 已核实：**模型存在、节点（Venice）健康、playground 能返回、App 的请求调用方式完全正确**（标准 OpenAI 兼容 POST）。
- 真正原因：**免费池的 429 是间歇性 / 概率性的**（错误体里是 `temporarily rate-limited upstream`）。playground 里「点一下没出来、再点就出来」其实是手动重试；而 App 代码**没有任何重试**，第一次拿到 429 就直接 `throw`，整条挂掉。
- 充值 $10 只提升 OpenRouter 侧的「免费模型每日上限」，管不到 Venice 上游的瞬时节流，所以充值没用。
- 附带问题：错误信息里硬编码了 `DeepSeek` 前缀，无论实际用哪个 provider 都显示 DeepSeek，误导排查。

## 改什么

文件：`src/App.jsx`（只动这一个文件，全部集中在 `chatRaw` / `chatStream` 附近，约第 97~132 行）。

共 3 处改动：
1. 新增一个 `provName()`：返回当前 provider 的展示名，替换硬编码的 `DeepSeek`。
2. 新增一个 `fetchRetry()` 包装：对 `429 / 502 / 503` 做指数退避重试（默认 3 次，基准 1200ms，若响应带 `Retry-After` 秒数则优先听它）。
3. `chatRaw` 和 `chatStream` 里的 `fetch(...)` 改成 `fetchRetry(...)`，并把抛错前缀从 `DeepSeek` 换成 `provName()`。

> 注意：`fetchRetry` 安全的前提是请求 body 是字符串（当前代码就是 `JSON.stringify(...)`），重试时可原样复用。流式请求在拿到非 ok 响应时 body 尚未被消费，所以重试也安全。

---

## 改动 1 + 改动 2：在 `const hasKey = () => !!cfg.key();` 之后、`chatRaw` 之前插入新代码，并改写 `chatRaw`

### 找到这段（原始代码）

```js
const hasKey = () => !!cfg.key();

// 返回完整解析后的 JSON（用于调试时看模型到底回了什么）
async function chatRaw(messages, opt = {}) {
  const res = await fetch(`${cfg.proxy()}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.key()}` },
    body: JSON.stringify({ model: cfg.model(), messages, max_tokens: opt.max_tokens || 200, temperature: opt.temperature ?? 0.7, ...(opt.extra || {}), ...cfg.extra(), stream: false }),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { _unparsedBody: text.slice(0, 2000) }; }
  if (!res.ok) { const err = new Error(`DeepSeek ${res.status}`); err.json = json; throw err; }
  return json;
}
```

### 替换为

```js
const hasKey = () => !!cfg.key();
// 当前供应商的展示名（错误信息里用，别再硬写 DeepSeek）
const provName = () => PROVIDERS[cfg.active()?.provider]?.label || 'LLM';

// 免费模型/上游会间歇性 429（也见过 502/503）——这些是"再试一下大概率就过"的瞬时错误。
// 带指数退避重试；若响应给了 Retry-After（秒）就听它的。body 是字符串，重试可安全复用。
const RETRYABLE = new Set([429, 502, 503]);
async function fetchRetry(url, init, { tries = 3, base = 1200 } = {}) {
  let res;
  for (let i = 0; i < tries; i++) {
    res = await fetch(url, init);
    if (res.ok || !RETRYABLE.has(res.status) || i === tries - 1) return res;
    const ra = Number(res.headers.get('retry-after'));
    const wait = Number.isFinite(ra) && ra > 0 ? ra * 1000 : base * 2 ** i;
    await new Promise((r) => setTimeout(r, wait));
  }
  return res;
}

// 返回完整解析后的 JSON（用于调试时看模型到底回了什么）
async function chatRaw(messages, opt = {}) {
  const res = await fetchRetry(`${cfg.proxy()}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.key()}` },
    body: JSON.stringify({ model: cfg.model(), messages, max_tokens: opt.max_tokens || 200, temperature: opt.temperature ?? 0.7, ...(opt.extra || {}), ...cfg.extra(), stream: false }),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { _unparsedBody: text.slice(0, 2000) }; }
  if (!res.ok) { const err = new Error(`${provName()} ${res.status}`); err.json = json; throw err; }
  return json;
}
```

---

## 改动 3：`chatStream` 里同样用 `fetchRetry`，并换错误前缀

### 找到这段（原始代码）

```js
async function chatStream(messages, onToken, opt = {}) {
  const res = await fetch(`${cfg.proxy()}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.key()}` },
    body: JSON.stringify({ model: cfg.model(), messages, max_tokens: opt.max_tokens || 320, temperature: opt.temperature ?? 1.0, ...(opt.extra || {}), ...cfg.extra(), stream: true }),
  });
  if (!res.ok || !res.body) throw new Error(`DeepSeek ${res.status}: ${res.ok ? 'no body' : (await res.text()).slice(0, 180)}`);
```

### 替换为（只改这前 7 行，函数体其余不动）

```js
async function chatStream(messages, onToken, opt = {}) {
  const res = await fetchRetry(`${cfg.proxy()}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.key()}` },
    body: JSON.stringify({ model: cfg.model(), messages, max_tokens: opt.max_tokens || 320, temperature: opt.temperature ?? 1.0, ...(opt.extra || {}), ...cfg.extra(), stream: true }),
  });
  if (!res.ok || !res.body) throw new Error(`${provName()} ${res.status}: ${res.ok ? 'no body' : (await res.text()).slice(0, 180)}`);
```

> `chatStream` 函数 `if (!res.ok ...)` 这行**之后**的所有内容（`res.body.getReader()` 那一大段流式解析）保持原样，不要动。

---

## 验证方式

1. `npm run dev`，设置里激活 OpenRouter 档位、填好 `sk-or-...` key、模型填 `cognitivecomputations/dolphin-mistral-24b-venice-edition:free`。
2. 点「下一句」/ 一键生成，多触发几次。
3. 预期：偶发 429 会被自动退避重试吞掉（最多等约 1.2s + 2.4s），不再第一次就报错；若三次都失败，错误信息显示 `OpenRouter 429`（而不是误导的 `DeepSeek 429`）。

## 备注（非本次改动，供参考）

- 若想彻底躲开免费池 429，可另建一个 OpenRouter 档位用**有付费节点**的弱审查模型兜底，例如 `sao10k/l3.3-euryale-70b`、`nousresearch/hermes-3-llama-3.1-70b`、`mistralai/mistral-nemo`（这些 slug **不要**加 `:free`）。这属于换模型，不在本补丁范围内。
