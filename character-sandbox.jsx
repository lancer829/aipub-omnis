import { useState, useEffect, useRef } from "react";

// ─── Constants ───────────────────────────────────────────────────────────────
const COLORS = ['#c9a84c','#7c6cd4','#4cb8c4','#c94c7c','#5ec95e','#c9724c','#4c7cc9','#c44c9a'];
const genId = () => Math.random().toString(36).slice(2, 10);
const hm = () => new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

// ─── Storage ──────────────────────────────────────────────────────────────────
const store = {
  async get(k) {
    try { const r = await window.storage.get(k); return r ? JSON.parse(r.value) : null; }
    catch { return null; }
  },
  async set(k, v) { try { await window.storage.set(k, JSON.stringify(v)); } catch {} }
};

// ─── Conductor Prompt ────────────────────────────────────────────────────────
function buildPrompt(chars, messages) {
  const roster = chars.map(c =>
    `【${c.name}】\n性格：${c.personality || '未填写'}\n爱好：${c.hobbies || '未填写'}\n说话风格：${c.speechStyle || '未填写'}\n背景：${c.background || '未填写'}`
  ).join('\n\n');
  const hist = messages.length
    ? messages.map(m => m.type === 'director' ? `[导演旁白]: ${m.content}` : `${m.speakerName}: ${m.content}`).join('\n')
    : '（对话尚未开始）';
  return `你是剧场导演助手，负责让以下虚构角色进行真实对话演绎。

=== 参演角色档案 ===
${roster}

=== 演绎规则 ===
1. 严格按照每个角色的性格和说话风格生成台词
2. 选择在当前情境下最自然、最应该发言的那个角色
3. 台词真实有力，推动剧情，避免无意义重复
4. 台词长度1~4句话，视情境而定
5. 仅输出JSON，绝对不输出其他任何内容
   格式：{"speaker":"角色名字","content":"台词内容"}

=== 当前对话记录 ===
${hist}`;
}

// ─── Avatar ───────────────────────────────────────────────────────────────────
function Av({ char, sz = 36 }) {
  const base = {
    width: sz, height: sz, borderRadius: '50%', flexShrink: 0,
    border: `2px solid ${(char?.color || '#555')}55`,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: (char?.color || '#555') + '22', overflow: 'hidden',
    fontSize: sz * 0.38, color: char?.color || '#888',
    fontFamily: "'Cormorant Garamond', serif", fontWeight: 600, userSelect: 'none',
  };
  return char?.avatar
    ? <img src={char.avatar} style={{ ...base, objectFit: 'cover' }} />
    : <div style={base}>{char?.name?.[0] || '?'}</div>;
}

// ─── Message Bubble ───────────────────────────────────────────────────────────
function Msg({ msg, char }) {
  if (msg.type === 'director') return (
    <div style={{ margin: '12px 0', padding: '10px 14px', borderLeft: '3px solid #c9a84c', background: '#c9a84c10', borderRadius: '0 8px 8px 0' }}>
      <div style={{ fontSize: 10, color: '#c9a84c', fontFamily: "'DM Mono', monospace", marginBottom: 4, letterSpacing: '.06em' }}>导演旁白 · {msg.timestamp}</div>
      <div style={{ fontSize: 14, color: '#d8d5ec', fontStyle: 'italic', lineHeight: 1.65 }}>{msg.content}</div>
    </div>
  );
  if (msg.type === 'system') return (
    <div style={{ textAlign: 'center', margin: '16px 0', fontSize: 11, color: '#4a4868', fontFamily: "'DM Mono', monospace" }}>— {msg.content} —</div>
  );
  const col = char?.color || '#7a7895';
  return (
    <div style={{ display: 'flex', gap: 11, margin: '14px 0', alignItems: 'flex-start' }}>
      <Av char={char} sz={38} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, marginBottom: 6 }}>
          <span style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 17, color: col, fontWeight: 600 }}>{msg.speakerName}</span>
          <span style={{ fontSize: 10, color: '#4a4868', fontFamily: "'DM Mono', monospace" }}>{msg.timestamp}</span>
        </div>
        <div style={{ background: '#191728', borderRadius: '3px 11px 11px 11px', padding: '10px 14px', fontSize: 14, color: '#e2dff0', lineHeight: 1.7, borderLeft: `2px solid ${col}44`, display: 'inline-block', maxWidth: '90%', wordBreak: 'break-word' }}>
          {msg.content}
        </div>
      </div>
    </div>
  );
}

// ─── Character Form ───────────────────────────────────────────────────────────
function CharForm({ initial, chars, onSave, onBack }) {
  const defColor = COLORS[chars.length % COLORS.length];
  const [f, setF] = useState(initial || { name: '', avatar: '', color: defColor, personality: '', hobbies: '', speechStyle: '', background: '' });
  const fileRef = useRef();
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));

  const handleFile = e => {
    const file = e.target.files[0];
    if (!file) return;
    const r = new FileReader();
    r.onload = ev => set('avatar', ev.target.result);
    r.readAsDataURL(file);
  };

  const inputSt = { width: '100%', background: '#0f0e1a', border: '1px solid #252338', color: '#e2dff0', borderRadius: 8, padding: '10px 13px', fontSize: 14, fontFamily: "'DM Sans', sans-serif", outline: 'none', transition: 'border-color .2s' };

  const Field = ({ label, k, ph, rows }) => (
    <div style={{ marginBottom: 18 }}>
      <label style={{ display: 'block', fontSize: 10, color: '#6a6888', marginBottom: 7, textTransform: 'uppercase', letterSpacing: '.1em', fontFamily: "'DM Mono', monospace" }}>{label}</label>
      {rows
        ? <textarea value={f[k]} onChange={e => set(k, e.target.value)} placeholder={ph} rows={rows} style={{ ...inputSt, resize: 'vertical' }} />
        : <input value={f[k]} onChange={e => set(k, e.target.value)} placeholder={ph} style={inputSt} />}
    </div>
  );

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '28px 36px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 30 }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#6a6888', cursor: 'pointer', fontSize: 20, padding: 0, lineHeight: 1 }}>←</button>
        <h2 style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 26, color: '#e2dff0', fontWeight: 400 }}>{initial ? '编辑角色' : '创建新角色'}</h2>
      </div>

      {/* Avatar + color */}
      <div style={{ marginBottom: 26, display: 'flex', alignItems: 'center', gap: 22 }}>
        <div onClick={() => fileRef.current.click()} style={{ width: 80, height: 80, borderRadius: '50%', cursor: 'pointer', border: `2px dashed ${f.color}77`, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', background: f.color + '11', flexShrink: 0, transition: 'border-color .2s' }}>
          {f.avatar
            ? <img src={f.avatar} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <span style={{ color: f.color, fontSize: 28, fontFamily: "'Cormorant Garamond', serif" }}>{f.name?.[0] || '+'}</span>}
        </div>
        <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} style={{ display: 'none' }} />
        <div>
          <div style={{ fontSize: 12, color: '#6a6888', marginBottom: 10 }}>点击上传头像 · 选择主色</div>
          <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
            {COLORS.map(c => (
              <div key={c} onClick={() => set('color', c)} style={{ width: 22, height: 22, borderRadius: '50%', background: c, cursor: 'pointer', border: f.color === c ? '2px solid #e2dff0' : '2px solid transparent', transition: 'border-color .15s', boxShadow: f.color === c ? `0 0 8px ${c}88` : 'none' }} />
            ))}
          </div>
        </div>
      </div>

      <Field label="角色名称" k="name" ph="例：陈锋" />
      <Field label="性格特征" k="personality" ph="例：冷静、多疑、极度理性，鲜少表露情感" />
      <Field label="兴趣爱好" k="hobbies" ph="例：研究密码学、收集旧地图" />
      <Field label="说话风格" k="speechStyle" ph="例：惜字如金，多用短句，偶带讽刺" />
      <Field label="人物背景" k="background" ph="角色的经历、动机、秘密、与其他角色的关系..." rows={4} />

      <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
        <button onClick={() => f.name && onSave(f)} style={{ background: f.name ? '#c9a84c' : '#252338', color: f.name ? '#0a0912' : '#6a6888', border: 'none', borderRadius: 8, padding: '10px 26px', cursor: f.name ? 'pointer' : 'not-allowed', fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: 14, transition: 'all .2s' }}>保存角色</button>
        <button onClick={onBack} style={{ background: 'transparent', color: '#6a6888', border: '1px solid #252338', borderRadius: 8, padding: '10px 22px', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", fontSize: 14 }}>取消</button>
      </div>
    </div>
  );
}

// ─── Group Creator ────────────────────────────────────────────────────────────
function GroupCreator({ chars, onSave, onBack }) {
  const [name, setName] = useState('');
  const [sel, setSel] = useState([]);
  const toggle = id => setSel(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  const ok = name.trim() && sel.length >= 1;

  return (
    <div style={{ padding: '28px 36px', height: '100%', overflowY: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 30 }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#6a6888', cursor: 'pointer', fontSize: 20, padding: 0, lineHeight: 1 }}>←</button>
        <h2 style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 26, color: '#e2dff0', fontWeight: 400 }}>创建演绎场景</h2>
      </div>

      <div style={{ marginBottom: 24 }}>
        <label style={{ display: 'block', fontSize: 10, color: '#6a6888', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.1em', fontFamily: "'DM Mono', monospace" }}>场景名称</label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="例：废弃工厂的对峙"
          style={{ width: '100%', background: '#0f0e1a', border: '1px solid #252338', color: '#e2dff0', borderRadius: 8, padding: '10px 13px', fontSize: 14, fontFamily: "'DM Sans', sans-serif", outline: 'none' }} />
      </div>

      <div style={{ marginBottom: 30 }}>
        <label style={{ display: 'block', fontSize: 10, color: '#6a6888', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '.1em', fontFamily: "'DM Mono', monospace" }}>
          参演角色 {sel.length > 0 && <span style={{ color: '#c9a84c' }}>· 已选 {sel.length} 位</span>}
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(175px, 1fr))', gap: 12 }}>
          {chars.map(c => (
            <div key={c.id} onClick={() => toggle(c.id)} style={{ padding: '13px 15px', borderRadius: 10, cursor: 'pointer', border: `1px solid ${sel.includes(c.id) ? c.color : '#252338'}`, background: sel.includes(c.id) ? c.color + '18' : '#0f0e1a', display: 'flex', alignItems: 'center', gap: 11, transition: 'all .15s' }}>
              <Av char={c} sz={36} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 15, color: '#e2dff0', fontFamily: "'Cormorant Garamond', serif" }}>{c.name}</div>
                <div style={{ fontSize: 11, color: '#6a6888', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{(c.personality || '').slice(0, 16)}{c.personality?.length > 16 ? '…' : ''}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12 }}>
        <button onClick={() => ok && onSave({ name: name.trim(), characterIds: sel })}
          style={{ background: ok ? '#c9a84c' : '#252338', color: ok ? '#0a0912' : '#6a6888', border: 'none', borderRadius: 8, padding: '10px 26px', cursor: ok ? 'pointer' : 'not-allowed', fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: 14, transition: 'all .2s' }}>
          开始演绎
        </button>
        <button onClick={onBack} style={{ background: 'transparent', color: '#6a6888', border: '1px solid #252338', borderRadius: 8, padding: '10px 22px', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", fontSize: 14 }}>取消</button>
      </div>
    </div>
  );
}

// ─── Stage (Chat) ─────────────────────────────────────────────────────────────
function Stage({ group, chars, onUpdate, onBack }) {
  const [inp, setInp] = useState('');
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const playRef = useRef(false);
  const loadRef = useRef(false);
  const endRef = useRef();
  const charsRef = useRef(chars);
  charsRef.current = chars;

  const charMap = Object.fromEntries(chars.map(c => [c.id, c]));
  const stageChars = group.characterIds.map(id => charMap[id]).filter(Boolean);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [group.messages]);

  const nextLine = async (cur) => {
    if (!playRef.current || loadRef.current) return;
    loadRef.current = true;
    setLoading(true);
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 600,
          system: buildPrompt(charsRef.current.filter(c => cur.characterIds.includes(c.id)), cur.messages),
          messages: [{ role: 'user', content: '请继续演绎，输出下一句台词的JSON。' }]
        })
      });
      const data = await res.json();
      const raw = data.content?.find(b => b.type === 'text')?.text || '';
      const s = raw.indexOf('{'), e = raw.lastIndexOf('}');
      const parsed = JSON.parse(raw.slice(s, e + 1));
      const char = charsRef.current.find(c => c.name === parsed.speaker);
      const newMsg = { id: genId(), type: 'character', speakerName: parsed.speaker, characterId: char?.id || null, content: parsed.content, timestamp: hm() };
      const next = { ...cur, messages: [...cur.messages, newMsg] };
      onUpdate(next);
      loadRef.current = false;
      setLoading(false);
      if (playRef.current) setTimeout(() => nextLine(next), 2000);
      else setPlaying(false);
    } catch (err) {
      console.error(err);
      loadRef.current = false;
      setLoading(false);
      setPlaying(false);
      playRef.current = false;
    }
  };

  const handlePlay = () => {
    if (playing) { playRef.current = false; setPlaying(false); }
    else { playRef.current = true; setPlaying(true); nextLine(group); }
  };

  const handleSend = () => {
    if (!inp.trim()) return;
    const msg = { id: genId(), type: 'director', speakerName: '导演', content: inp.trim(), timestamp: hm() };
    const next = { ...group, messages: [...group.messages, msg] };
    onUpdate(next);
    setInp('');
    if (!loadRef.current) {
      playRef.current = true;
      setPlaying(true);
      setTimeout(() => nextLine(next), 300);
    }
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ padding: '13px 24px', borderBottom: '1px solid #1a1828', display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0, background: '#0e0d18' }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#6a6888', cursor: 'pointer', fontSize: 20, padding: 0, lineHeight: 1 }}>←</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 20, color: '#e2dff0' }}>{group.name}</div>
          <div style={{ fontSize: 11, color: '#4a4868', marginTop: 1, fontFamily: "'DM Mono', monospace", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{stageChars.map(c => c.name).join(' · ')}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ display: 'flex' }}>
            {stageChars.map((c, i) => <div key={c.id} style={{ marginLeft: i ? -10 : 0, zIndex: stageChars.length - i }}><Av char={c} sz={28} /></div>)}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: playing ? '#5ec95e' : '#4a4868', boxShadow: playing ? '0 0 8px #5ec95e' : 'none', transition: 'all .4s' }} />
            <span style={{ fontSize: 11, color: playing ? '#5ec95e' : '#4a4868', fontFamily: "'DM Mono', monospace", transition: 'color .4s' }}>{playing ? 'LIVE' : 'IDLE'}</span>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px 8px' }}>
        {group.messages.length === 0 && (
          <div style={{ textAlign: 'center', padding: '64px 24px', color: '#4a4868' }}>
            <div style={{ fontSize: 32, marginBottom: 16 }}>🎭</div>
            <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 18, marginBottom: 8 }}>场景等待开幕</div>
            <div style={{ fontSize: 13 }}>输入旁白或场景描述，让角色开始演绎</div>
          </div>
        )}
        {group.messages.map(msg => <Msg key={msg.id} msg={msg} char={msg.characterId ? charMap[msg.characterId] : null} />)}
        {loading && (
          <div style={{ display: 'flex', gap: 5, padding: '6px 0 6px 50px', alignItems: 'center' }}>
            {[0, 0.18, 0.36].map(d => <div key={d} style={{ width: 5, height: 5, borderRadius: '50%', background: '#c9a84c', animation: `dot 1.1s ${d}s infinite` }} />)}
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Input bar */}
      <div style={{ padding: '14px 24px', borderTop: '1px solid #1a1828', background: '#0e0d18', flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <div style={{ flex: 1, position: 'relative' }}>
            <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 10, color: '#c9a84c', fontFamily: "'DM Mono', monospace", pointerEvents: 'none', letterSpacing: '.06em' }}>导演</span>
            <input value={inp} onChange={e => setInp(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              placeholder="输入旁白、场景描述或导演指令..."
              style={{ width: '100%', background: '#141320', border: '1px solid #252338', color: '#e2dff0', borderRadius: 10, padding: '11px 13px 11px 50px', fontSize: 14, fontFamily: "'DM Sans', sans-serif", outline: 'none' }} />
          </div>
          <button onClick={handleSend} style={{ background: '#c9a84c', color: '#0a0912', border: 'none', borderRadius: 10, padding: '11px 20px', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap' }}>发送</button>
          <button onClick={handlePlay} style={{ background: playing ? '#2a1414' : '#141320', color: playing ? '#ff7070' : '#c9a84c', border: `1px solid ${playing ? '#ff707033' : '#252338'}`, borderRadius: 10, padding: '11px 16px', cursor: 'pointer', fontFamily: "'DM Mono', monospace", fontSize: 12, whiteSpace: 'nowrap', transition: 'all .2s', minWidth: 72 }}>
            {playing ? '⏸ 暂停' : '▶ 自动'}
          </button>
        </div>
        <div style={{ fontSize: 11, color: '#3e3c58', marginTop: 7, paddingLeft: 2 }}>Enter 发送 · 发送后自动触发一轮回应 · 自动模式持续演绎直到暂停</div>
      </div>
    </div>
  );
}

// ─── Library ──────────────────────────────────────────────────────────────────
function Library({ chars, groups, onNewChar, onEditChar, onNewGroup, onOpenGroup }) {
  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '28px 36px' }}>
      {/* Characters */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <h2 style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 22, color: '#e2dff0', fontWeight: 400, letterSpacing: '.02em' }}>角色档案</h2>
        <button onClick={onNewChar} style={{ background: '#c9a84c18', color: '#c9a84c', border: '1px solid #c9a84c44', borderRadius: 8, padding: '7px 16px', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", fontSize: 13 }}>+ 新建角色</button>
      </div>
      {chars.length === 0
        ? <div style={{ padding: '36px 0', color: '#4a4868', fontSize: 14, textAlign: 'center', fontStyle: 'italic' }}>还没有角色——点击右上角「新建角色」开始</div>
        : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 14, marginBottom: 44 }}>
          {chars.map(c => (
            <div key={c.id} onClick={() => onEditChar(c)}
              style={{ background: '#0f0e1a', borderRadius: 12, padding: 18, border: '1px solid #1e1c30', cursor: 'pointer', transition: 'border-color .2s' }}
              onMouseEnter={e => e.currentTarget.style.borderColor = c.color + '88'}
              onMouseLeave={e => e.currentTarget.style.borderColor = '#1e1c30'}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 11 }}>
                <Av char={c} sz={46} />
                <div>
                  <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 19, color: '#e2dff0' }}>{c.name}</div>
                  <div style={{ fontSize: 10, color: c.color, fontFamily: "'DM Mono', monospace", marginTop: 2, letterSpacing: '.04em' }}>点击编辑</div>
                </div>
              </div>
              <div style={{ fontSize: 13, color: '#7a7895', lineHeight: 1.55 }}>{(c.personality || '暂无描述').slice(0, 52)}{c.personality?.length > 52 ? '…' : ''}</div>
            </div>
          ))}
        </div>}

      {/* Groups */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <h2 style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 22, color: '#e2dff0', fontWeight: 400, letterSpacing: '.02em' }}>演绎场景</h2>
        <button onClick={onNewGroup} disabled={chars.length < 1}
          style={{ background: chars.length ? '#7c6cd418' : 'transparent', color: chars.length ? '#7c6cd4' : '#4a4868', border: `1px solid ${chars.length ? '#7c6cd444' : '#1e1c30'}`, borderRadius: 8, padding: '7px 16px', cursor: chars.length ? 'pointer' : 'not-allowed', fontFamily: "'DM Sans', sans-serif", fontSize: 13 }}>
          + 新建场景
        </button>
      </div>
      {groups.length === 0
        ? <div style={{ padding: '36px 0', color: '#4a4868', fontSize: 14, textAlign: 'center', fontStyle: 'italic' }}>{chars.length ? '点击「新建场景」将角色拉进同一个房间' : '先创建至少一个角色'}</div>
        : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 14 }}>
          {groups.map(g => {
            const gc = g.characterIds.map(id => chars.find(c => c.id === id)).filter(Boolean);
            const last = g.messages[g.messages.length - 1];
            return (
              <div key={g.id} onClick={() => onOpenGroup(g)}
                style={{ background: '#0f0e1a', borderRadius: 12, padding: 18, border: '1px solid #1e1c30', cursor: 'pointer', transition: 'border-color .2s' }}
                onMouseEnter={e => e.currentTarget.style.borderColor = '#7c6cd4'}
                onMouseLeave={e => e.currentTarget.style.borderColor = '#1e1c30'}>
                <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 19, color: '#e2dff0', marginBottom: 11 }}>{g.name}</div>
                <div style={{ display: 'flex', marginBottom: 11 }}>
                  {gc.map((c, i) => <div key={c.id} style={{ marginLeft: i ? -9 : 0, zIndex: gc.length - i }}><Av char={c} sz={28} /></div>)}
                </div>
                {last && <div style={{ fontSize: 12, color: '#7a7895', lineHeight: 1.5, fontStyle: 'italic', marginBottom: 8 }}>
                  <span style={{ color: '#9a98b5' }}>{last.speakerName}:</span> {last.content.slice(0, 42)}{last.content.length > 42 ? '…' : ''}
                </div>}
                <div style={{ fontSize: 10, color: '#4a4868', fontFamily: "'DM Mono', monospace" }}>{g.messages.length} 条消息 · {gc.map(c => c.name).join('、')}</div>
              </div>
            );
          })}
        </div>}
    </div>
  );
}

// ─── Root App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [chars, setChars] = useState([]);
  const [groups, setGroups] = useState([]);
  const [view, setView] = useState('lib');
  const [editChar, setEditChar] = useState(null);
  const [activeGroup, setActiveGroup] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      const c = await store.get('sb2-chars');
      const g = await store.get('sb2-groups');
      if (c) setChars(c);
      if (g) setGroups(g);
      setReady(true);
    })();
  }, []);

  const saveChars = async u => { setChars(u); await store.set('sb2-chars', u); };
  const saveGroups = async u => { setGroups(u); await store.set('sb2-groups', u); };

  const handleSaveChar = async f => {
    const updated = editChar ? chars.map(c => c.id === editChar.id ? { ...c, ...f } : c) : [...chars, { ...f, id: genId() }];
    await saveChars(updated);
    setView('lib');
  };

  const handleSaveGroup = async ({ name, characterIds }) => {
    const g = { id: genId(), name, characterIds, messages: [] };
    const updated = [...groups, g];
    await saveGroups(updated);
    setActiveGroup(g);
    setView('stage');
  };

  const handleUpdateGroup = async updated => {
    const next = groups.map(g => g.id === updated.id ? updated : g);
    await saveGroups(next);
    setActiveGroup(updated);
  };

  if (!ready) return (
    <div style={{ height: '100vh', background: '#0c0b10', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#4a4868', fontFamily: "'DM Mono', monospace", fontSize: 13 }}>
      Loading...
    </div>
  );

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;1,400&family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 3px; }
        ::-webkit-scrollbar-thumb { background: #252338; border-radius: 2px; }
        input, textarea { color-scheme: dark; }
        input:focus, textarea:focus { border-color: #c9a84c !important; }
        input::placeholder, textarea::placeholder { color: #4a4868; }
        @keyframes dot { 0%,80%,100% { opacity:.2; transform:scale(.75); } 40% { opacity:1; transform:scale(1); } }
      `}</style>
      <div style={{ height: '100vh', background: '#0c0b10', color: '#e2dff0', display: 'flex', flexDirection: 'column', fontFamily: "'DM Sans', sans-serif" }}>
        {/* Topbar */}
        <div style={{ padding: '13px 28px', borderBottom: '1px solid #141220', display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0, background: '#0a0912' }}>
          <button onClick={() => setView('lib')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 18 }}>🎭</span>
            <span style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 22, color: '#c9a84c', fontWeight: 400, letterSpacing: '.05em' }}>角色沙盒</span>
          </button>
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 10, color: '#3e3c58', fontFamily: "'DM Mono', monospace", letterSpacing: '.06em' }}>{chars.length} 角色 · {groups.length} 场景</span>
        </div>

        {/* Main */}
        <div style={{ flex: 1, overflow: 'hidden' }}>
          {view === 'lib' && <Library chars={chars} groups={groups}
            onNewChar={() => { setEditChar(null); setView('char'); }}
            onEditChar={c => { setEditChar(c); setView('char'); }}
            onNewGroup={() => setView('group')}
            onOpenGroup={g => { setActiveGroup(g); setView('stage'); }} />}
          {view === 'char' && <CharForm initial={editChar} chars={chars} onSave={handleSaveChar} onBack={() => setView('lib')} />}
          {view === 'group' && <GroupCreator chars={chars} onSave={handleSaveGroup} onBack={() => setView('lib')} />}
          {view === 'stage' && activeGroup && <Stage
            group={groups.find(g => g.id === activeGroup.id) || activeGroup}
            chars={chars}
            onUpdate={handleUpdateGroup}
            onBack={() => setView('lib')} />}
        </div>
      </div>
    </>
  );
}
