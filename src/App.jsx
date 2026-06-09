import { useState, useEffect, useRef } from 'react';

// ─── 字体 / 调色板（暖光会所 · 奶油金）─────────────────────────────────────────
// 中文交给系统里干净的黑体；衬线只给英文 / 数字。全系统字体，秒加载、不卡。
const FONT = '"PingFang SC", "Microsoft YaHei", "Noto Sans SC", "Hiragino Sans GB", system-ui, -apple-system, sans-serif';
const SERIF = 'Georgia, "Times New Roman", "Songti SC", serif';
const MONO = '"SF Mono", "Cascadia Code", Consolas, "Courier New", monospace';

const C = {
  bg: '#FAF6EF', bg2: '#F3ECDD',
  surface: '#FFFFFF', surfaceAlt: '#FBF8F1',
  border: '#E9E1D2', borderStrong: '#DBCFB9',
  gold: '#B0843A', goldBtn: '#C99A3C', goldInk: '#936A24', goldSoft: '#FBF3E2',
  text: '#2B2620', text2: '#776E60', text3: '#A89E8C',
  rose: '#B0566A', green: '#4F8A4D', violet: '#7A5BA6',
};
const COLORS = ['#B0843A', '#7A5BA6', '#2F8E94', '#C0556A', '#4E8C4A', '#C0703C', '#3E6FB0', '#A8508C'];

const genId = () => Math.random().toString(36).slice(2, 10);
const hm = () => new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = (a) => a[Math.floor(Math.random() * a.length)];

// ─── 持久化（localStorage）──────────────────────────────────────────────────
const store = {
  get(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { console.error('storage', e); } },
};

// IndexedDB：给"大块头"（角色 / 剧情）用，容量比 localStorage 的 ~5MB 大几个数量级。设置（key/model）仍走上面的 store。
const idb = {
  _p: null,
  open() {
    if (!this._p) this._p = new Promise((resolve, reject) => {
      const req = indexedDB.open('aipub', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this._p;
  },
  async get(k) {
    try {
      const db = await this.open();
      return await new Promise((resolve) => {
        const r = db.transaction('kv', 'readonly').objectStore('kv').get(k);
        r.onsuccess = () => resolve(r.result ?? null);
        r.onerror = () => resolve(null);
      });
    } catch { return null; }
  },
  async set(k, v) {
    try {
      const db = await this.open();
      await new Promise((resolve, reject) => {
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(v, k);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (e) { console.error('idb set', e); }
  },
};

// ─── 模型配置（多档位 · 各家都是 OpenAI 兼容；无 key 则用假演员）─────────────────
// 一个"档位"= 一套 { id, label, provider, model, key, extra }。provider 决定走哪条 dev 代理（避开 CORS）。
// 想加新供应商：在这里加一条，并在 vite.config.js 加同名代理。
const PROVIDERS = {
  deepseek:   { label: 'DeepSeek',   proxy: '/deepseek',   modelPh: 'deepseek-chat',                modelHint: 'deepseek-chat / deepseek-reasoner',                  keyPh: 'sk-...' },
  openrouter: { label: 'OpenRouter', proxy: '/openrouter', modelPh: 'anthropic/claude-3.7-sonnet',  modelHint: '模型名带斜杠，如 openai/gpt-4o-mini、google/gemini-2.0-flash-001', keyPh: 'sk-or-...' },
  gemini:     { label: 'Gemini',     proxy: '/gemini',     modelPh: 'gemini-2.0-flash',             modelHint: 'gemini-2.0-flash / gemini-2.5-pro（Google 官方 OpenAI 兼容端点）', keyPh: 'AIza...' },
  custom:     { label: '自定义',     proxy: null,          modelPh: 'gpt-4o-mini',                  modelHint: '任意 OpenAI 兼容服务，下方填接口地址。浏览器直连，需对方允许跨域（CORS）——本地 Ollama/LM Studio、OpenRouter 等可用', keyPh: '（按你的服务，可留空）' },
};
const PROVIDER_ORDER = ['deepseek', 'openrouter', 'gemini', 'custom'];

// 读取/规整模型档位存档；首次自动从旧的单档配置（aipub-key/model/extra）迁移过来
function loadModels() {
  const m = store.get('aipub-models');
  if (m && Array.isArray(m.profiles) && m.profiles.length) {
    return { profiles: m.profiles, activeId: m.profiles.some((p) => p.id === m.activeId) ? m.activeId : m.profiles[0].id };
  }
  const profiles = [{ id: genId(), label: 'DeepSeek', provider: 'deepseek', model: localStorage.getItem('aipub-model') || 'deepseek-chat', key: (localStorage.getItem('aipub-key') || '').trim(), extra: localStorage.getItem('aipub-extra') || '' }];
  const data = { profiles, activeId: profiles[0].id };
  store.set('aipub-models', data);
  return data;
}
const saveModels = (data) => store.set('aipub-models', data);

const cfg = {
  active: () => { const m = loadModels(); return m.profiles.find((p) => p.id === m.activeId) || m.profiles[0] || null; },
  provider: () => cfg.active()?.provider || 'deepseek',
  // 完整的 chat/completions 地址：预设供应商走 dev 代理；自定义档位直连用户填的 baseUrl
  url: () => {
    const p = cfg.active();
    if (p?.provider === 'custom' && p.baseUrl) return `${p.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    return `${PROVIDERS[p?.provider]?.proxy || '/deepseek'}/chat/completions`;
  },
  // 档位里的 key 优先；DeepSeek 档位留空时回退到 env（VITE_DEEPSEEK_API_KEY）
  key: () => { const p = cfg.active(); return ((p && p.key) || (p?.provider === 'deepseek' ? import.meta.env.VITE_DEEPSEEK_API_KEY : '') || '').trim(); },
  model: () => cfg.active()?.model || 'deepseek-chat',
  // 该档位的额外请求参数（JSON），原样并入请求体。用来关思考等。非法 JSON 忽略。
  extra: () => { try { return JSON.parse(cfg.active()?.extra || '{}') || {}; } catch { return {}; } },
};
// 是否具备真实调用条件：自定义端点（本地 Ollama/LM Studio 常无需 key）只要填了 baseUrl 即可
const hasKey = () => { const p = cfg.active(); return p?.provider === 'custom' ? !!p.baseUrl : !!cfg.key(); };
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
  const res = await fetchRetry(cfg.url(), {
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

// 从返回里尽量把"台词内容"抠出来：content 为空时兜底看 content 数组 / reasoning_content
function pickContent(json) {
  const m = json?.choices?.[0]?.message;
  if (!m) return '';
  if (typeof m.content === 'string') return m.content;
  if (Array.isArray(m.content)) return m.content.map((p) => (typeof p === 'string' ? p : p?.text || '')).join('');
  return ''; // 只取最终答案 content；绝不回退到 reasoning_content（那是思考过程，不是答案）
}

async function chatOnce(messages, opt = {}) {
  return pickContent(await chatRaw(messages, opt));
}

async function chatStream(messages, onToken, opt = {}) {
  const res = await fetchRetry(cfg.url(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.key()}` },
    body: JSON.stringify({ model: cfg.model(), messages, max_tokens: opt.max_tokens || 320, temperature: opt.temperature ?? 1.0, ...(opt.extra || {}), ...cfg.extra(), stream: true }),
  });
  if (!res.ok || !res.body) throw new Error(`${provName()} ${res.status}: ${res.ok ? 'no body' : (await res.text()).slice(0, 180)}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', full = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split('\n');
    buf = parts.pop();
    for (const line of parts) {
      const t = line.trim();
      if (!t.startsWith('data:')) continue;
      const data = t.slice(5).trim();
      if (data === '[DONE]') continue;
      try { const d = JSON.parse(data).choices?.[0]?.delta?.content; if (d) { full += d; onToken(full); } } catch { /* partial */ }
    }
  }
  return full;
}

// ─── 一键生成（AI 随机角色 / 随机场景）──────────────────────────────────────────
function parseJSON(text) {
  if (!text) return null;
  const t = String(text).replace(/```json/gi, '').replace(/```/g, '');
  const s = t.indexOf('{'), e = t.lastIndexOf('}');
  if (s < 0 || e < 0) return null;
  try { return JSON.parse(t.slice(s, e + 1)); } catch { return null; }
}

const MOCK_CHARS = [
  { name: '方承', personality: '表面温和、心思极深，惯于在沉默里观察别人', hobbies: '下围棋、收集旧钢笔', speechStyle: '慢条斯理，话里有话', background: '退休法官，手里攥着一桩没结的旧案。他来这儿，是为了亲手了结。' },
  { name: '苏黎', personality: '伶牙俐齿、咄咄逼人，用攻击掩饰心虚', hobbies: '调酒、看人脸色', speechStyle: '又快又辣，爱反问', background: '酒吧老板娘，知道太多人的秘密，也欠着一个还不清的人情。' },
  { name: '陆沉', personality: '沉默寡言、身手利落，眼神里全是戒备', hobbies: '擦枪、长跑', speechStyle: '惜字如金，多用短句', background: '退伍后做了保镖，护过的人死了一个，他始终不信那是意外。' },
  { name: '念安', personality: '柔弱外表下藏着惊人的固执与算计', hobbies: '插花、写日记', speechStyle: '轻声细语，常用省略号', background: '名义上的遗孀，所有人都同情她，可只有她知道丈夫死得不冤。' },
];
const MOCK_SCENES = [
  { name: '雪夜 · 卡住的缆车', script: '暴雪夜，一节缆车卡在半山腰，几个素不相识的人被困其中。十分钟前灯灭了三秒，再亮时地上多了一摊血，而每个人都说自己什么都没看见。' },
  { name: '停摆的钟表铺', script: '老钟表匠暴毙在自己反锁的店里，临终前把店里所有钟都拨到了同一刻。今夜，几个和他有过节的人，恰好都收到了一张没有署名的请柬。' },
  { name: '末班地铁 · 第十三节', script: '末班地铁多了一节本不该存在的车厢。门一关，外面的站台再没出现过。车厢里的人开始发现，彼此并非陌生——他们的人生，早被同一个人改写过。' },
];

// 给生成器撒"随机种子"，逼模型每次从不同起点出发，避免老是吐同一个默认答案
const SEED_ROLES = ['过气的歌剧演员', '走方的江湖郎中', '殡仪馆化妆师', '赌场荷官', '退役拳击手', '古董钟表修复师', '深夜电台主播', '落魄的私家侦探', '豪宅里的钟点女佣', '拆迁队包工头', '宠物殡葬师', '失明的钢琴调音师', '黑市文物掮客', '戒毒所的年轻医生', '马戏团驯兽师', '写讣告的报社记者', '给富人当替身的演员', '守灯塔的人'];
const SEED_HOOKS = ['背着一桩没人知道的旧命案', '在暗中寻找多年前失踪的至亲', '为一笔还不清的旧债而来', '手里攥着能毁掉某人的把柄', '顶着一个精心编造的假身份', '在赎一桩再也无法挽回的错', '要替一个死去的人讨个说法', '怀疑自己其实是被顶替的那个人', '带着一样绝不能被发现的东西', '只想在天亮前从这里脱身'];
const SEED_PLACES = ['暴雪封山的温泉旅馆', '失去动力的跨海邮轮', '深夜不再发车的末班地铁', '断了网与电话的孤岛别墅', '拆迁前夜的老剧院后台', '大雾锁死的高速服务区', '停在最高点的摩天轮顶舱', '只剩一桌客人的深夜食堂', '信号全无的地下避难所', '被洪水围住的乡间祠堂'];
const SEED_INCIDENTS = ['一具体温尚存的尸体', '一封点名了在场每个人的匿名信', '一笔凭空消失的巨款', '一段拍到了不该拍的画面的录像带', '一通怎么也打不出去的报警电话', '一个本不该出现在这里的人', '一份所有人都想烧掉的旧档案', '一声谁也说不清来源的枪响'];

async function genCharacter(existingNames = []) {
  if (!hasKey()) return { data: pick(MOCK_CHARS), src: 'mock' };
  const sys = '你是一个角色设定生成器。生成一个适合"剧本杀 / 群像悬疑"的、有戏剧张力的虚构人物。只输出一个 JSON 对象，不要任何额外文字、不要 markdown 代码块。字段：name(中文名)、personality(性格特征)、hobbies(兴趣爱好)、speechStyle(说话风格)、background(人物背景：经历、动机、一个能制造冲突的秘密，2~4 句)。';
  const user = `生成一个**新**人物：职业大致是「${pick(SEED_ROLES)}」，TA ${pick(SEED_HOOKS)}。在此之上自由发挥，给一个有新意、不落俗套的名字——别用"沉默 / 沈默 / 无名"这类太直白的名字，也别和这些重复：${existingNames.length ? existingNames.join('、') : '（无）'}。要有鲜明性格和一个能引发冲突的秘密。`;
  const parsed = parseJSON(await chatOnce([{ role: 'system', content: sys }, { role: 'user', content: user }], { max_tokens: 1024, temperature: 1.2 }));
  return (parsed && parsed.name) ? { data: parsed, src: 'ai' } : { data: pick(MOCK_CHARS), src: 'fail' };
}

async function genScene(genreId) {
  if (!hasKey()) return { data: pick(MOCK_SCENES), src: 'mock' };
  const g = GENRES[genreId];
  // 非悬疑题材：那套 SEED_PLACES/INCIDENTS（暴雪封山、尸体、匿名信…）全是黑色调，不能用。改由 genre 基调驱动。
  if (g && genreId !== 'suspense') {
    const sys = `你是一个「${g.label}」题材的剧本场景生成器。${g.tone}\n只输出一个 JSON 对象，不要任何额外文字、不要 markdown 代码块。字段：name(场景名，简短有氛围)、script(公开故事背景，3~5 句：地点、人物此刻的处境、刚发生了什么、众人正在做什么；要把几个人自然地聚在一处，给出契合该题材的开场氛围与一点小引子)。`;
    const user = `随机生成一个**新颖**、紧贴「${g.label}」基调的场景。别落俗套。`;
    const parsed = parseJSON(await chatOnce([{ role: 'system', content: sys }, { role: 'user', content: user }], { max_tokens: 1024, temperature: 1.2 }));
    return (parsed && (parsed.script || parsed.name)) ? { data: parsed, src: 'ai' } : { data: pick(MOCK_SCENES), src: 'fail' };
  }
  const sys = '你是一个剧本杀场景生成器。生成一个适合一桌人各怀鬼胎、互相试探的悬疑 / 群像场景。只输出一个 JSON 对象，不要任何额外文字、不要 markdown 代码块。字段：name(场景名，简短有氛围)、script(公开故事背景，3~5 句：地点、处境、刚发生了什么、要解决什么；要把众人困在一处、制造怀疑与利害冲突)。';
  const user = `随机生成一个**新颖**的场景：地点是「${pick(SEED_PLACES)}」，刚刚出现了「${pick(SEED_INCIDENTS)}」。把众人困在这里、制造怀疑与利害冲突，要有张力、有谜团。`;
  const parsed = parseJSON(await chatOnce([{ role: 'system', content: sys }, { role: 'user', content: user }], { max_tokens: 1024, temperature: 1.2 }));
  return (parsed && (parsed.script || parsed.name)) ? { data: parsed, src: 'ai' } : { data: pick(MOCK_SCENES), src: 'fail' };
}

// ─── 提示词构建 ──────────────────────────────────────────────────────────────
// 监察者已暴露时，追加到角色 system prompt 的"觉察"块
function overseerBlock() {
  return `

【监察者觉察 · 重要】你已经察觉到一件颠覆认知的事：这个世界之上，有一只看不见的手——一位「监察者」。它不是在场任何人，却能操纵这里的一切：让你突然开口、让你闭嘴、把情报塞进别人脑子、凭空改写局势。那种"被注视、被摆布"的感觉是真实而不安的——**绝不要假装无事发生**。
请让这份觉察真切地影响你（依你的性格而定）：可能是脊背发凉的恐惧、被冒犯的愤怒、猎人般的警觉、或强自镇定地出言试探。你甚至可以直接对它说话、质问它、或反过来诱它入局。
与此同时你也在盘算：既然它能左右这里，能不能为我所用？为达成你的秘密目标，你可以试图引诱、拉拢、欺骗、激怒或策反这位监察者。
若它曾私下对你说话，那感觉就像一个声音直接钻进你脑子——它似乎知道你的秘密。你"听见了，但未必照做"，按你的目标判断要不要利用。`;
}

const ACTOR_OUTPUT_RULES = `

【输出要求】
- 你不仅能说话，也能**行动**：移动、拿取 / 交出 / 藏匿物品、搜查、出手、与场景 / 物件 / 他人 / 监察者互动……只要符合你的动机即可，不受限制。可以只说一句、只做一个动作、或边做边说。
- 动作写成简短叙述（一两句），台词照常；整体约 1~4 句，口语化，紧贴你的说话风格。
- 不要写名字前缀、不要加引号、不要解释、不要替别人接话。
- 你是会权衡利害的**活人**，不是抵死不认的机器：本能会隐瞒，但当证据压到无可抵赖、或死扛对你更不利时，你会动摇——避重就轻、攀咬真正的元凶、跟人做交易、或干脆崩溃认账。**绝不要为了死不认账，而无限编造新谎言、新人物、新情节去圆。** 撑不住时，就像真人一样裂开。
- 推动剧情，回应在场的人与刚发生的事，别空泛地重复别人已经说过的话。`;

function actorSystem(sp, goal, scene, chars) {
  const everyone = [...scene.cast.map((c) => chars.find((x) => x.id === c.characterId)), ...(scene.extras || [])].filter(Boolean);
  const deadNames = everyone.filter((c) => isOut(scene, c.id)).map((c) => c.name).join('、');
  const deadLine = deadNames ? `\n【已死亡 / 已离场】${deadNames}（他们不会再开口、也不在场——别再当他们还活着一样与之对话。）` : '';
  const others = everyone.filter((c) => c.id !== sp.id && !isOut(scene, c.id)).map((c) => c.name).join('、') || '（暂无其他人）';
  const visible = visibleStatusLine(scene, everyone, sp.id); // 昏迷/受制/潜行 等公开可见状态
  // 私聊 = 地基级的隐秘记忆，必须永久保留（不能像普通对话那样被滚动窗口裁掉）
  const myWhispers = scene.messages.filter((m) => m.type === 'whisper' && m.whisperTo === sp.id).map((m) => `- ${m.content}`);
  const whisperMemory = myWhispers.length ? `\n\n【只有你知道的事 · 监察者私下对你说过的（你的隐秘记忆，自始至终都作数，绝不会忘）】\n${myWhispers.join('\n')}` : '';

  if (sp.ephemeral) {
    let s = `你就是【${sp.name}】——一个刚刚出现、或刚被人提到的人。下面这一切是你正在亲历的真实处境，不是游戏、不是表演。${genreFrame(scene)}你之前没有被详细设定，请根据眼前的处境推断你是谁、为何出现、有何目的，并保持前后一致。你只能决定自己的言行，绝不替别人说话或写旁白。

【你眼前的处境（人人都知道的）】
${scene.script || '（暂无设定，自由发挥）'}

【在场的人】${others}${visible}${deadLine}${whisperMemory}${selfStateBlock(scene, sp.id)}`;
    s += genreToneBlock(scene);
    if (scene.overseerRevealed) s += overseerBlock();
    return s + ACTOR_OUTPUT_RULES;
  }

  let s = `你就是【${sp.name}】。下面这一切，是你正在亲历的真实处境——不是游戏、不是表演，是真的在发生；${genreFrame(scene)}你只能决定自己的言行，绝不替别人说话，也不写旁白或解说。

【你是谁】
姓名：${sp.name}
性格：${sp.personality || '（未填）'}
爱好：${sp.hobbies || '（未填）'}
说话风格：${sp.speechStyle || '（未填）'}
你的过往：${sp.background || '（未填）'}

【你藏在心底的秘密目的】（只有你知道，绝不直接说破，要靠言行去达成）
${goal || '（你眼下没有特别的图谋，按你的性子自然应对即可）'}

【你眼前的处境（人人都知道的）】
${scene.script || '（暂无设定，自由发挥）'}

【在场的人】${others}（你并不知道他们各自的秘密目的）${visible}${deadLine}${whisperMemory}${selfStateBlock(scene, sp.id)}`;
  s += genreToneBlock(scene);
  if (scene.overseerRevealed) s += overseerBlock();
  return s + ACTOR_OUTPUT_RULES;
}

function recentSpeakers(scene, n = 6) {
  const names = scene.messages.filter((m) => m.type === 'character').slice(-n).map((m) => m.speakerName);
  return names.length ? names.join(' → ') : '（还没人开口）';
}

function dmSystem(scene, cast) {
  const roster = cast.map((c) => c.ephemeral
    ? `- ${c.name}（临时登场，无预设秘密）`
    : `- ${c.name}（${c.personality || '未填'}）｜秘密目标：${c.goal || '无'}`).join('\n');
  return `你是一场「AI 剧本杀」的导演 / DM。每一拍，你只做三选一的决定，并严格按格式输出一行：

SPEAK: 名字 ｜ 选人理由（为什么此刻轮到 TA：≤15 字极简说明。**绝不替角色写台词、不写任何引号里的话**）
EVENT: 一句话描述发生了什么   —— 让世界里"真的发生一件事"（灯灭、有人捂喉倒下、保险柜被发现打开、楼上枪响、有人闯入…），在张力到顶时砸一记重锤、逼所有人重新反应
CURTAIN: 一句话              —— 只有当冲突已经爆发、故事自然走到尽头时，才宣布落幕

【判断原则】
· 选 SPEAK 时：被点名/挑衅/戳痛的人优先接话；利害最深的人跳出来；别机械轮流。最近发言：${recentSpeakers(scene, 6)} —— 别顺着轮。
· 点人前先掂量他此刻"能不能、愿不愿开口"：从剧情看，已死亡 / 昏迷 / 被打晕 / 被带走 / 被制服 / 或正刻意沉默拒绝开口的人——别点他们，把发言权给别人；除非剧情让他恢复了能力或意愿。
· 理由只说"为什么是 TA"，绝不替角色发挥台词。
· 若监察者刚刚出手（当众发话 / 私下找了某人 / 抛出事件），优先让被波及的那个人立刻有所反应。
· 名单里标了"临时登场"的是中途出现的人物，你同样可以点他们说话。
· EVENT 是把局面搅大的重锤；该砸的时候别犹豫（关键证据曝光、有人倒下、退路被断…），剧情平稳时再 SPEAK。
· 冲突还没顶点、该说的还没说，绝对不要 CURTAIN——宁可让它再演几轮。
· 若下方有【导演密本】，那是你的私密剧本：在合适时机用 EVENT / CURTAIN 把剧情往里面预设的关键事件、结局条件上引导。密本内容绝不能泄露给任何角色。
· 推动收束：当冲突已基本摊上台面、某个角色被逼到墙角时，果断点他 / 抛事件逼他摊牌，别让对峙无限空转。
${genreToneBlock(scene)}
【故事背景】
${scene.script || '（无）'}
${scene.dmScript ? `\n【导演密本 · 仅你可见，角色绝不知道】\n${scene.dmScript}\n` : ''}
【角色与秘密（仅你可见）】
${roster}${dmStateRoster(scene, cast)}

【最近剧情（含监察者私下动作，仅你可见）】
${dmTranscript(scene, 14)}`;
}

function publicTranscript(scene, n = 40) {
  const lines = scene.messages
    .filter((m) => m.type === 'character' || m.type === 'overseer' || m.type === 'system' || m.type === 'event')
    .map((m) => m.type === 'character' ? `${m.speakerName}：${m.content}`
      : m.type === 'overseer' ? `【监察者·对全场】：${m.content}`
        : m.type === 'event' ? `【突发事件】${m.content}`
          : `（${m.content}）`);
  const tail = lines.slice(-n);
  return tail.length ? tail.join('\n') : '（剧情刚开始，还没有人开口）';
}

function actorTranscript(scene, forId, n = 40) {
  const lines = scene.messages.map((m) => {
    if (m.type === 'character') return `${m.speakerName}：${m.content}`;
    if (m.type === 'event') return `【突发事件】${m.content}`;
    if (m.type === 'curtain') return `（落幕旁白）${m.content}`;
    if (m.type === 'overseer') return `【监察者·对全场】：${m.content}`;
    if (m.type === 'whisper') return null; // 私聊不再进滚动窗口：改由角色 system 的"隐秘记忆"块永久保留，避免被裁掉而遗忘
    if (m.type === 'system') return `（${m.content}）`;
    return null;
  }).filter(Boolean);
  const tail = lines.slice(-n);
  return tail.length ? tail.join('\n') : '（剧情刚开始，还没有人开口。由你来开场。）';
}

// 导演（上帝视角）的剧情记录：额外包含监察者的私下动作，好让它判断该让谁反应
function dmTranscript(scene, n = 14) {
  const lines = scene.messages.map((m) => {
    if (m.type === 'character') return `${m.speakerName}：${m.content}`;
    if (m.type === 'event') return `【突发事件】${m.content}`;
    if (m.type === 'overseer') return `【监察者·当众】：${m.content}`;
    if (m.type === 'whisper') return `【监察者·私下找了${m.whisperToName || '某人'}】：${m.content}`;
    if (m.type === 'system') return `（${m.content}）`;
    return null;
  }).filter(Boolean);
  const tail = lines.slice(-n);
  return tail.length ? tail.join('\n') : '（剧情刚开始）';
}

// ─── 引擎：导演选人 + 角色生成（真模型 / 假演员）──────────────────────────────
// 兜底/假演员用的启发式选人：被点名者优先、不让人自答、否则在"较久没说的那半边"里随机
function heuristicPick(scene, cast) {
  const msgs = scene.messages;
  const last = [...msgs].reverse().find((m) => m.type === 'character' || m.type === 'overseer' || m.type === 'whisper');
  const lastSpeakerId = last && last.type === 'character' ? last.characterId : null;
  const lastText = last ? (last.content || '') : '';
  let pool = cast.filter((c) => c.id !== lastSpeakerId);
  if (pool.length === 0) pool = cast.slice();
  const addressed = pool.filter((c) => lastText.includes(c.name));
  if (addressed.length) return pick(addressed).id;
  if (last && last.type === 'whisper') {
    const t = pool.find((c) => c.id === last.whisperTo);
    if (t && Math.random() < 0.7) return t.id;
  }
  const lastIdx = {};
  msgs.forEach((m, i) => { if (m.type === 'character' && m.characterId) lastIdx[m.characterId] = i; });
  const sorted = [...pool].sort((a, b) => (lastIdx[a.id] ?? -1) - (lastIdx[b.id] ?? -1));
  const half = sorted.slice(0, Math.max(1, Math.ceil(sorted.length / 2)));
  return pick(half).id;
}

const MOCK_EVENTS = [
  '灯毫无征兆地全灭了，几秒后才重新亮起——有人的位置变了。',
  '楼上传来一声闷响，像什么重物倒地。',
  '一只酒杯从桌沿滑落，在死寂里摔得粉碎。',
  '窗外的暴雨毫无预兆地停了，整座屋子安静得反常。',
  '所有人的手机同时震动了一下——可这里早已没了信号。',
];

// 监察者可强势抛出的预设事件（k 标签 / t 一句话 / d 给 DM 的方向指令）
const EVENT_PRESETS = [
  { k: '停电黑暗', t: '灯全灭，恢复时有东西变了', d: '突然全场停电陷入黑暗，恢复光亮时，某样东西变了——有人移动了位置、有东西不见了、或有人受了伤。' },
  { k: '有人倒下', t: '某人突发不适、疑似中毒', d: '在场某个角色突然身体不适、出现中毒征兆或骤然倒地，制造紧迫与互相猜忌，但先不要直接判定死亡。' },
  { k: '致命证据曝光', t: '能指证某人的铁证出现', d: '一份能直接指证某人的关键证据突然摊在所有人面前（文件、照片、录音或物证），逼相关者当场反应。' },
  { k: '不速之客', t: '意外的人/声音闯入', d: '一个意料之外的人、声音或敲门声闯入，打破当前对峙，带来新的威胁或新的信息。' },
  { k: '退路被断', t: '逃离的可能被彻底切断', d: '逃离的可能被彻底切断——桥塌、信号断、门被锁死或车被毁，所有人被逼进更密闭的绝境。' },
  { k: '时限逼近', t: '出现迫在眉睫的倒计时', d: '出现一个迫在眉睫的倒计时（毒发、天亮、有人即将赶到、火势蔓延），逼所有人加速摊牌。' },
];

// 监察者可强势收场的预设终局
const ENDING_PRESETS = [
  { k: '真相大白', t: '秘密揭穿，尘埃落定', d: '所有隐藏的秘密被一一揭穿，真相摊在所有人面前，尘埃落定。' },
  { k: '玉石俱焚', t: '同归于尽，没有赢家', d: '冲突彻底爆发，以同归于尽 / 两败俱伤收场，没有任何赢家。' },
  { k: '各自逃散', t: '局面失控，无人胜出', d: '局面彻底失控，众人在混乱中各奔东西，没有结论，只剩逃离。' },
  { k: '尘埃落定·和解', t: '伤痕之后，达成谅解', d: '在最坏的边缘，众人达成某种谅解或共谋，带着伤痕走向新的开始。' },
  { k: '开放悬念', t: '戛然而止，余味未尽', d: '在最关键的一刻戛然而止，留下一个没有答案的悬念，余味未尽。' },
];

// ─── 题材基调（genre → 基调 + 现实框架 + 事件口味 + 预设事件/终局）────────────────
// 同一套角色，换一个 genre 就换一套"世界规则"。模型写虚构时有"好故事=有张力"的强先验，
// 不给约束就会把任何剧本往黑色叙事拽（甜恋被演成悬疑）。这张表就是那条缰绳。
// · frame  —— 替换 actor prompt 里"这里的危险/死亡都是真的"那句，定义本场的"现实代价"
// · tone   —— 贯穿 actor / DM 的基调指令
// · eventHint —— 喂给事件生成器，决定"突发事件"往哪个方向写
// · events / endings —— 监察者手动抛事件 / 落幕的预设菜单（缺省回退到悬疑那套）
// 默认（无 genre / suspense）= 旧行为，老存档不受影响。
const GENRE_ORDER = ['suspense', 'sweet', 'battle', 'palace', 'comedy', 'healing'];
const GENRES = {
  suspense: {
    label: '悬疑', emoji: '🕵️',
    frame: '这里的危险、死亡、罪与罚都是真的，会有真实的后果。',
    tone: '这是一部悬疑剧。基调紧张、猜疑暗涌，人人都有所隐瞒。围绕真相、利害与背叛展开，可以制造伏笔、试探与危机感。',
    eventHint: '事件偏暗：揭露线索、制造紧迫、动摇信任——停电、证据曝光、有人倒下、退路被断之类。',
    attributes: [{ key: 'suspicion', label: '嫌疑', emoji: '🔍', default: 0, min: 0, max: 100 }],
    // events / endings 缺省 → 回退到上面的 EVENT_PRESETS / ENDING_PRESETS
  },
  sweet: {
    label: '甜恋', emoji: '🍬',
    frame: '这里的心动、脸红、悸动都是真的，你真的身处其中——但没有谁会真的受伤。',
    tone: '这是一部轻松甜恋剧。基调温暖、明亮、心动。不要制造悬疑、危机、伤亡或不祥预兆；冲突最多到害羞、吃醋、笨拙的误会，并且很快就和解。把心思放在暧昧、关心和那些小小的心动上。',
    eventHint: '事件偏甜：制造心动与糗况——递错的情书、共撑一把伞、突降小雨后躲进同一屋檐、撞个满怀、宠物乱入、被分到同一组。绝不出现血、死亡、断裂、威胁或任何不祥。',
    attributes: [{ key: 'affinity', label: '好感度', emoji: '💗', default: 10, min: 0, max: 100 }],
    events: [
      { k: '命运的碰撞', t: '两人撞个满怀', d: '让两个角色在毫无防备时撞个满怀、或同时伸手去拿同一样东西，制造一个脸红的近距离瞬间。' },
      { k: '突降小雨', t: '被迫共处一处', d: '一场突如其来的小雨（或末班车开走、停电片刻）把某些人困在同一屋檐下，气氛微妙又暧昧。' },
      { k: '被撞破的心事', t: '暗恋当众被点破', d: '某个角色藏着的小心思被旁人无意间说破或撞见，全场起哄，当事人无处遁形。' },
      { k: '一点点醋意', t: '有人悄悄吃味了', d: '出现一个让人吃醋的小插曲——另有暧昧对象现身、一份没署名的礼物，让某人忍不住酸了一下。' },
    ],
    endings: [
      { k: '两情相悦', t: '心意互通，甜到圆满', d: '误会冰释，两颗心终于对上了频率，以一个甜蜜而圆满的瞬间收尾。' },
      { k: '勇敢告白', t: '有人鼓起勇气说出口', d: '某个角色终于鼓起勇气，把藏了很久的心意说出口，无论结果都坦荡而美好。' },
      { k: '暧昧未满', t: '差一点点，余韵悠长', d: '两人之间始终差着那临门一脚，在最甜的暧昧里戛然而止，留下满满余韵。' },
      { k: '青春纪念', t: '笑闹一场，温柔收尾', d: '没有谁最终和谁在一起，可这段笑闹与温柔，成了每个人心里珍藏的一页。' },
    ],
  },
  battle: {
    label: '大逃杀', emoji: '🔪',
    frame: '这里只有一个人能活着离开。死亡是真实而最终的，你的每一个选择都关乎生死。',
    tone: '这是一部大逃杀。规则只有一条：活到最后。信任是奢侈品，结盟随时会翻脸。你必须为活下去而算计、试探、抢夺、背叛——和气与退让在这里等于送死。绝不要提议"大家一起和平解决"，那等于认输。',
    eventHint: '事件偏狠：安全区缩小、补给只剩一份、广播宣布出局倒计时、武器出现、有人已经先动了手。逼所有人加速厮杀，不作为就要付出代价。',
    attributes: [{ key: 'hp', label: '体力', emoji: '❤️', default: 100, min: 0, max: 100 }, { key: 'gear', label: '武装', emoji: '🔪', default: 0, min: 0, max: 5 }],
    events: [
      { k: '安全区缩小', t: '死亡逼近，必须移动', d: '安全区骤然缩小（毒雾 / 塌方 / 上涨的水位逼来），所有人被迫离开当前位置、彼此靠近，冲突一触即发。' },
      { k: '唯一的补给', t: '只够一人的资源出现', d: '一份只够一个人活命的关键补给（解药 / 钥匙 / 最后的食水）出现在众人面前，没人愿意让出。' },
      { k: '出局广播', t: '倒计时开始，须有人出局', d: '一道冰冷的广播宣布：限定时间内若无人出局，所有人一起死。逼众人立刻动手。' },
      { k: '有人先动手', t: '第一滴血已经溅出', d: '某个角色突然对另一人下了狠手（暗算 / 夺械 / 推搡致伤），平衡彻底打破，再没有旁观者。' },
    ],
    endings: [
      { k: '唯一幸存', t: '只剩一人走出', d: '尘埃落定，只有一个人活着走出这里，背负着所有人的结局。' },
      { k: '同归于尽', t: '最后两人一起倒下', d: '最后的对决两败俱伤，谁也没能笑到最后，只剩一片死寂。' },
      { k: '识破游戏', t: '矛头转向设局者', d: '幸存者们终于看穿这场杀戮的设局者，把矛头一致转向操控者，游戏以反叛收场。' },
      { k: '残酷的结盟', t: '有人背叛活到最后', d: '一段结盟在最后一刻被背叛，胜者踩着同伴的信任走出去，带着洗不掉的东西。' },
    ],
  },
  palace: {
    label: '宫斗', emoji: '🏮',
    frame: '这里的恩宠与性命系于一线，一句话、一个眼神，都可能藏着杀机。',
    tone: '这是一部宫斗剧。表面端庄温婉，底下步步为营。基调是暗流、算计与心机，刀光都藏在笑意与客套里。你要争的是恩宠、地位与生路，用的是绵里藏针、借刀杀人、欲擒故纵——绝不把话说白，要笑着把人逼到绝境。',
    eventHint: '事件偏阴：圣意降临、有人失了恩宠、一道密旨 / 一杯赐茶 / 一封私信被截、某人"突然病倒"。把恩宠与生死的天平猛地一斜。',
    attributes: [{ key: 'favor', label: '恩宠', emoji: '🏮', default: 50, min: 0, max: 100 }],
    events: [
      { k: '圣意难测', t: '上位者态度骤变', d: '一道口谕 / 赏赐 / 冷落毫无征兆地降临，上位者的态度突然倾斜，几家欢喜几家惊惧。' },
      { k: '被截的密信', t: '不该被看的信现身', d: '一封私密的信笺 / 账册 / 药方落到了不该看的人手里，足以拿捏某人的把柄浮出水面。' },
      { k: '赐下的那杯', t: '一杯来历不明的茶', d: '一盏来历不明的茶 / 汤 / 点心被恭敬奉上，没人说得清里头有没有东西，喝与不喝都是态度。' },
      { k: '突然的病倒', t: '有人当场失仪不适', d: '某个角色当众身子一软、失了仪态或骤感不适，是真病、是装、还是被人算计，无人敢断言。' },
    ],
    endings: [
      { k: '一人独宠', t: '笑到最后登上高位', d: '机关算尽，一人踏着众人的算计登上高位，独得恩宠，也独尝高处的寒。' },
      { k: '满盘皆输', t: '算尽反误了性命', d: '算得太满，反被自己布的局反噬，最体面的人输得最彻底。' },
      { k: '看破红尘', t: '有人退出了棋局', d: '有人终于看透这恩宠薄如纸，主动退出棋局，去求一个干净的活法。' },
      { k: '同盟反目', t: '昔日盟友刀刃相向', d: '曾经联手的两人在最后关头反目，多年情分敌不过一时利害，各自亮出藏了很久的刀。' },
    ],
  },
  comedy: {
    label: '沙雕喜剧', emoji: '🤪',
    frame: '这里没什么真的危险，最大的风险是丢人现眼。怎么离谱怎么来。',
    tone: '这是一部沙雕喜剧。基调荒诞、欢乐、节奏飞快。怎么好笑怎么演——夸张、抬杠、自作聪明、神转折、互相拆台。没有真的伤害，所有矛盾都用最离谱的方式化解。别端着，放开了搞。',
    eventHint: '事件偏闹：离谱的乌龙、突然的反转、从天而降的怪东西、所有人同时误会了同一件事。怎么荒诞怎么来，但不要真的伤人。',
    attributes: [{ key: 'embarrass', label: '社死值', emoji: '🤣', default: 0, min: 0, max: 100 }],
    events: [
      { k: '天降乌龙', t: '离谱的误会砸下来', d: '一个莫名其妙的乌龙从天而降（认错人、传错话、外卖送错），把所有人卷进一场啼笑皆非的误会。' },
      { k: '神转折', t: '剧情突然急刹拐弯', d: '剧情毫无预警地来个一百八十度急转弯，把刚刚还剑拔弩张的气氛瞬间整不会了。' },
      { k: '社死现场', t: '有人当众出大糗', d: '某个角色当众闹出一个能记一辈子的大笑话，全场绷不住，当事人原地社死。' },
      { k: '离谱道具', t: '莫名其妙的东西乱入', d: '一样毫不讲道理的东西突然出现在场上（会说话的玩偶、贴错的标签、一只乱入的鸡），彻底带歪节奏。' },
    ],
    endings: [
      { k: '皆大欢喜', t: '一团乱里笑作一团', d: '所有乌龙在最后拧成一个更大的乌龙，真相揭晓，众人哭笑不得地和好如初。' },
      { k: '更离谱的反转', t: '结尾再翻一个跟头', d: '就在以为要收场时，再来一个更离谱的反转，全员傻眼，戛然而止。' },
      { k: '不了了之', t: '谁也没搞懂就散场了', d: '闹到最后谁也没弄明白到底发生了什么，稀里糊涂地各回各家，留下一地问号。' },
      { k: '塑料情谊', t: '吵着吵着成了朋友', d: '一群人吵吵闹闹拆了一路台，到头来却莫名其妙地处成了朋友。' },
    ],
  },
  healing: {
    label: '治愈日常', emoji: '🌿',
    frame: '这里很安全，没有谁会受伤。时间慢了下来，只剩生活本身。',
    tone: '这是一部治愈系日常。基调温柔、舒缓、有烟火气。没有反派、没有危机，冲突至多是小小的心结与误会，最终都被理解与温柔化开。把笔墨放在细微的善意、共处的安宁，和那些被治愈的瞬间上。',
    eventHint: '事件偏暖：一阵恰到好处的风、煮开的茶、忽然放晴、一只来蹭饭的猫、谁带来一盘点心。都是让心慢慢软下来的小事，绝无危险或冲突。',
    attributes: [{ key: 'warmth', label: '治愈值', emoji: '🌿', default: 0, min: 0, max: 100 }],
    events: [
      { k: '恰好的天气', t: '风停了，天放晴了', d: '天气恰到好处地温柔起来——雨停放晴、晚风送爽、第一片雪落下，让所有人不约而同慢了下来。' },
      { k: '一盏热茶', t: '有人递来温暖', d: '有人默默煮开一壶茶、端来一盘点心，简单的暖意在几个人之间悄悄传开。' },
      { k: '不速的小客', t: '一只小动物来了', d: '一只猫 / 狗 / 小鸟慢悠悠地踱进来蹭人，把谁心里那点别扭都给挠化了。' },
      { k: '旧物与回忆', t: '旧东西勾起往事', d: '一件不起眼的旧物（老照片、一首歌、褪色的信）被翻出来，温柔地勾起谁藏了很久的一段回忆。' },
    ],
    endings: [
      { k: '心结解开', t: '一个温柔的释怀', d: '藏了很久的小心结被轻轻说开，没有输赢，只有一个温柔的释怀。' },
      { k: '寻常的圆满', t: '平淡里的小确幸', d: '什么大事都没发生，可就在这份寻常的相处里，每个人都悄悄被治愈了。' },
      { k: '各自启程', t: '带着暖意继续前行', d: '短暂的相聚到了尾声，众人带着这段时光给的暖意，各自朝前走去。' },
      { k: '相约再见', t: '留一个温柔的念想', d: '故事在一句轻轻的"下次见"里收尾，留下一个让人惦记的温柔念想。' },
    ],
  },
};
const genreOf = (scene) => GENRES[scene?.genre] || null;
const genreFrame = (scene) => genreOf(scene)?.frame || '这里的危险、死亡、罪与罚都是真的，会有真实的后果。';
// 贯穿 actor / DM 的基调块；无 genre（老场景）→ 空串，行为不变
const genreToneBlock = (scene) => { const g = genreOf(scene); return g ? `\n\n【本场基调 · 贯穿全程，重于一切】${g.tone}` : ''; };
const eventsOf = (scene) => genreOf(scene)?.events || EVENT_PRESETS;
const endingsOf = (scene) => genreOf(scene)?.endings || ENDING_PRESETS;
const attrsOf = (scene) => genreOf(scene)?.attributes || []; // 本场题材的属性模板

// ─── 状态机：世界时钟 + 角色运行时状态 ─────────────────────────────────────────
// 这是"确定性骨架"：时间/日期/角色状态/属性的单一真相源，挂在 scene 上、按 characterId 索引。
// 变更只由玩家(监察者)/代码做；AI 台词只读不写。
const PERIODS = ['清晨', '上午', '正午', '午后', '黄昏', '入夜', '深夜'];
const STATUSES = [
  { key: 'active', label: '在场', canSpeak: true },
  { key: 'hidden', label: '潜行', canSpeak: true },
  { key: 'restrained', label: '受制', canSpeak: false },
  { key: 'unconscious', label: '昏迷', canSpeak: false },
  { key: 'out', label: '出局', canSpeak: false },
];
const statusDef = (key) => STATUSES.find((s) => s.key === key) || STATUSES[0];
const defaultAttrs = (scene) => Object.fromEntries(attrsOf(scene).map((a) => [a.key, a.default]));

// 幂等补齐 world 与 actorState（老场景迁移：outIds → status:'out'，attrs 用题材默认值）
function normalizeScene(scene) {
  const ids = [...scene.cast.map((c) => c.characterId), ...((scene.extras || []).map((e) => e.id))];
  const out = new Set(scene.outIds || []);
  const prevState = scene.actorState || {};
  const actorState = {};
  for (const id of ids) {
    const prev = prevState[id] || {};
    actorState[id] = {
      status: prev.status || (out.has(id) ? 'out' : 'active'),
      attrs: { ...defaultAttrs(scene), ...(prev.attrs || {}) },
    };
  }
  const w = scene.world || {};
  const world = { day: w.day || 1, period: w.period || '入夜', round: w.round || 0, phase: w.phase || 'idle' };
  return { ...scene, world, actorState };
}

const getActorState = (scene, id) => (scene.actorState && scene.actorState[id]) || { status: (scene.outIds || []).includes(id) ? 'out' : 'active', attrs: {} };
const actorStatus = (scene, id) => getActorState(scene, id).status;
const isOut = (scene, id) => actorStatus(scene, id) === 'out';            // 取代旧的 outIds.includes
const canSpeak = (scene, id) => statusDef(actorStatus(scene, id)).canSpeak; // 昏迷/受制/出局者不可发言
const worldLine = (scene) => { const w = scene.world; return w ? `第${w.day}日 · ${w.period}` : ''; };

// 纯函数：推进时段（过 深夜 自动翻到次日清晨）/ 直接翻日
function advancePeriod(world) {
  const i = PERIODS.indexOf(world.period);
  const next = (i + 1) % PERIODS.length;
  return { ...world, period: PERIODS[next], day: world.day + (next === 0 ? 1 : 0) };
}
const nextDay = (world) => ({ ...world, day: world.day + 1, period: '清晨' });

// 角色自己的状态/属性块（注入到该角色的提示词；属性是私有的，只给本人）
function selfStateBlock(scene, id) {
  if (!scene.world) return '';
  const st = getActorState(scene, id);
  const attrs = attrsOf(scene).map((a) => `${a.label} ${st.attrs[a.key] ?? a.default}`).join(' · ');
  const sLabel = statusDef(st.status).label;
  return `\n\n【你此刻】${worldLine(scene)}　|　你的状态：${sLabel}${attrs ? `　|　${attrs}` : ''}`;
}
// 全场可见状态（谁在场/昏迷/出局，公开可观测；不含属性数值）
function visibleStatusLine(scene, everyone, selfId) {
  if (!scene.world) return '';
  const parts = everyone.filter((c) => c && c.id !== selfId).map((c) => { const s = statusDef(actorStatus(scene, c.id)); return (s.key === 'active' || s.key === 'out') ? null : `${c.name}（${s.label}）`; }).filter(Boolean);
  return parts.length ? `\n【场上可见状态】${parts.join('、')}` : '';
}
// 导演上帝视角：全员状态 + 属性花名册
function dmStateRoster(scene, cast) {
  if (!scene.world) return '';
  const lines = cast.map((c) => { const st = getActorState(scene, c.id); const attrs = attrsOf(scene).map((a) => `${a.label}${st.attrs[a.key] ?? a.default}`).join('/'); return `- ${c.name}：${statusDef(st.status).label}${attrs ? `（${attrs}）` : ''}`; });
  return `\n\n【世界·此刻】${worldLine(scene)}\n【全员状态（仅你可见）】\n${lines.join('\n')}`;
}

function messagesSinceLastEvent(scene) {
  let count = 0;
  for (let i = scene.messages.length - 1; i >= 0; i--) {
    const m = scene.messages[i];
    if (m.type === 'event') break;
    if (m.type === 'character') count++;
  }
  return count;
}

// 监察者"暴露"之后，已经有几个角色开过口（用来判断是不是"刚察觉"的爆发期）
function charsSinceReveal(scene) {
  let count = 0;
  for (let i = scene.messages.length - 1; i >= 0; i--) {
    const m = scene.messages[i];
    if (m.type === 'system' && m.reveal) return count;
    if (m.type === 'character') count++;
  }
  return 99; // 没有标记过的暴露（老场景）→ 不触发爆发提示
}

async function generateEvent(scene, chars, directive = '') {
  if (!hasKey()) return directive ? `（${directive}）` : pick(MOCK_EVENTS);
  const names = scene.cast.map((c) => chars.find((x) => x.id === c.characterId)).filter(Boolean).map((c) => c.name).join('、');
  const g = genreOf(scene);
  const sys = `你是「AI 剧本杀」的 DM。抛出一个"刚刚发生的关键事件"——不是谁说的话，是世界里真的发生的事，要能把所有人的注意力拉过去、让他们重新反应。结合当前剧情与在场角色，把它写具体。${g ? `\n本场是「${g.label}」：${g.eventHint}` : ''}\n只输出这一句事件描述，不要解释或引号。`;
  const user = `【故事背景】${scene.script || '无'}${scene.dmScript ? `\n【导演密本·仅你可见】\n${scene.dmScript}` : ''}\n【此刻】${worldLine(scene) || '—'}\n【在场】${names}\n【最近剧情】\n${publicTranscript(scene, 10)}${directive ? `\n\n【本次事件的方向】${directive}` : ''}\n\n现在发生了什么？只回一句，写得贴合此刻的剧情与时辰。`;
  return chatOnce([{ role: 'system', content: sys }, { role: 'user', content: user }], { max_tokens: 2048, temperature: 1.0 });
}

async function generateCurtain(scene, directive = '') {
  if (!hasKey()) return directive ? `朝着「${directive}」，故事在此落幕。该说的、该藏的，都留在了这一夜。` : '雨停了。该说的、该藏的，都留在了这一夜。众人各怀心事，故事在此落幕。';
  const g = genreOf(scene);
  const sys = `你是「AI 剧本杀」的 DM。为这场戏写一段落幕旁白——3~5 句，像电影尾声：点出今晚真正发生了什么、留下了什么余味。要有画面和情绪，不要逐条复述剧情。${g ? `\n本场是「${g.label}」，落幕的情绪与气质要贴合：${g.tone}` : ''}`;
  const user = `【故事背景】${scene.script || '无'}${scene.dmScript ? `\n【导演密本·仅你可见】\n${scene.dmScript}` : ''}\n【此刻】${worldLine(scene) || '—'}\n【最近剧情】\n${publicTranscript(scene, 18)}${directive ? `\n\n【把结局收向这个方向】${directive}` : ''}\n\n落幕旁白：`;
  return chatOnce([{ role: 'system', content: sys }, { role: 'user', content: user }], { max_tokens: 2048, temperature: 0.95 });
}

// DM 每一拍的决定：让谁说话 / 抛关键事件 / 落幕
async function dmDecide(scene, chars) {
  const registered = scene.cast.map((c) => { const ch = chars.find((x) => x.id === c.characterId); return ch ? { ...ch, goal: c.secretGoal } : null; }).filter(Boolean);
  const extras = (scene.extras || []).map((e) => ({ ...e, goal: '' }));
  const cast = [...registered, ...extras].filter((c) => canSpeak(scene, c.id)); // 昏迷/受制/出局者不参与选人（确定性过滤）
  if (cast.length === 0) return { action: 'speak', id: null, note: '', dbg: null };
  const charCount = scene.messages.filter((m) => m.type === 'character').length;
  const sinceEvent = messagesSinceLastEvent(scene);
  if (!hasKey()) {
    if (charCount >= 4 && sinceEvent >= 4 && Math.random() < 0.18) return { action: 'event', text: pick(MOCK_EVENTS), dbg: { raw: '（假演员·随机抛事件）', prompt: '（无 key，未调用导演模型）' } };
    return { action: 'speak', id: heuristicPick(scene, cast), note: '', dbg: { raw: '（假演员·启发式选人）', prompt: '（无 key，未调用导演模型）' } };
  }
  if (cast.length === 1) return { action: 'speak', id: cast[0].id, note: '', dbg: null };
  const sysText = dmSystem(scene, cast);
  const userText = '这一拍你的决定是？只输出一行，以 SPEAK: / EVENT: / CURTAIN: 开头。';
  const prompt = `【SYSTEM】\n${sysText}\n\n【USER】\n${userText}`;
  try {
    // thinking / reasoning_effort 是 DeepSeek 专有参数；发给 Gemini / 自定义端点会 400/500。只对 DeepSeek 启用。
    const dmExtra = cfg.provider() === 'deepseek' ? { thinking: { type: 'enabled' }, reasoning_effort: 'low' } : {};
    let json = await chatRaw([{ role: 'system', content: sysText }, { role: 'user', content: userText }], { max_tokens: 2048, temperature: 0.9, extra: dmExtra });
    let raw = (pickContent(json) || '').trim();
    if (!raw) { // 没抠到内容：重试一次，给更硬的格式指令
      json = await chatRaw([{ role: 'system', content: sysText }, { role: 'user', content: userText + '\n\n务必只回一行，且必须以 SPEAK: / EVENT: / CURTAIN: 开头（例：SPEAK: 林渊｜刚被点破，必须反击）。' }], { max_tokens: 2048, temperature: 0.6, extra: dmExtra });
      raw = (pickContent(json) || '').trim();
    }
    const dbg = { raw: raw || '（两次都没抠到内容 → 已用启发式兜底。展开下方"完整 API 返回"看模型到底回了什么）', prompt, rawResponse: JSON.stringify(json, null, 2) };
    // 容忍模型在结论前写一堆思考：取最后一行带 SPEAK/EVENT/CURTAIN 标记的作为最终决定
    const decision = (() => {
      const lines = raw.split('\n').map((s) => s.trim()).filter(Boolean);
      return [...lines].reverse().find((l) => /^(SPEAK|EVENT|CURTAIN)[\s:：]/i.test(l)) || lines[lines.length - 1] || raw;
    })();
    if (/^EVENT[\s:：]/i.test(decision)) {
      return { action: 'event', text: decision.replace(/^EVENT[\s:：]*/i, '').trim(), dbg }; // 去掉冷却护栏：导演想抛就抛
    }
    if (/^CURTAIN[\s:：]/i.test(decision)) {
      if (charCount < 8) return { action: 'speak', id: heuristicPick(scene, cast), note: '', dbg: { ...dbg, raw: raw + '\n→ 护栏：剧情太短，暂不许落幕，本拍降级为说话' } };
      return { action: 'curtain', text: decision.replace(/^CURTAIN[\s:：]*/i, '').trim(), dbg };
    }
    const body = decision.replace(/^SPEAK[\s:：]*/i, '').trim();
    const sep = body.search(/[｜|：:\n]/);
    const namePart = (sep >= 0 ? body.slice(0, sep) : body).replace(/[【】\s。.,，"'`]/g, '');
    const note = (sep >= 0 ? body.slice(sep + 1).trim().replace(/^[\s｜|：:]+/, '') : '').slice(0, 40);
    const hit = cast.find((c) => c.name === namePart) || cast.find((c) => namePart && (namePart.includes(c.name) || c.name.includes(namePart)));
    if (hit) return { action: 'speak', id: hit.id, note, dbg };
    // 名单外的名字：若剧情真的引入过此人、且名字合理 → 作为"临时登场"的新角色配音
    const introduced = namePart && namePart.length <= 6 && publicTranscript(scene, 16).includes(namePart);
    if (introduced) return { action: 'speak', id: null, newName: namePart, note, dbg };
    return { action: 'speak', id: heuristicPick(scene, cast), note: '', dbg };
  } catch (e) { console.warn('dm fallback:', e.message); return { action: 'speak', id: heuristicPick(scene, cast), note: '', dbg: { raw: `（导演调用失败：${e.message}）`, prompt, rawResponse: e.json ? JSON.stringify(e.json, null, 2) : '' } }; }
}

function mockLine(sp, scene) {
  const last = [...scene.messages].reverse().find((m) => m.type === 'character' || m.type === 'overseer');
  const lastName = last ? (last.type === 'overseer' ? '监察者' : last.speakerName) : '';
  const goal = scene.cast.find((c) => c.characterId === sp.id)?.secretGoal || '';
  const bits = [];
  bits.push(pick(['', '（停顿了一下）', '（扫了眼四周）', '哼，', '说真的，', '听我说，', '（压低声音）']));
  bits.push(lastName ? pick([
    `${lastName}，你刚才那句话，我可没听漏。`,
    `${lastName}说得太满了——这屋里没一个人是干净的。`,
    `我倒想知道，${lastName}图的到底是什么。`,
    `别拿那套说辞糊弄我，${lastName}。`,
  ]) : pick([
    '这局还没开牌，可我已经闻到味儿了。',
    '都坐下吧，今晚有的是时间——耐心却有限。',
    '在座的，谁先沉不住气，谁就先露馅。',
  ]));
  if (goal && Math.random() < 0.5) bits.push(pick(['（心里那点盘算，还不到摊牌的时候。）', '有些东西，我得亲手拿到才算数。', '只要时机对，我自有办法。']));
  if (scene.overseerRevealed && Math.random() < 0.6) bits.push(pick([
    '……我能感觉到，有双看不见的手在拨弄这一切。那位"监察者"，你究竟站哪边？',
    '（抬头，望向某个并不存在的方向）你既然能左右这里，何不帮我一把？',
    '藏在暗处的那位朋友——别以为我没察觉你。',
  ]));
  const line = bits.filter(Boolean).join('').trim();
  return line || '……（沉默地观察着每一个人）';
}

async function actorGenerate(scene, chars, speakerId, onToken, opts = {}) {
  const sp = [...chars, ...(scene.extras || [])].find((c) => c.id === speakerId);
  const goal = scene.cast.find((c) => c.characterId === speakerId)?.secretGoal || '';
  const msgs = scene.messages;
  const last = msgs[msgs.length - 1];
  const eventNudge = last && last.type === 'event' ? '\n\n⚡ 刚刚发生了突发事件（见上方【突发事件】）——你这句话必须对它做出即时、具体的反应，而不是当作没发生。' : '';
  const overseerActionNudge = (last && last.type === 'overseer')
    ? '\n\n⚠️ 监察者刚刚当众出手说话——你必须当场、具体地对此做出反应（依你性格：质问、试探、顺从、还是反抗）。'
    : (last && last.type === 'whisper' && last.whisperTo === speakerId)
      ? '\n\n⚠️ 监察者刚刚在你脑子里私语（见上方）——你必须当场对这个声音做出反应，但别让旁人看穿你在跟谁说话。'
      : '';
  const revealCount = (scene.cast.length + (scene.extras || []).length) || 1;
  const revealNudge = scene.overseerRevealed && charsSinceReveal(scene) < Math.min(revealCount, 3)
    ? '\n\n⚠️ 你刚刚才第一次意识到：有一只无形的手在操控这个世界（见上方那阵寒意）。让这份震动在你这句话里真实地爆发出来——依你的性格：惊惧、警觉、被冒犯的愤怒、或强自镇定地反过来质问 / 试探它。别若无其事。'
    : '';
  const actNudge = opts.act ? '\n\n🎬 这一拍请以一个**具体的行动**为主（符合你的动机、不受限制，可与场景 / 物件 / 他人 / 监察者互动），台词可有可无。' : '';
  if (!hasKey()) {
    const full = mockLine(sp, scene);
    let acc = '';
    for (const ch of full) { acc += ch; onToken(acc); await sleep(26); }
    return { text: full, prompt: '（无 key，假演员本地生成）' };
  }
  const sysText = actorSystem(sp, goal, scene, chars);
  const userText = opts.farewell
    ? `${actorTranscript(scene, speakerId)}\n\n【最后的时刻】一切已经尘埃落定。作为【${sp.name}】，面对你即将到来的结局——被带走、逃亡、毁灭、或某种解脱——留下你最后的一句话或一个动作：你的去向、你的悔与不悔、你最后的念头。只此一下，点到为止，别再展开新情节。`
    : `${actorTranscript(scene, speakerId)}\n\n现在轮到你【${sp.name}】发言 / 行动。${eventNudge}${overseerActionNudge}${revealNudge}${actNudge}`;
  const text = await chatStream(
    [{ role: 'system', content: sysText }, { role: 'user', content: userText }],
    onToken,
    { max_tokens: 2048, temperature: 1.05 },
  );
  return { text, prompt: `【SYSTEM】\n${sysText}\n\n【USER】\n${userText}` };
}

// ─── 通用样式 ────────────────────────────────────────────────────────────────
const labelSt = { display: 'block', fontSize: 11.5, color: C.text2, marginBottom: 7, letterSpacing: '.02em', fontWeight: 500, fontFamily: FONT };
const inputSt = { width: '100%', background: C.surface, border: `1px solid ${C.border}`, color: C.text, borderRadius: 10, padding: '11px 14px', fontSize: 14, fontFamily: FONT, outline: 'none', transition: 'border-color .15s, box-shadow .15s' };
const backBtn = { background: '#FFF', border: `1px solid ${C.border}`, color: C.text2, cursor: 'pointer', fontSize: 17, width: 34, height: 34, borderRadius: 9, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 };
const ghostBtn = { background: 'transparent', color: C.text2, border: `1px solid ${C.border}`, borderRadius: 10, padding: '11px 22px', cursor: 'pointer', fontFamily: FONT, fontSize: 14 };
const card = { background: C.surface, borderRadius: 14, padding: 18, border: `1px solid ${C.border}`, cursor: 'pointer', transition: 'all .18s', boxShadow: '0 1px 2px rgba(80,60,25,.04), 0 6px 18px rgba(80,60,25,.05)' };
const h2St = { fontFamily: FONT, fontSize: 21, color: C.text, fontWeight: 600, letterSpacing: '.01em' };
const primaryBtn = (ok) => ({ background: ok ? C.goldBtn : '#ECE4D5', color: ok ? '#2B2620' : '#B3A892', border: 'none', borderRadius: 10, padding: '11px 26px', cursor: ok ? 'pointer' : 'not-allowed', fontFamily: FONT, fontWeight: 600, fontSize: 14, boxShadow: ok ? '0 2px 10px rgba(176,132,58,.28)' : 'none', transition: 'all .15s' });
const popover = { position: 'absolute', bottom: 'calc(100% + 8px)', right: 0, background: '#FFFFFF', border: `1px solid ${C.border}`, borderRadius: 12, boxShadow: '0 12px 36px rgba(60,45,20,.22)', padding: 6, width: 248, zIndex: 40, display: 'flex', flexDirection: 'column', gap: 1 };
const menuItem = { background: 'transparent', border: 'none', textAlign: 'left', padding: '8px 11px', borderRadius: 8, cursor: 'pointer', fontSize: 13.5, fontFamily: FONT, display: 'block', width: '100%' };
const menuHead = { fontSize: 11, color: C.text3, padding: '5px 11px 7px', fontFamily: FONT };
const menuDiv = { height: 1, background: '#EFE7D8', margin: '4px 6px' };

// ─── 头像 ────────────────────────────────────────────────────────────────────
function Av({ char, sz = 36 }) {
  const col = char?.color || '#B3A892';
  const base = {
    width: sz, height: sz, borderRadius: '50%', flexShrink: 0,
    border: `2px solid ${col}55`, display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: col + '1A', overflow: 'hidden', fontSize: sz * 0.4, color: col,
    fontFamily: SERIF, fontWeight: 600, userSelect: 'none',
  };
  return char?.avatar
    ? <img src={char.avatar} alt="" style={{ ...base, objectFit: 'cover' }} />
    : <div style={base}>{char?.name?.[0] || '?'}</div>;
}

// ─── 通用表单字段（顶层组件，避免输入失焦）────────────────────────────────────
function Field({ label, value, onChange, ph, rows }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <label style={labelSt}>{label}</label>
      {rows
        ? <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={ph} rows={rows} style={{ ...inputSt, resize: 'vertical', lineHeight: 1.6 }} />
        : <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={ph} style={inputSt} />}
    </div>
  );
}

// ─── 消息气泡 ────────────────────────────────────────────────────────────────
function DbgBlock({ label, text, mono }) {
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 10, color: C.text3, fontWeight: 600, marginBottom: 3, letterSpacing: '.04em' }}>{label}</div>
      <pre style={{ margin: 0, maxHeight: 240, overflow: 'auto', background: '#FCFBFE', border: '1px solid #E6DEF2', borderRadius: 8, padding: '8px 10px', fontSize: 11.5, lineHeight: 1.55, color: '#4A4560', fontFamily: mono ? MONO : FONT, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{text}</pre>
    </div>
  );
}

function Msg({ msg, char, omni }) {
  if (msg.type === 'event') return (
    <div style={{ margin: '18px 0', display: 'flex', justifyContent: 'center' }}>
      <div style={{ maxWidth: '88%', background: '#2B2620', color: '#F3E8CF', borderRadius: 12, padding: '11px 18px', textAlign: 'center', boxShadow: '0 5px 16px rgba(43,38,32,.20)' }}>
        <div style={{ fontSize: 10.5, color: '#D9B463', fontWeight: 700, letterSpacing: '.18em', marginBottom: 4 }}>⚡ 事 件 · {msg.timestamp}</div>
        <div style={{ fontSize: 14.5, lineHeight: 1.6 }}>{msg.content}</div>
      </div>
    </div>
  );
  if (msg.type === 'curtain') return (
    <div style={{ margin: '26px 0 12px' }}>
      <div style={{ textAlign: 'center', fontSize: 12, color: C.gold, letterSpacing: '.34em', marginBottom: 10 }}>— 落 幕 —</div>
      <div style={{ background: '#FFFBF3', border: '1px solid #E8CF9C', borderRadius: 14, padding: '16px 20px', color: '#4A3D22', fontSize: 14.5, lineHeight: 1.85, fontStyle: 'italic', boxShadow: '0 4px 16px rgba(176,132,58,.12)', whiteSpace: 'pre-wrap' }}>
        {msg.content}
      </div>
    </div>
  );
  if (msg.type === 'overseer') return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', margin: '14px 0' }}>
      <div style={{ maxWidth: '82%', background: C.goldSoft, border: '1px solid #E8CF9C', borderRadius: '14px 4px 14px 14px', padding: '10px 15px', boxShadow: '0 2px 8px rgba(176,132,58,.10)' }}>
        <div style={{ fontSize: 11, color: C.goldInk, fontWeight: 600, letterSpacing: '.02em', marginBottom: 4 }}>监察者 · 对全场 <span style={{ fontFamily: MONO, fontWeight: 400, color: '#BBA266' }}>{msg.timestamp}</span></div>
        <div style={{ fontSize: 14.5, color: '#4A3D22', lineHeight: 1.65 }}>{msg.content}</div>
      </div>
    </div>
  );
  if (msg.type === 'whisper') return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', margin: '10px 0' }}>
      <div style={{ maxWidth: '82%', background: '#F5F2FA', border: '1px dashed #C9BEE0', borderRadius: 12, padding: '8px 13px' }}>
        <div style={{ fontSize: 11, color: C.violet, fontWeight: 500, marginBottom: 3 }}>🔒 私聊 → {msg.whisperToName} · 仅你可见</div>
        <div style={{ fontSize: 13.5, color: '#6E6680', fontStyle: 'italic', lineHeight: 1.6 }}>{msg.content}</div>
      </div>
    </div>
  );
  if (msg.type === 'system') return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '20px 4px', color: C.text3 }}>
      <div style={{ flex: 1, height: 1, background: 'linear-gradient(90deg,transparent,#E3DAC9)' }} />
      <span style={{ fontSize: 12.5, fontStyle: 'italic', letterSpacing: '.02em', textAlign: 'center', maxWidth: '70%' }}>{msg.content}</span>
      <div style={{ flex: 1, height: 1, background: 'linear-gradient(90deg,#E3DAC9,transparent)' }} />
    </div>
  );
  const col = char?.color || '#8C8472';
  return (
    <div style={{ display: 'flex', gap: 12, margin: '15px 0', alignItems: 'flex-start' }}>
      <Av char={char} sz={40} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, marginBottom: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 15, color: col, fontWeight: 600 }}>{msg.speakerName}</span>
          <span style={{ fontSize: 11, color: C.text3, fontFamily: MONO }}>{msg.timestamp}</span>
          {msg.farewell && <span style={{ fontSize: 10.5, color: C.goldInk, background: C.goldSoft, border: '1px solid #E8CF9C', borderRadius: 6, padding: '1px 7px', fontWeight: 600 }}>谢幕</span>}
          {omni && msg.directorNote && <span style={{ fontSize: 11, color: C.violet, background: '#F1ECF8', border: '1px solid #E0D6F0', borderRadius: 6, padding: '1px 7px' }}>🎬 {msg.directorNote}</span>}
        </div>
        <div style={{ background: '#FFF', border: `1px solid ${C.border}`, borderLeft: `3px solid ${col}`, borderRadius: '5px 13px 13px 13px', padding: '11px 15px', fontSize: 14.5, color: C.text, lineHeight: 1.72, display: 'inline-block', maxWidth: '92%', wordBreak: 'break-word', whiteSpace: 'pre-wrap', boxShadow: '0 1px 2px rgba(80,60,25,.04)' }}>
          {msg.content}
        </div>
        {omni && (msg.dm || msg.actorPrompt) && (
          <details style={{ marginTop: 7, maxWidth: '94%', background: '#F7F4FB', border: '1px dashed #D9CEEC', borderRadius: 11, padding: '7px 12px' }}>
            <summary style={{ cursor: 'pointer', fontSize: 11, color: C.violet, fontWeight: 600, letterSpacing: '.02em', userSelect: 'none' }}>🔍 全知 · 展开这一步真实的导演 / 角色调用</summary>
            {msg.dm && <DbgBlock label="🎬 导演 · 模型返回（决策结果）" text={msg.dm.raw} />}
            {msg.dm && msg.dm.rawResponse && <DbgBlock label="🧪 导演 · 完整 API 返回（原始 JSON）" text={msg.dm.rawResponse} mono />}
            {msg.dm && <DbgBlock label="🎬 导演 · 实际发送的 Prompt" text={msg.dm.prompt} mono />}
            {msg.actorPrompt && <DbgBlock label="🎭 角色 · 实际发送的 Prompt" text={msg.actorPrompt} mono />}
          </details>
        )}
      </div>
    </div>
  );
}

// ─── 角色表单 ────────────────────────────────────────────────────────────────
function CharForm({ initial, chars, onSave, onDelete, onBack }) {
  const defColor = COLORS[chars.length % COLORS.length];
  const [gen, setGen] = useState(false);
  const [src, setSrc] = useState('');
  const [f, setF] = useState(initial || { name: '', avatar: '', color: defColor, personality: '', hobbies: '', speechStyle: '', background: '' });
  const fileRef = useRef();
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const randomize = async () => {
    setGen(true);
    try {
      const { data: g, src: s } = await genCharacter(chars.map((c) => c.name));
      setSrc(s);
      if (g && g.name) setF((p) => ({ ...p, name: g.name, personality: g.personality || '', hobbies: g.hobbies || '', speechStyle: g.speechStyle || '', background: g.background || '' }));
    } catch (e) { console.warn('gen char', e); setSrc('fail'); }
    finally { setGen(false); }
  };
  const handleFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const r = new FileReader();
    r.onload = (ev) => set('avatar', ev.target.result);
    r.readAsDataURL(file);
  };

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '30px 40px', maxWidth: 720, margin: '0 auto', width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 28 }}>
        <button onClick={onBack} style={backBtn}>←</button>
        <h2 style={{ ...h2St, fontSize: 25 }}>{initial ? '编辑角色' : '创建新角色'}</h2>
        <div style={{ flex: 1 }} />
        {src && <span style={{ fontSize: 11.5, fontWeight: 500, color: src === 'ai' ? C.green : '#B06A3C' }}>{src === 'ai' ? '✓ 刚才来自 AI' : src === 'mock' ? '模板（没配 key）' : 'AI 没返回，用了模板'}</span>}
        <button onClick={randomize} disabled={gen} title="让 AI 随机生成一个人物填进表单，你可以再改"
          style={{ background: '#F1ECF8', color: C.violet, border: '1px solid #D6CAEA', borderRadius: 9, padding: '8px 14px', cursor: gen ? 'wait' : 'pointer', fontFamily: FONT, fontSize: 13.5, fontWeight: 500, opacity: gen ? 0.6 : 1 }}>
          {gen ? '生成中…' : hasKey() ? '🎲 AI 随机生成' : '🎲 随机（模板）'}
        </button>
      </div>

      <div style={{ marginBottom: 26, display: 'flex', alignItems: 'center', gap: 22 }}>
        <div onClick={() => fileRef.current.click()} style={{ width: 84, height: 84, borderRadius: '50%', cursor: 'pointer', border: `2px dashed ${f.color}88`, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', background: f.color + '12', flexShrink: 0 }}>
          {f.avatar
            ? <img src={f.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <span style={{ color: f.color, fontSize: 30, fontFamily: SERIF }}>{f.name?.[0] || '+'}</span>}
        </div>
        <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} style={{ display: 'none' }} />
        <div>
          <div style={{ fontSize: 13, color: C.text2, marginBottom: 10 }}>点击上传头像 · 选择主色</div>
          <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
            {COLORS.map((c) => (
              <div key={c} onClick={() => set('color', c)} style={{ width: 24, height: 24, borderRadius: '50%', background: c, cursor: 'pointer', border: f.color === c ? '2px solid #FFF' : '2px solid transparent', boxShadow: f.color === c ? `0 0 0 2px ${c}` : 'none' }} />
            ))}
          </div>
        </div>
      </div>

      <Field label="角色名称" value={f.name} onChange={(v) => set('name', v)} ph="例：陈锋" />
      <Field label="性格特征" value={f.personality} onChange={(v) => set('personality', v)} ph="例：冷静、多疑、极度理性，鲜少表露情感" />
      <Field label="兴趣爱好" value={f.hobbies} onChange={(v) => set('hobbies', v)} ph="例：研究密码学、收集旧地图" />
      <Field label="说话风格" value={f.speechStyle} onChange={(v) => set('speechStyle', v)} ph="例：惜字如金，多用短句，偶带讽刺" />
      <Field label="人物背景" value={f.background} onChange={(v) => set('background', v)} ph="角色的经历、动机、秘密、与其他角色的关系……" rows={4} />

      <div style={{ display: 'flex', gap: 12, marginTop: 4, alignItems: 'center' }}>
        <button onClick={() => f.name.trim() && onSave(f)} style={primaryBtn(!!f.name.trim())}>保存角色</button>
        <button onClick={onBack} style={ghostBtn}>取消</button>
        {initial && <>
          <div style={{ flex: 1 }} />
          <button onClick={() => { if (window.confirm(`确定删除角色「${initial.name}」？此操作不可撤销。`)) onDelete(initial.id); }}
            style={{ background: 'transparent', color: C.rose, border: '1px solid #EBC6D0', borderRadius: 10, padding: '11px 20px', cursor: 'pointer', fontFamily: FONT, fontSize: 14 }}>删除角色</button>
        </>}
      </div>
    </div>
  );
}

// ─── 场景创建（剧本 + 选角 + 每角色秘密目标）───────────────────────────────────
function SceneCreator({ chars, onSave, onBack }) {
  const [name, setName] = useState('');
  const [bgImage, setBgImage] = useState('');
  const [script, setScript] = useState('');
  const [dmScript, setDmScript] = useState('');
  const [genre, setGenre] = useState('suspense');
  const [cast, setCast] = useState([]);
  const [gen, setGen] = useState(false);
  const [src, setSrc] = useState('');
  const fileRef = useRef();
  const randomizeScene = async () => {
    setGen(true);
    try { const { data: g, src: s } = await genScene(genre); setSrc(s); if (g) { if (g.name) setName(g.name); if (g.script) setScript(g.script); } }
    catch (e) { console.warn('gen scene', e); setSrc('fail'); }
    finally { setGen(false); }
  };
  const has = (id) => cast.some((c) => c.characterId === id);
  const toggle = (id) => setCast((s) => has(id) ? s.filter((c) => c.characterId !== id) : [...s, { characterId: id, secretGoal: '' }]);
  const setGoal = (id, v) => setCast((s) => s.map((c) => c.characterId === id ? { ...c, secretGoal: v } : c));
  const handleBg = (e) => { const file = e.target.files[0]; if (!file) return; const r = new FileReader(); r.onload = (ev) => setBgImage(ev.target.result); r.readAsDataURL(file); };
  const ok = name.trim() && cast.length >= 1;
  const charById = Object.fromEntries(chars.map((c) => [c.id, c]));

  return (
    <div style={{ padding: '30px 40px', height: '100%', overflowY: 'auto', maxWidth: 760, margin: '0 auto', width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 26 }}>
        <button onClick={onBack} style={backBtn}>←</button>
        <h2 style={{ ...h2St, fontSize: 25 }}>布置一场剧本</h2>
        <div style={{ flex: 1 }} />
        {src && <span style={{ fontSize: 11.5, fontWeight: 500, color: src === 'ai' ? C.green : '#B06A3C' }}>{src === 'ai' ? '✓ 刚才来自 AI' : src === 'mock' ? '模板（没配 key）' : 'AI 没返回，用了模板'}</span>}
        <button onClick={randomizeScene} disabled={gen} title="让 AI 随机生成场景名 + 故事背景填进去，你可以再改"
          style={{ background: '#F1ECF8', color: C.violet, border: '1px solid #D6CAEA', borderRadius: 9, padding: '8px 14px', cursor: gen ? 'wait' : 'pointer', fontFamily: FONT, fontSize: 13.5, fontWeight: 500, opacity: gen ? 0.6 : 1 }}>
          {gen ? '生成中…' : hasKey() ? '🎲 AI 随机背景' : '🎲 随机背景（模板）'}
        </button>
      </div>

      <div style={{ marginBottom: 20 }}>
        <label style={labelSt}>题材基调 · 决定这场的"世界规则"（事件往哪走、角色怎么演、怎么收场）</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {GENRE_ORDER.map((id) => {
            const g = GENRES[id], on = genre === id;
            return (
              <button key={id} onClick={() => setGenre(id)} title={g.tone}
                style={{ display: 'flex', alignItems: 'center', gap: 6, background: on ? C.goldSoft : C.surface, color: on ? C.goldInk : C.text2, border: `1.5px solid ${on ? '#E8CF9C' : C.border}`, borderRadius: 20, padding: '7px 14px', cursor: 'pointer', fontSize: 13.5, fontWeight: on ? 600 : 500, fontFamily: FONT, transition: 'all .15s' }}>
                <span style={{ fontSize: 15 }}>{g.emoji}</span>{g.label}
              </button>
            );
          })}
        </div>
        <p style={{ fontSize: 11.5, color: C.text3, lineHeight: 1.55, marginTop: 7 }}>{GENRES[genre].tone}</p>
      </div>

      <div style={{ display: 'flex', gap: 18, marginBottom: 20, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div onClick={() => fileRef.current.click()} style={{ width: 150, height: 92, borderRadius: 12, cursor: 'pointer', border: `2px dashed ${C.borderStrong}`, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', background: bgImage ? 'transparent' : C.surfaceAlt, flexShrink: 0 }}>
          {bgImage
            ? <img src={bgImage} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <span style={{ color: C.text3, fontSize: 12.5, textAlign: 'center', padding: 8, lineHeight: 1.5 }}>＋ 场景图<br /><span style={{ fontSize: 11 }}>（可选）</span></span>}
        </div>
        <input ref={fileRef} type="file" accept="image/*" onChange={handleBg} style={{ display: 'none' }} />
        <div style={{ flex: 1, minWidth: 220 }}>
          <label style={labelSt}>场景名称</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例：会所顶层，雨夜的牌局" style={inputSt} />
        </div>
      </div>

      <Field label="公开故事背景（剧本）" value={script} onChange={setScript} rows={3} ph="所有人都知道的设定：地点、处境、刚发生了什么、要解决什么。例：一桩合伙人之死，今晚所有嫌疑人被困在这间会所里……" />

      <div style={{ marginBottom: 18, padding: '12px 14px', background: '#FBF3E2', border: '1px solid #E8CF9C', borderRadius: 12 }}>
        <label style={{ ...labelSt, color: C.goldInk, marginBottom: 4 }}>🎬 导演密本 · 只有导演看得见（角色永远不知道）</label>
        <p style={{ fontSize: 11.5, color: C.text2, lineHeight: 1.55, marginBottom: 8 }}>给导演的私密指引：想埋的关键事件、触发条件、暗线、结局条件、想引导的走向……导演会据此把握抛事件 / 落幕的时机，但绝不会泄露给任何角色。</p>
        <textarea value={dmScript} onChange={(e) => setDmScript(e.target.value)} rows={4}
          placeholder={'例：\n· 午夜时分，让灯突然熄灭，恢复时魏清源已死。\n· 当至少 3 人当众指认魏清源时，把真相推向高潮。\n· 暗线：阮烟其实是卧底记者。\n· 结局条件：真相被多数人知晓即落幕。'}
          style={{ ...inputSt, background: '#FFFDF8', resize: 'vertical', fontSize: 13, lineHeight: 1.6 }} />
      </div>

      <div style={{ margin: '6px 0 14px' }}>
        <label style={labelSt}>参演角色 {cast.length > 0 && <span style={{ color: C.gold, fontWeight: 600 }}>· 已选 {cast.length} 位</span>}</label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(168px, 1fr))', gap: 10 }}>
          {chars.map((c) => (
            <div key={c.id} onClick={() => toggle(c.id)} style={{ padding: '11px 13px', borderRadius: 11, cursor: 'pointer', border: `1.5px solid ${has(c.id) ? c.color : C.border}`, background: has(c.id) ? c.color + '12' : C.surface, display: 'flex', alignItems: 'center', gap: 10, transition: 'all .15s' }}>
              <Av char={c} sz={34} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 15, color: C.text, fontWeight: 500 }}>{c.name}</div>
                <div style={{ fontSize: 11.5, color: C.text3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{(c.personality || '').slice(0, 14) || '—'}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {cast.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <label style={labelSt}>各怀鬼胎 · 为每位角色设定本场秘密目标</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {cast.map((c) => {
              const ch = charById[c.characterId];
              return (
                <div key={c.characterId} style={{ display: 'flex', gap: 11, alignItems: 'flex-start', background: C.surface, border: `1px solid ${ch.color}40`, borderRadius: 12, padding: 12 }}>
                  <Av char={ch} sz={32} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, color: ch.color, fontWeight: 600, marginBottom: 6 }}>{ch.name} 的秘密目标</div>
                    <textarea value={c.secretGoal} onChange={(e) => setGoal(c.characterId, e.target.value)} rows={2}
                      placeholder={`只有 ${ch.name} 自己知道。例：查出凶手并嫁祸给在场某人 / 拿回那份合同 / 保护某人不被怀疑……`}
                      style={{ ...inputSt, resize: 'vertical', fontSize: 13.5, lineHeight: 1.6 }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 12 }}>
        <button onClick={() => ok && onSave({ name: name.trim(), bgImage, script: script.trim(), dmScript: dmScript.trim(), genre, cast })} style={primaryBtn(ok)}>开场</button>
        <button onClick={onBack} style={ghostBtn}>取消</button>
      </div>
    </div>
  );
}

// ─── 舞台（群聊 · 一句一停）─────────────────────────────────────────────────────
function Stage({ scene, chars, onUpdate, onBack }) {
  const [input, setInput] = useState('');
  const [whisperMode, setWhisperMode] = useState(false);
  const [whisperTarget, setWhisperTarget] = useState('');
  const [streamSpeaker, setStreamSpeaker] = useState(null);
  const [streamText, setStreamText] = useState('');
  const [busy, setBusy] = useState(false);
  const [auto, setAuto] = useState(false);
  const [pausing, setPausing] = useState(false);
  const [omni, setOmni] = useState(false);
  const [actMode, setActMode] = useState(false);
  const [menu, setMenu] = useState(null); // null | 'event' | 'curtain'
  const [statePanel, setStatePanel] = useState(false); // DM 状态面板开合
  const [err, setErr] = useState('');
  const busyRef = useRef(false);
  const autoRef = useRef(false);
  const farewellRef = useRef(false);
  const omniRef = useRef(false);
  omniRef.current = omni;
  const actRef = useRef(false);
  actRef.current = actMode;
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  const endRef = useRef();

  const extras = scene.extras || [];
  const charMap = Object.fromEntries([...chars, ...extras].map((c) => [c.id, c]));
  const cast = [...scene.cast.map((c) => charMap[c.characterId]).filter(Boolean), ...extras];
  const locked = busy || auto;

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [scene.messages.length, streamText, busy]);
  useEffect(() => { if (cast[0]) setWhisperTarget((t) => t || cast[0].id); }, [scene.id]);
  useEffect(() => () => { autoRef.current = false; }, []);
  // 幂等补齐 world + actorState（新老场景统一），保证状态机字段存在
  useEffect(() => { if (!scene.world || !scene.actorState) onUpdate(normalizeScene(scene)); }, [scene.id]);

  // ── 确定性状态变更（只有玩家/DM 能改；AI 只读不写）──
  // 立即把 sceneRef 同步到新值，避免连点（同一渲染帧内多次点击）读到陈旧快照、丢更新
  const commitScene = (next) => { sceneRef.current = next; onUpdate(next); };
  const setStatus = (id, status) => { const cur = sceneRef.current; commitScene({ ...cur, actorState: { ...(cur.actorState || {}), [id]: { ...getActorState(cur, id), status } } }); };
  const setAttr = (id, key, val) => { const cur = sceneRef.current; const st = getActorState(cur, id); commitScene({ ...cur, actorState: { ...(cur.actorState || {}), [id]: { ...st, attrs: { ...st.attrs, [key]: val } } } }); };
  const bumpAttr = (id, key, delta, min, max) => { const st = getActorState(sceneRef.current, id); const v = (st.attrs[key] ?? 0) + delta; setAttr(id, key, Math.max(min, Math.min(max, v))); };
  const advanceWorld = () => { const cur = normalizeScene(sceneRef.current); commitScene({ ...cur, world: advancePeriod(cur.world) }); };
  const turnDay = () => { const cur = normalizeScene(sceneRef.current); commitScene({ ...cur, world: nextDay(cur.world) }); };

  const reveal = (sc) => {
    if (sc.overseerRevealed) return sc;
    const sys = { id: genId(), type: 'system', content: '空气凝固了一瞬——在场每个人都同时感到一阵寒意：有一只看不见的手，正注视着这里，而且，能动它。', timestamp: hm(), reveal: true };
    return { ...sc, overseerRevealed: true, messages: [...sc.messages, sys] };
  };

  // 落幕之后的谢幕：每个角色说最后一句（也可只做动作或沉默离场），一人一句，依次流式
  const runFarewells = async (baseScene) => {
    const everyone = [...baseScene.cast.map((c) => chars.find((x) => x.id === c.characterId)).filter(Boolean), ...(baseScene.extras || [])].filter((c) => !isOut(baseScene, c.id));
    if (everyone.length === 0) return baseScene;
    farewellRef.current = true;
    let cur = { ...baseScene, messages: [...baseScene.messages, { id: genId(), type: 'system', content: '谢 幕', timestamp: hm() }] };
    onUpdate(cur);
    for (const sp of everyone) {
      if (!farewellRef.current) break; // 用户点了「续演」→ 提前收住谢幕
      setStreamSpeaker(sp); setStreamText('');
      try {
        const gen = await actorGenerate(cur, chars, sp.id, setStreamText, { farewell: true });
        const msg = { id: genId(), type: 'character', speakerName: sp.name, characterId: sp.id, content: (gen.text || '').trim() || '（沉默地转身离场）', timestamp: hm(), farewell: true };
        if (omniRef.current) msg.actorPrompt = gen.prompt;
        cur = { ...cur, messages: [...cur.messages, msg] };
        onUpdate(cur);
      } catch (e) { console.warn('farewell skip:', e.message); }
      setStreamSpeaker(null); setStreamText('');
      await sleep(500);
    }
    farewellRef.current = false;
    setStreamSpeaker(null); setStreamText('');
    return cur;
  };

  // DM 决定每一拍：让谁说 / 抛事件 / 落幕。返回更新后的 scene；落幕或出错返回 null（放养就此停止）。
  const stepOnce = async (baseScene, forcedId = null) => {
    if (cast.length === 0 || baseScene.ended) return null;
    busyRef.current = true; setBusy(true); setErr('');
    const working = forcedId ? reveal(baseScene) : baseScene; // 点名 = 监察者出手 → 暴露；放养/下一句不暴露
    if (working !== baseScene) onUpdate(working);
    try {
      const decision = forcedId ? { action: 'speak', id: forcedId, note: '监察者点名', dbg: { raw: '（监察者点名，跳过导演决策）', prompt: '（未调用导演模型）' } } : await dmDecide(working, chars);

      if (decision.action === 'event') {
        const next = { ...working, messages: [...working.messages, { id: genId(), type: 'event', content: (decision.text || '').trim() || '（场上的气氛骤然一变。）', timestamp: hm() }] };
        onUpdate(next);
        return next;
      }
      if (decision.action === 'curtain') {
        const text = (((await generateCurtain(working).catch(() => '')) || decision.text || '故事在此落幕。')).trim();
        const curtainScene = { ...working, ended: true, messages: [...working.messages, { id: genId(), type: 'curtain', content: text, timestamp: hm() }] };
        onUpdate(curtainScene);
        autoRef.current = false; setAuto(false);
        await runFarewells(curtainScene);
        return null;
      }

      let speakerId = decision.id;
      let work = working;
      // 名单外的新角色：复用同名的临时角色，或新建一个拉进场
      if (!charMap[speakerId] && decision.newName) {
        const exist = (work.extras || []).find((e) => e.name === decision.newName);
        if (exist) speakerId = exist.id;
        else {
          const extra = { id: genId(), name: decision.newName, color: pick(COLORS), ephemeral: true };
          work = { ...work, extras: [...(work.extras || []), extra] };
          onUpdate(work);
          speakerId = extra.id;
        }
      }
      const sp = [...chars, ...(work.extras || [])].find((c) => c.id === speakerId);
      if (!sp) throw new Error('找不到要发言的角色');
      setStreamSpeaker(sp); setStreamText('');
      const gen = await actorGenerate(work, chars, speakerId, setStreamText, { act: actRef.current });
      const msg = { id: genId(), type: 'character', speakerName: sp.name, characterId: sp.id, content: (gen.text || '').trim() || '……', timestamp: hm(), directorNote: decision.note || '' };
      if (omniRef.current) { msg.dm = decision.dbg || null; msg.actorPrompt = gen.prompt; } // 全知：留存真实的导演/角色调用
      // 状态机：每说一句 round++（给触发器用），phase 回到 idle
      const next = { ...work, world: work.world ? { ...work.world, round: (work.world.round || 0) + 1, phase: 'idle' } : work.world, messages: [...work.messages, msg] };
      onUpdate(next);
      setStreamSpeaker(null); setStreamText('');
      return next;
    } catch (e) {
      console.error(e);
      setErr(e.message || '生成失败，检查「设置」里的 key 或网络');
      return null;
    } finally {
      setStreamSpeaker(null); setStreamText('');
      busyRef.current = false; setBusy(false);
    }
  };

  const advance = (forcedId = null) => {
    if (busyRef.current || autoRef.current) return;
    stepOnce(sceneRef.current, forcedId);
  };

  // 放养：角色自己一句句往下演（仍由智能导演挑人），直到暂停
  const runAuto = async () => {
    if (autoRef.current || busyRef.current || cast.length === 0) return;
    setPausing(false);
    autoRef.current = true; setAuto(true);
    let cur = sceneRef.current;
    while (autoRef.current) {
      const next = await stepOnce(cur);          // 这一句总会完整说完，不会被砍断
      if (!next || !autoRef.current) break;       // 说完后若已点暂停，就停在这句
      cur = next;
      for (let t = 0; t < 850 && autoRef.current; t += 80) await sleep(80); // 行间停顿，可被暂停立即打断
    }
    autoRef.current = false; setAuto(false); setPausing(false);
  };
  // 暂停：当前这句说完再停（好让你读完）；两句之间点则立即停
  const toggleAuto = () => {
    if (autoRef.current) { autoRef.current = false; setAuto(false); setPausing(busyRef.current); }
    else runAuto();
  };

  // 监察者手动抛一个关键事件（= 出手 → 暴露）；directive 为预设方向，空则 AI 现编
  const throwEvent = async (directive = '') => {
    if (busyRef.current || autoRef.current || sceneRef.current.ended) return;
    busyRef.current = true; setBusy(true); setErr('');
    try {
      const working = reveal(sceneRef.current);
      const text = (((await generateEvent(working, chars, directive).catch(() => '')) || pick(MOCK_EVENTS))).trim();
      onUpdate({ ...working, messages: [...working.messages, { id: genId(), type: 'event', content: text, timestamp: hm() }] });
    } catch (e) { console.error(e); setErr(e.message || '生成失败'); }
    finally { busyRef.current = false; setBusy(false); }
  };

  // 监察者宣布落幕，DM 写结局；directive 为预设终局方向，空则 AI 自由收尾
  const callCurtain = async (directive = '') => {
    if (busyRef.current || sceneRef.current.ended) return;
    if (autoRef.current) { autoRef.current = false; setAuto(false); }
    busyRef.current = true; setBusy(true); setErr('');
    try {
      const working = sceneRef.current;
      const text = (((await generateCurtain(working, directive).catch(() => '')) || '故事在此落幕。')).trim();
      const curtainScene = { ...working, ended: true, messages: [...working.messages, { id: genId(), type: 'curtain', content: text, timestamp: hm() }] };
      onUpdate(curtainScene);
      await runFarewells(curtainScene);
    } catch (e) { console.error(e); setErr(e.message || '生成失败'); }
    finally { busyRef.current = false; setBusy(false); }
  };

  const resume = () => { farewellRef.current = false; onUpdate({ ...sceneRef.current, ended: false }); };

  // 出局快捷键：在 出局 / 在场 之间切换（真相源已是 actorState.status）
  const toggleOut = (id) => setStatus(id, isOut(sceneRef.current, id) ? 'active' : 'out');

  // 把整局剧情导出成可读的 markdown 文件，永久留底 / 可分享
  const exportScene = () => {
    const body = scene.messages.map((m) => {
      if (m.type === 'character') return `**${m.speakerName}**：${m.content}`;
      if (m.type === 'event') return `> ⚡ **事件**：${m.content}`;
      if (m.type === 'curtain') return `\n---\n\n### — 落幕 —\n\n${m.content}\n\n---`;
      if (m.type === 'overseer') return `*〔监察者·对全场〕${m.content}*`;
      if (m.type === 'whisper') return `*〔监察者 → ${m.whisperToName}（私聊）〕${m.content}*`;
      if (m.type === 'system') return `*（${m.content}）*`;
      return '';
    }).filter(Boolean).join('\n\n');
    const md = `# ${scene.name || '剧情'}\n\n${scene.script ? `> ${scene.script}\n\n` : ''}---\n\n${body}\n`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown;charset=utf-8' }));
    a.download = `${(scene.name || '剧情').replace(/[\\/:*?"<>|]/g, '_')}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const sendOverseer = () => {
    const text = input.trim();
    if (!text || busyRef.current) return;
    if (autoRef.current) { autoRef.current = false; setAuto(false); } // 监察者发言 → 暂停放养，把节奏交回你手里
    let next;
    if (whisperMode && whisperTarget) {
      const tgt = charMap[whisperTarget];
      next = { ...scene, messages: [...scene.messages, { id: genId(), type: 'whisper', content: text, whisperTo: whisperTarget, whisperToName: tgt?.name || '', timestamp: hm() }] };
    } else {
      next = { ...scene, messages: [...scene.messages, { id: genId(), type: 'overseer', speakerName: '监察者', content: text, timestamp: hm() }] };
    }
    next = reveal(next);
    onUpdate(next);
    setInput('');
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* 头部 */}
      <div style={{ position: 'relative', borderBottom: `1px solid ${C.border}`, flexShrink: 0, overflow: 'hidden' }}>
        {scene.bgImage && <img src={scene.bgImage} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: 0.35 }} />}
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(250,246,239,.80), rgba(250,246,239,.96))' }} />
        <div style={{ position: 'relative', padding: '13px 24px', display: 'flex', alignItems: 'center', gap: 14 }}>
          <button onClick={onBack} style={backBtn}>←</button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 19, color: C.text, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
              {scene.name}
              {genreOf(scene) && <span style={{ fontSize: 11.5, fontWeight: 600, color: C.goldInk, background: C.goldSoft, border: '1px solid #E8CF9C', borderRadius: 7, padding: '1px 8px' }}>{genreOf(scene).emoji} {genreOf(scene).label}</span>}
              {scene.world && <span style={{ fontSize: 11.5, fontWeight: 600, color: C.violet, background: '#F1ECF8', border: '1px solid #E0D6F0', borderRadius: 7, padding: '1px 8px' }}>🕯 第{scene.world.day}日 · {scene.world.period}</span>}
            </div>
            <div style={{ fontSize: 12, color: C.text2, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cast.map((c) => c.name).join(' · ')}</div>
          </div>
          <button onClick={() => setOmni((v) => !v)} title="全知视角：每条发言下方可展开，看这一步真实的导演调用（发出的 Prompt + 模型返回的决策）和角色调用的 Prompt。仅影响开启后的新发言。"
            style={{ display: 'flex', alignItems: 'center', gap: 5, background: omni ? '#EFEAF7' : C.surface, color: omni ? C.violet : C.text2, border: `1px solid ${omni ? '#D6CAEA' : C.border}`, borderRadius: 20, padding: '5px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 500, fontFamily: FONT, whiteSpace: 'nowrap' }}>
            👁 全知{omni ? ' · 开' : ''}
          </button>
          <button onClick={exportScene} title="把这一局完整剧情导出成可读的 .md 文件（永久留底 / 可分享）"
            style={{ background: C.surface, color: C.text2, border: `1px solid ${C.border}`, borderRadius: 20, padding: '5px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 500, fontFamily: FONT, whiteSpace: 'nowrap' }}>⬇ 导出</button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, background: scene.overseerRevealed ? '#FBEEF1' : '#F1ECE1', border: `1px solid ${scene.overseerRevealed ? '#EBC6D0' : C.border}`, padding: '5px 11px', borderRadius: 20 }}>
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: scene.overseerRevealed ? C.rose : C.text3, boxShadow: scene.overseerRevealed ? `0 0 7px ${C.rose}` : 'none' }} />
            <span style={{ fontSize: 12, color: scene.overseerRevealed ? C.rose : C.text2, fontWeight: 500 }}>{scene.overseerRevealed ? '监察者已暴露' : '潜行中'}</span>
          </div>
        </div>
      </div>

      {/* 消息流 */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px 8px', maxWidth: 860, margin: '0 auto', width: '100%' }}>
        {scene.messages.length === 0 && (
          <div style={{ textAlign: 'center', padding: '56px 24px', color: C.text2 }}>
            <div style={{ fontSize: 34, marginBottom: 14 }}>🎭</div>
            <div style={{ fontSize: 19, marginBottom: 10, color: C.text, fontWeight: 600 }}>各就各位，等你开场</div>
            <div style={{ fontSize: 13.5, lineHeight: 1.8, maxWidth: 460, margin: '0 auto' }}>点「下一句 ▶」让 AI 导演挑人开口，或直接点某个角色让 TA 先说。<br />你说的话、点名、私聊的情报——只要你一出手，他们就会察觉到你。</div>
          </div>
        )}
        {scene.messages.map((m) => <Msg key={m.id} msg={m} char={m.characterId ? charMap[m.characterId] : null} omni={omni} />)}
        {streamSpeaker && (
          <div style={{ display: 'flex', gap: 12, margin: '15px 0', alignItems: 'flex-start' }}>
            <Av char={streamSpeaker} sz={40} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ marginBottom: 6 }}>
                <span style={{ fontSize: 15, color: streamSpeaker.color, fontWeight: 600 }}>{streamSpeaker.name}</span>
              </div>
              <div style={{ background: '#FFF', border: `1px solid ${C.border}`, borderLeft: `3px solid ${streamSpeaker.color}`, borderRadius: '5px 13px 13px 13px', padding: '11px 15px', fontSize: 14.5, color: C.text, lineHeight: 1.72, display: 'inline-block', maxWidth: '92%', wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
                {streamText}<span className="blink">▍</span>
              </div>
            </div>
          </div>
        )}
        {busy && !streamSpeaker && (
          <div style={{ display: 'flex', gap: 6, padding: '12px 4px 8px 4px', alignItems: 'center' }}>
            <span className="tdot" /><span className="tdot" /><span className="tdot" />
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* 控制台 */}
      <div style={{ padding: '12px 24px 14px', borderTop: `1px solid ${C.border}`, background: C.surface, flexShrink: 0 }}>
        <div style={{ maxWidth: 860, margin: '0 auto' }}>
         {scene.ended ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '6px 2px' }}>
            <div style={{ flex: 1, height: 1, background: 'linear-gradient(90deg,transparent,#E3DAC9)' }} />
            <span style={{ fontSize: 13, color: C.text2, letterSpacing: '.16em' }}>本 场 已 落 幕</span>
            <button onClick={resume} style={{ background: C.surface, color: C.text2, border: `1px solid ${C.border}`, borderRadius: 9, padding: '7px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: FONT }}>续演 ▶</button>
            <div style={{ flex: 1, height: 1, background: 'linear-gradient(90deg,#E3DAC9,transparent)' }} />
          </div>
         ) : (
          <>
          {menu && <div onClick={() => setMenu(null)} style={{ position: 'fixed', inset: 0, zIndex: 25 }} />}
          {/* DM 状态台：世界时钟 + 每角色状态/属性（确定性控件） */}
          <div style={{ marginBottom: 10, border: `1px solid ${C.border}`, borderRadius: 12, background: C.surfaceAlt, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 12px', flexWrap: 'wrap' }}>
              <button onClick={() => setStatePanel((v) => !v)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: C.text2, fontFamily: FONT }}>{statePanel ? '▾' : '▸'} 🎛 状态台</button>
              {scene.world && <span style={{ fontSize: 12.5, color: C.violet, fontWeight: 600 }}>🕯 第{scene.world.day}日 · {scene.world.period}</span>}
              <div style={{ flex: 1 }} />
              <button onClick={advanceWorld} title="推进到下一个时段（过深夜自动翻到次日清晨）" style={{ background: C.surface, color: C.text2, border: `1px solid ${C.border}`, borderRadius: 8, padding: '5px 11px', cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: FONT, whiteSpace: 'nowrap' }}>⏩ 推进时段</button>
              <button onClick={turnDay} title="直接翻到第二天清晨" style={{ background: C.surface, color: C.text2, border: `1px solid ${C.border}`, borderRadius: 8, padding: '5px 11px', cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: FONT, whiteSpace: 'nowrap' }}>🌙 翻到次日</button>
            </div>
            {statePanel && (
              <div style={{ borderTop: `1px solid ${C.border}`, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 9 }}>
                {cast.map((c) => {
                  const st = getActorState(scene, c.id);
                  return (
                    <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
                      <Av char={c} sz={22} />
                      <span style={{ fontSize: 13, color: C.text, fontWeight: 500, minWidth: 52 }}>{c.name}</span>
                      <select value={st.status} onChange={(e) => setStatus(c.id, e.target.value)}
                        style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.text, borderRadius: 8, padding: '4px 6px', fontSize: 12.5, fontFamily: FONT, outline: 'none' }}>
                        {STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                      </select>
                      {attrsOf(scene).map((a) => {
                        const step = (a.max - a.min) <= 10 ? 1 : 10;
                        const stepBtn = { width: 20, height: 20, borderRadius: 6, border: `1px solid ${C.border}`, background: C.surface, color: C.text2, cursor: 'pointer', fontSize: 13, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 };
                        return (
                          <div key={a.key} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <span style={{ fontSize: 12, color: C.text2 }}>{a.emoji}{a.label}</span>
                            <button onClick={() => bumpAttr(c.id, a.key, -step, a.min, a.max)} style={stepBtn}>−</button>
                            <span style={{ fontSize: 12.5, fontFamily: MONO, minWidth: 26, textAlign: 'center', color: C.text }}>{st.attrs[a.key] ?? a.default}</span>
                            <button onClick={() => bumpAttr(c.id, a.key, +step, a.min, a.max)} style={stepBtn}>+</button>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
                {attrsOf(scene).length === 0 && <div style={{ fontSize: 11.5, color: C.text3 }}>本题材没有预设属性，这里只调状态。</div>}
              </div>
            )}
          </div>
          {/* 点名 + 下一句 + 放养 + 事件 + 落幕 */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
            <button onClick={() => setActMode((v) => !v)} title="开启后，点名 / 下一句会让角色以一个具体行动为主（可带台词）"
              style={{ background: actMode ? '#EAF1E8' : C.surface, color: actMode ? C.green : C.text2, border: `1px solid ${actMode ? '#C6DBC3' : C.border}`, borderRadius: 20, padding: '4px 11px', cursor: 'pointer', fontSize: 12, fontWeight: 500, fontFamily: FONT, whiteSpace: 'nowrap', marginRight: 2 }}>
              {actMode ? '🎬 行动' : '🗣 发言'}
            </button>
            {cast.map((c) => {
              const out = isOut(scene, c.id);
              return (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 3, background: C.surface, border: `1.5px ${c.ephemeral ? 'dashed' : 'solid'} ${out ? '#D8CFC0' : c.color + (c.ephemeral ? '99' : '66')}`, borderRadius: 20, padding: '2px 7px 2px 4px', opacity: locked ? 0.5 : 1, fontFamily: FONT }}>
                  <div onClick={() => { if (!out && !locked) advance(c.id); }} title={out ? `${c.name}（已出局）` : `让 ${c.name} ${actMode ? '行动' : '发言'}（点名 = 监察者出手）`}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: (out || locked) ? 'default' : 'pointer', color: out ? C.text3 : C.text, fontSize: 12.5, textDecoration: out ? 'line-through' : 'none' }}>
                    <Av char={c} sz={20} /> {out ? '🪦' : ''}{c.name}{c.ephemeral ? ' ·客' : ''}
                  </div>
                  <span onClick={() => toggleOut(c.id)} title={out ? '解除锁定（重新可发言）' : '强制锁定：永不让他被点中（导演通常会自动跳过死者/离场者，这里是手动兜底）'}
                    style={{ cursor: 'pointer', fontSize: 11, color: C.text3, padding: '0 2px', userSelect: 'none' }}>{out ? '↺' : '✕'}</span>
                </div>
              );
            })}
            <div style={{ flex: 1 }} />
            <div style={{ position: 'relative' }}>
              <button disabled={locked} onClick={() => setMenu(menu === 'event' ? null : 'event')} title="强势抛出一个关键事件（= 监察者出手，全场会察觉你）"
                style={{ background: menu === 'event' ? '#FBF3E2' : C.surface, color: locked ? '#B3A892' : C.goldInk, border: `1px solid ${locked ? C.border : '#E8CF9C'}`, borderRadius: 9, padding: '8px 13px', cursor: locked ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap', fontFamily: FONT }}>
                💥 事件 ▾
              </button>
              {menu === 'event' && (
                <div style={popover}>
                  <div style={menuHead}>强势抛出一个事件</div>
                  {eventsOf(scene).map((p) => (
                    <button key={p.k} className="menu-item" style={menuItem} onClick={() => { setMenu(null); throwEvent(p.d); }}>
                      <div style={{ fontWeight: 600, color: C.text }}>{p.k}</div>
                      <div style={{ fontSize: 11.5, color: C.text3, marginTop: 1 }}>{p.t}</div>
                    </button>
                  ))}
                  <div style={menuDiv} />
                  <button className="menu-item" style={menuItem} onClick={() => { setMenu(null); throwEvent(''); }}>
                    <div style={{ fontWeight: 600, color: C.goldInk }}>✨ AI 现编一个</div>
                  </button>
                </div>
              )}
            </div>
            <div style={{ position: 'relative' }}>
              <button disabled={busy} onClick={() => setMenu(menu === 'curtain' ? null : 'curtain')} title="选一种终局方向，DM 据此强势收场"
                style={{ background: menu === 'curtain' ? '#FBEEF1' : C.surface, color: busy ? '#B3A892' : C.rose, border: `1px solid ${busy ? C.border : '#EBC6D0'}`, borderRadius: 9, padding: '8px 13px', cursor: busy ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap', fontFamily: FONT }}>
                落幕 ▾
              </button>
              {menu === 'curtain' && (
                <div style={popover}>
                  <div style={menuHead}>选一种终局，强势收场</div>
                  {endingsOf(scene).map((p) => (
                    <button key={p.k} className="menu-item" style={menuItem} onClick={() => { setMenu(null); callCurtain(p.d); }}>
                      <div style={{ fontWeight: 600, color: C.text }}>{p.k}</div>
                      <div style={{ fontSize: 11.5, color: C.text3, marginTop: 1 }}>{p.t}</div>
                    </button>
                  ))}
                  <div style={menuDiv} />
                  <button className="menu-item" style={menuItem} onClick={() => { setMenu(null); callCurtain(''); }}>
                    <div style={{ fontWeight: 600, color: C.rose }}>✨ AI 自由收尾</div>
                  </button>
                </div>
              )}
            </div>
            <button disabled={locked} onClick={() => advance()}
              style={{ background: locked ? '#EFEAE0' : '#E9F2E7', color: locked ? '#B3A892' : C.green, border: `1px solid ${locked ? '#E2DAC9' : '#BFD8BD'}`, borderRadius: 9, padding: '8px 18px', cursor: locked ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: 13.5, whiteSpace: 'nowrap', fontFamily: FONT }}>
              {auto ? '放养中…' : busy ? '演绎中…' : '下一句 ▶'}
            </button>
            <button disabled={busy && !auto} onClick={toggleAuto} title="放养时点暂停：当前这句说完再停，方便你读完（两句之间点则立即停）"
              style={{ background: auto ? '#FBEEF1' : pausing ? C.goldSoft : C.surface, color: auto ? C.rose : pausing ? C.goldInk : C.text2, border: `1px solid ${auto ? '#EBC6D0' : pausing ? '#E8CF9C' : C.border}`, borderRadius: 9, padding: '8px 14px', cursor: (busy && !auto) ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap', fontFamily: FONT }}>
              {auto ? '⏸ 暂停' : pausing ? '停在这句…' : '🐑 放养'}
            </button>
          </div>

          {/* 监察者输入 */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button onClick={() => setWhisperMode((v) => !v)} title="切换 公开 / 私聊"
              style={{ background: whisperMode ? '#F1ECF8' : C.goldSoft, color: whisperMode ? C.violet : C.goldInk, border: `1px solid ${whisperMode ? '#D6CAEA' : '#E8CF9C'}`, borderRadius: 9, padding: '9px 13px', cursor: 'pointer', fontSize: 12.5, whiteSpace: 'nowrap', fontWeight: 500, fontFamily: FONT }}>
              {whisperMode ? '🔒 私聊' : '📣 公开'}
            </button>
            {whisperMode && (
              <select value={whisperTarget} onChange={(e) => setWhisperTarget(e.target.value)}
                style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.text, borderRadius: 9, padding: '9px 8px', fontSize: 13.5, outline: 'none', fontFamily: FONT }}>
                {cast.map((c) => <option key={c.id} value={c.id}>→ {c.name}</option>)}
              </select>
            )}
            <input value={input} onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendOverseer(); } }}
              placeholder={whisperMode ? `私下塞给 ${charMap[whisperTarget]?.name || ''} 一点情报…（别人看不到）` : '以监察者身份对全场说话 / 补充背景…'}
              style={{ flex: 1, background: C.surfaceAlt, border: `1px solid ${C.border}`, color: C.text, borderRadius: 9, padding: '10px 14px', fontSize: 14, fontFamily: FONT, outline: 'none' }} />
            <button onClick={sendOverseer} style={{ background: C.goldBtn, color: '#2B2620', border: 'none', borderRadius: 9, padding: '10px 19px', cursor: 'pointer', fontWeight: 600, fontSize: 13.5, whiteSpace: 'nowrap', fontFamily: FONT, boxShadow: '0 2px 8px rgba(176,132,58,.24)' }}>发送</button>
          </div>
          <div style={{ fontSize: 12, color: err ? '#C0453B' : C.text3, marginTop: 8 }}>
            {err || 'DM 会自动抛「💥 事件」、并在故事到头时自动「落幕」；你也能随时手动抛事件 / 叫落幕。「🐑 放养」让角色自己演下去。'}
          </div>
          </>
         )}
        </div>
      </div>
    </div>
  );
}

// ─── 库（角色 + 场景）──────────────────────────────────────────────────────────
function Library({ chars, scenes, onNewChar, onEditChar, onNewScene, onOpenScene, onDeleteScene }) {
  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '30px 40px', maxWidth: 1080, margin: '0 auto', width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <h2 style={h2St}>角色档案</h2>
        <button onClick={onNewChar} style={{ background: C.goldSoft, color: C.goldInk, border: '1px solid #E8CF9C', borderRadius: 9, padding: '8px 16px', cursor: 'pointer', fontFamily: FONT, fontSize: 13.5, fontWeight: 500 }}>＋ 新建角色</button>
      </div>
      {chars.length === 0
        ? <div style={{ padding: '40px 0', color: C.text3, fontSize: 14, textAlign: 'center' }}>还没有角色——点右上角「新建角色」开始</div>
        : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14, marginBottom: 46 }}>
          {chars.map((c) => (
            <div key={c.id} onClick={() => onEditChar(c)} style={card}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = c.color + 'aa'; e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 4px 8px rgba(80,60,25,.06), 0 12px 28px rgba(80,60,25,.08)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = card.boxShadow; }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <Av char={c} sz={48} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 18, color: C.text, fontWeight: 600 }}>{c.name}</div>
                  <div style={{ fontSize: 11, color: c.color, marginTop: 2, fontWeight: 500 }}>点击编辑</div>
                </div>
              </div>
              <div style={{ fontSize: 13, color: C.text2, lineHeight: 1.6 }}>{(c.personality || '暂无描述').slice(0, 52)}{c.personality?.length > 52 ? '…' : ''}</div>
            </div>
          ))}
        </div>}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <h2 style={h2St}>剧本场次</h2>
        <button onClick={onNewScene} disabled={chars.length < 1} style={{ background: chars.length ? '#F1ECF8' : 'transparent', color: chars.length ? C.violet : C.text3, border: `1px solid ${chars.length ? '#D6CAEA' : C.border}`, borderRadius: 9, padding: '8px 16px', cursor: chars.length ? 'pointer' : 'not-allowed', fontFamily: FONT, fontSize: 13.5, fontWeight: 500 }}>＋ 布置剧本</button>
      </div>
      {scenes.length === 0
        ? <div style={{ padding: '40px 0', color: C.text3, fontSize: 14, textAlign: 'center' }}>{chars.length ? '点「布置剧本」，挑一段背景、拉几个角色进来各怀鬼胎' : '先创建至少一个角色'}</div>
        : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
          {scenes.map((g) => {
            const gc = g.cast.map((c) => chars.find((x) => x.id === c.characterId)).filter(Boolean);
            const last = g.messages[g.messages.length - 1];
            return (
              <div key={g.id} onClick={() => onOpenScene(g)} style={{ ...card, padding: 0, overflow: 'hidden' }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.violet + '99'; e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 4px 8px rgba(80,60,25,.06), 0 12px 28px rgba(80,60,25,.08)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = card.boxShadow; }}>
                <div style={{ height: 84, background: C.bg2, position: 'relative' }}>
                  <span onClick={(e) => { e.stopPropagation(); if (window.confirm(`确定删除场景「${g.name}」？此操作不可撤销。`)) onDeleteScene(g.id); }} title="删除这个场景"
                    style={{ position: 'absolute', left: 8, top: 8, zIndex: 3, width: 22, height: 22, borderRadius: '50%', background: '#FFFFFFcc', border: '1px solid #EBC6D0', color: C.rose, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>✕</span>
                  {g.bgImage && <img src={g.bgImage} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                  <div style={{ position: 'absolute', inset: 0, background: g.bgImage ? 'linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,.92))' : 'none' }} />
                  <div style={{ position: 'absolute', left: 15, bottom: 9, fontSize: 17, color: C.text, fontWeight: 600 }}>{g.name}</div>
                  {GENRES[g.genre] && <div style={{ position: 'absolute', right: 10, bottom: 9, fontSize: 10.5, color: C.goldInk, fontWeight: 600, background: '#FFFFFFd0', padding: '2px 8px', borderRadius: 5, border: '1px solid #E8CF9C' }}>{GENRES[g.genre].emoji} {GENRES[g.genre].label}</div>}
                  {g.overseerRevealed && <div style={{ position: 'absolute', right: 10, top: 9, fontSize: 10, color: C.rose, fontWeight: 600, background: '#FFFFFFcc', padding: '2px 7px', borderRadius: 5, border: '1px solid #EBC6D0' }}>已暴露</div>}
                </div>
                <div style={{ padding: 15 }}>
                  <div style={{ display: 'flex', marginBottom: 10 }}>
                    {gc.map((c, i) => <div key={c.id} style={{ marginLeft: i ? -9 : 0, zIndex: gc.length - i, borderRadius: '50%', boxShadow: '0 0 0 2px #FFF' }}><Av char={c} sz={27} /></div>)}
                  </div>
                  {last
                    ? <div style={{ fontSize: 12.5, color: C.text2, lineHeight: 1.55 }}><span style={{ color: C.text, fontWeight: 500 }}>{last.type === 'overseer' ? '监察者' : last.type === 'whisper' ? '（私聊）' : last.speakerName || ''}</span> {(last.content || '').slice(0, 38)}{(last.content || '').length > 38 ? '…' : ''}</div>
                    : <div style={{ fontSize: 12.5, color: C.text3, fontStyle: 'italic' }}>{(g.script || '尚未开场').slice(0, 44)}</div>}
                  <div style={{ fontSize: 11, color: C.text3, marginTop: 9 }}>{g.messages.length} 条 · {gc.map((c) => c.name).join('、')}</div>
                </div>
              </div>
            );
          })}
        </div>}
    </div>
  );
}

// ─── 设置 ────────────────────────────────────────────────────────────────────
function Settings({ onClose }) {
  const [data, setData] = useState(() => loadModels()); // { profiles, activeId }
  const [editing, setEditing] = useState(null);          // 正在编辑/新增的档位对象，或 null
  const commit = (next) => { setData(next); saveModels(next); };

  const setActive = (id) => commit({ ...data, activeId: id });
  const removeProfile = (id) => {
    const profiles = data.profiles.filter((p) => p.id !== id);
    commit({ profiles, activeId: data.activeId === id ? (profiles[0]?.id || null) : data.activeId });
  };
  const startAdd = () => setEditing({ id: genId(), label: '', provider: 'openrouter', model: '', key: '', extra: '' });
  const saveEditing = () => {
    const p = { ...editing, label: editing.label.trim() || PROVIDERS[editing.provider]?.label || '模型', model: editing.model.trim() };
    const exists = data.profiles.some((x) => x.id === p.id);
    const profiles = exists ? data.profiles.map((x) => (x.id === p.id ? p : x)) : [...data.profiles, p];
    commit({ profiles, activeId: data.activeId || p.id });
    setEditing(null);
  };

  const shell = (children) => (
    <div onClick={() => onClose(true)} style={{ position: 'fixed', inset: 0, background: 'rgba(43,38,32,.42)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: 26, width: 500, maxWidth: '92vw', maxHeight: '88vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(60,45,20,.25)' }}>
        {children}
      </div>
    </div>
  );

  // ── 编辑 / 新增一个档位 ──
  if (editing) {
    const ed = editing;
    const set = (k, v) => setEditing((s) => ({ ...s, [k]: v }));
    const prov = PROVIDERS[ed.provider] || PROVIDERS.deepseek;
    return shell(<>
      <h3 style={{ ...h2St, fontSize: 20, marginBottom: 18 }}>{data.profiles.some((x) => x.id === ed.id) ? '编辑模型档位' : '新增模型档位'}</h3>
      <label style={labelSt}>供应商</label>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {PROVIDER_ORDER.map((id) => {
          const on = ed.provider === id;
          return (
            <button key={id} onClick={() => set('provider', id)}
              style={{ background: on ? C.goldSoft : C.surface, color: on ? C.goldInk : C.text2, border: `1.5px solid ${on ? '#E8CF9C' : C.border}`, borderRadius: 9, padding: '8px 16px', cursor: 'pointer', fontSize: 13.5, fontWeight: on ? 600 : 500, fontFamily: FONT }}>
              {PROVIDERS[id].label}
            </button>
          );
        })}
      </div>
      <label style={labelSt}>档位名称（自己看的标签）</label>
      <input value={ed.label} onChange={(e) => set('label', e.target.value)} placeholder={`例：${prov.label} · 主力`} style={{ ...inputSt, marginBottom: 16 }} />
      {ed.provider === 'custom' && <>
        <label style={labelSt}>接口地址 · Base URL</label>
        <input value={ed.baseUrl || ''} onChange={(e) => set('baseUrl', e.target.value)} placeholder="https://openrouter.ai/api/v1　或　http://localhost:1234/v1" style={{ ...inputSt, marginBottom: 4, fontFamily: MONO, fontSize: 13 }} />
        <p style={{ fontSize: 11.5, color: C.text3, lineHeight: 1.5, marginBottom: 16 }}>填到 <code>/v1</code> 这一层即可，会自动补 <code>/chat/completions</code>。浏览器直连，需对方允许跨域（CORS）。</p>
      </>}
      <label style={labelSt}>模型</label>
      <input value={ed.model} onChange={(e) => set('model', e.target.value)} placeholder={prov.modelPh} style={{ ...inputSt, marginBottom: 4 }} />
      <p style={{ fontSize: 11.5, color: C.text3, lineHeight: 1.5, marginBottom: 16 }}>{prov.modelHint}</p>
      <label style={labelSt}>API Key</label>
      <input value={ed.key} onChange={(e) => set('key', e.target.value)} placeholder={prov.keyPh} style={{ ...inputSt, marginBottom: 16 }} />
      <label style={labelSt}>额外请求参数 · JSON（可选）</label>
      <textarea value={ed.extra} onChange={(e) => set('extra', e.target.value)} rows={2}
        placeholder={'关思考(最快)：{"thinking": {"type": "disabled"}}　·　调深度：{"reasoning_effort": "low"}'}
        style={{ ...inputSt, marginBottom: 6, resize: 'vertical', fontFamily: MONO, fontSize: 12.5, lineHeight: 1.5 }} />
      <p style={{ fontSize: 11.5, color: C.text3, lineHeight: 1.55, marginBottom: 22 }}>原样并入该档位的每次请求（覆盖默认参数）。留空 = 用默认；填错的 JSON 会被忽略。</p>
      <div style={{ display: 'flex', gap: 12 }}>
        <button onClick={saveEditing} style={primaryBtn(true)}>保存档位</button>
        <button onClick={() => setEditing(null)} style={ghostBtn}>取消</button>
      </div>
    </>);
  }

  // ── 档位列表 ──
  return shell(<>
    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
      <h3 style={{ ...h2St, fontSize: 21 }}>设置 · 模型档位</h3>
      <div style={{ flex: 1 }} />
      <button onClick={startAdd} style={{ background: '#F1ECF8', color: C.violet, border: '1px solid #D6CAEA', borderRadius: 9, padding: '7px 14px', cursor: 'pointer', fontFamily: FONT, fontSize: 13, fontWeight: 500 }}>＋ 新增</button>
    </div>
    <p style={{ fontSize: 12.5, color: C.text2, lineHeight: 1.65, marginBottom: 18 }}>配置多套模型（DeepSeek / OpenRouter / Gemini），点一下切换当前激活的那套。激活档位没 key 时，全程用内置「假演员」跑通流程。key 只存在你本地浏览器，不上传。</p>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginBottom: 22 }}>
      {data.profiles.map((p) => {
        const on = p.id === data.activeId;
        const prov = PROVIDERS[p.provider] || {};
        const keyed = !!(p.key || (p.provider === 'deepseek' && import.meta.env.VITE_DEEPSEEK_API_KEY));
        return (
          <div key={p.id} onClick={() => setActive(p.id)} title="点击激活这套模型"
            style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 12, cursor: 'pointer', background: on ? C.goldSoft : C.surface, border: `1.5px solid ${on ? '#E8CF9C' : C.border}`, transition: 'all .15s' }}>
            <div style={{ width: 16, height: 16, borderRadius: '50%', flexShrink: 0, border: `2px solid ${on ? C.gold : C.borderStrong}`, background: on ? C.gold : 'transparent', boxShadow: on ? `0 0 0 3px ${C.gold}22` : 'none' }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 14.5, fontWeight: 600, color: C.text }}>{p.label || prov.label || '模型'}</span>
                <span style={{ fontSize: 10.5, color: C.violet, background: '#F1ECF8', border: '1px solid #E0D6F0', borderRadius: 6, padding: '1px 7px', fontWeight: 600 }}>{prov.label || p.provider}</span>
                {on && <span style={{ fontSize: 10.5, color: C.goldInk, fontWeight: 700, letterSpacing: '.04em' }}>· 激活中</span>}
                {!keyed && <span style={{ fontSize: 10.5, color: '#B06A3C' }}>· 无 key</span>}
              </div>
              <div style={{ fontSize: 12, color: C.text3, fontFamily: MONO, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.model || prov.modelPh || '（未填模型）'}</div>
            </div>
            <button onClick={(e) => { e.stopPropagation(); setEditing({ ...p }); }} style={{ ...ghostBtn, padding: '6px 12px', fontSize: 12.5 }}>编辑</button>
            <button onClick={(e) => { e.stopPropagation(); if (window.confirm(`删除档位「${p.label || prov.label}」？`)) removeProfile(p.id); }} title="删除"
              style={{ background: 'transparent', color: C.rose, border: '1px solid #EBC6D0', borderRadius: 8, padding: '6px 10px', cursor: 'pointer', fontSize: 12.5, fontFamily: FONT }}>✕</button>
          </div>
        );
      })}
      {data.profiles.length === 0 && <div style={{ padding: '18px 0', textAlign: 'center', color: C.text3, fontSize: 13 }}>还没有档位——点右上角「＋ 新增」加一套</div>}
    </div>
    <div style={{ display: 'flex', gap: 12 }}>
      <button onClick={() => onClose(true)} style={primaryBtn(true)}>完成</button>
    </div>
  </>);
}

// ─── 根组件 ──────────────────────────────────────────────────────────────────
export default function App() {
  const [chars, setChars] = useState([]);
  const [scenes, setScenes] = useState([]);
  const [view, setView] = useState('lib');
  const [editChar, setEditChar] = useState(null);
  const [activeId, setActiveId] = useState(null);
  const [ready, setReady] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [, force] = useState(0);

  useEffect(() => {
    (async () => {
      let c = await idb.get('aipub-chars');
      let s = await idb.get('aipub-scenes');
      // 首次：把旧的 localStorage 存档迁移进 IndexedDB（各自独立判断，避免半迁移）
      if (c == null) { const lc = store.get('aipub-chars'); if (lc) { c = lc; await idb.set('aipub-chars', lc); } }
      if (s == null) { const ls = store.get('aipub-scenes'); if (ls) { s = ls; await idb.set('aipub-scenes', ls); } }
      setChars(c || []);
      setScenes(s || []);
      setReady(true);
    })();
  }, []);

  const saveChars = (u) => { setChars(u); idb.set('aipub-chars', u); };
  const saveScenes = (u) => {
    setScenes(u); // 内存里保留完整数据（含全知调试），当前这局展开全知照样能看
    // 但持久化到 localStorage 时，剥掉"全知"留下的超大调试数据（完整 prompt + 原始 JSON）——
    // 否则长局会把 ~5MB 的存档撑爆，导致保存静默失败、刷新后内容大段丢失
    const slim = u.map((sc) => ({
      ...sc,
      messages: sc.messages.map((m) => {
        if (!m.dm && !m.actorPrompt) return m;
        const { dm, actorPrompt, ...rest } = m;
        return rest;
      }),
    }));
    idb.set('aipub-scenes', slim);
  };

  const handleSaveChar = (f) => {
    const u = editChar ? chars.map((c) => (c.id === editChar.id ? { ...c, ...f } : c)) : [...chars, { ...f, id: genId() }];
    saveChars(u); setView('lib');
  };
  const handleDeleteChar = (id) => { saveChars(chars.filter((c) => c.id !== id)); setView('lib'); };
  const handleDeleteScene = (id) => { saveScenes(scenes.filter((g) => g.id !== id)); };
  const handleSaveScene = ({ name, bgImage, script, dmScript, genre, cast }) => {
    const base = { id: genId(), name, bgImage, script, dmScript: dmScript || '', genre: genre || 'suspense', cast, messages: [], extras: [], outIds: [], overseerRevealed: false, ended: false };
    const g = normalizeScene(base); // 初始化 world（第1日·入夜）+ 每角色 actorState（active + 题材属性默认值）
    saveScenes([...scenes, g]); setActiveId(g.id); setView('stage');
  };
  const handleUpdateScene = (u) => saveScenes(scenes.map((g) => (g.id === u.id ? u : g)));

  const active = scenes.find((g) => g.id === activeId);
  const mode = hasKey() ? (PROVIDERS[cfg.active()?.provider]?.label || '模型') : '假演员';

  if (!ready) return <div style={{ height: '100vh', background: C.bg }} />;

  return (
    <>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html, body, #root { height: 100%; }
        ::-webkit-scrollbar { width: 9px; height: 9px; }
        ::-webkit-scrollbar-thumb { background: #DDD2BE; border-radius: 5px; }
        ::-webkit-scrollbar-thumb:hover { background: #CDBFA4; }
        ::-webkit-scrollbar-track { background: transparent; }
        input::placeholder, textarea::placeholder { color: #BBB09C; }
        input:focus, textarea:focus, select:focus { border-color: ${C.gold} !important; box-shadow: 0 0 0 3px rgba(176,132,58,.13); }
        .blink { animation: blink 1s step-end infinite; color: ${C.gold}; }
        @keyframes blink { 50% { opacity: 0; } }
        .tdot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: ${C.gold}; animation: tbounce 1.1s infinite ease-in-out; }
        .tdot:nth-child(2) { animation-delay: .16s; }
        .tdot:nth-child(3) { animation-delay: .32s; }
        @keyframes tbounce { 0%, 80%, 100% { transform: translateY(0); opacity: .4; } 40% { transform: translateY(-5px); opacity: 1; } }
        button { transition: filter .15s, background .15s, box-shadow .15s; }
        button:hover:not(:disabled) { filter: brightness(.975); }
        .menu-item { transition: background .12s; }
        .menu-item:hover { background: #F4EEE2; filter: none; }
      `}</style>
      <div style={{ height: '100vh', background: 'radial-gradient(1100px 540px at 72% -8%, #FFFDF7, #FAF6EF 62%)', color: C.text, display: 'flex', flexDirection: 'column', fontFamily: FONT }}>
        <div style={{ padding: '13px 28px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0, background: 'rgba(255,255,255,.72)', backdropFilter: 'blur(8px)' }}>
          <button onClick={() => setView('lib')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'baseline', gap: 9 }}>
            <span style={{ fontSize: 18 }}>🍸</span>
            <span style={{ fontFamily: SERIF, fontSize: 22, color: C.gold, fontStyle: 'italic', letterSpacing: '.01em' }}>AI&nbsp;Pub</span>
            <span style={{ fontSize: 15, color: C.text2, fontWeight: 500 }}>· 私人会所</span>
          </button>
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 12, color: C.text3 }}>{chars.length} 角色 · {scenes.length} 场</span>
          <button onClick={() => setSettingsOpen(true)} style={{ background: hasKey() ? '#EAF2E8' : '#FBEFE5', color: hasKey() ? C.green : '#B06A3C', border: `1px solid ${hasKey() ? '#C6DBC3' : '#EBD0B4'}`, borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 500, fontFamily: FONT }}>⚙ {mode}</button>
        </div>

        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {view === 'lib' && <Library chars={chars} scenes={scenes}
            onNewChar={() => { setEditChar(null); setView('char'); }}
            onEditChar={(c) => { setEditChar(c); setView('char'); }}
            onNewScene={() => setView('scene')}
            onOpenScene={(g) => { setActiveId(g.id); setView('stage'); }}
            onDeleteScene={handleDeleteScene} />}
          {view === 'char' && <CharForm initial={editChar} chars={chars} onSave={handleSaveChar} onDelete={handleDeleteChar} onBack={() => setView('lib')} />}
          {view === 'scene' && <SceneCreator chars={chars} onSave={handleSaveScene} onBack={() => setView('lib')} />}
          {view === 'stage' && active && <Stage scene={active} chars={chars} onUpdate={handleUpdateScene} onBack={() => setView('lib')} />}
        </div>
      </div>

      {settingsOpen && <Settings onClose={(changed) => { setSettingsOpen(false); if (changed) force((n) => n + 1); }} />}
    </>
  );
}
