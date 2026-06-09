import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { HttpsProxyAgent } from 'https-proxy-agent';

// 各家都是 OpenAI 兼容接口。浏览器直连会被 CORS 拦，这里用 dev 代理把
// /<provider>/* 转发到各自的 base URL，浏览器只发同源请求（localhost）。
// 新增供应商：在这里加一条代理，并在 App.jsx 的 PROVIDERS 里加同名条目。
// 注意：改完此文件需重启 dev server 才生效。
//
// 国内开发的坑：Node(Vite) 默认不走系统代理，所以被墙的域名（Google / Gemini）连不上，
// 即使浏览器开着梯子也没用 —— 因为请求是 Node 发的，不是浏览器。
// 解决：设环境变量 HTTPS_PROXY=http://127.0.0.1:7890（换成你梯子的本地端口），
// 就让 dev 代理借道它出去，无需全局开 TUN。没设这个变量 = 直连，行为不变。
// 只给「被墙的」Gemini 走上游代理；DeepSeek / OpenRouter 国内能直连，保持直连，
// 这样就算 HTTPS_PROXY 端口填错，也只影响 Gemini，不会拖垮本来能用的两家。
const upstream = process.env.HTTPS_PROXY || process.env.https_proxy || '';
const agent = upstream ? new HttpsProxyAgent(upstream) : undefined;
if (upstream) console.log(`[vite] Gemini 代理经由上游：${upstream}`);
const proxy = (target, extra) => ({ target, changeOrigin: true, secure: true, ...extra });
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/deepseek':   { ...proxy('https://api.deepseek.com'),                          rewrite: (p) => p.replace(/^\/deepseek/, '') },
      '/openrouter': { ...proxy('https://openrouter.ai/api/v1'),                      rewrite: (p) => p.replace(/^\/openrouter/, '') },
      '/gemini':     { ...proxy('https://generativelanguage.googleapis.com/v1beta/openai', agent ? { agent } : {}), rewrite: (p) => p.replace(/^\/gemini/, '') },
    },
  },
});
