@echo off
chcp 65001 >nul
cd /d "%~dp0"

rem ============================================================
rem  仅当你要用 Gemini 时才需要这段（Google 在国内被墙，而 Node
rem  又不走系统代理，得让它借道你的梯子本地端口；无需全局开 TUN）。
rem  下面默认 7897（Clash Verge 默认端口）。换别的客户端改一下：
rem  Clash 通常 7890，V2RayN 通常 10809。
rem  · 系统已设过 HTTPS_PROXY 就用现成的（下面这行会自动跳过）。
rem  · 只用 DeepSeek / OpenRouter、不碰 Gemini：这行留着无妨（只对 Gemini 生效）。
if not defined HTTPS_PROXY set HTTPS_PROXY=http://127.0.0.1:7897
rem ============================================================

echo ============================================
echo   AI Pub 正在启动...
echo   稍等几秒，然后用浏览器打开：
echo   http://localhost:5173/
echo.
echo   这个黑窗口不要关（关了服务就停）。
echo   玩完了，直接关掉这个窗口即可。
echo.
if defined HTTPS_PROXY echo   Gemini 走代理：%HTTPS_PROXY%
echo ============================================
echo.
npm run dev
pause
