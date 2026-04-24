---
name: astro-wp-tunnel
description: 將本地 WordPress Playground 透過 Cloudflare Tunnel 曝露到外網，給編輯、客戶或 Astro build 管線使用。支援永久網址（需自有 domain 掛在 Cloudflare）與臨時網址兩種模式。
type: tool-usage
triggers:
  - 本地 WordPress 要讓別人看到
  - 要把 localhost:8888 曝露到外網
  - 建立 Cloudflare Tunnel
  - npm run wp:tunnel 設定
---

# Astro WP — Cloudflare Tunnel Skill

把本地 WordPress Playground（`http://localhost:8888`）透過 Cloudflare Tunnel 曝露到網際網路。跨 macOS / Windows / Linux，不需要手動安裝 `cloudflared`（npm 套件內建 binary）。

## 使用時機

- 要讓編輯、客戶從外網連到你本地的 WP
- Astro build 管線部署在其他機器，需要讀本地 WP 的 REST API
- demo 或分享本地開發中的 CMS

## 前置需求

- 專案已完成 `astro-wp` 安裝（有 `scripts/wp-tunnel.mjs` 與 `npm run wp:tunnel`）
- WordPress Playground 已在本地啟動（`npm run wp:start` 或 `npm run dev`）

## 互動流程（給 AI agent 照著做）

### 步驟 1：詢問使用者要用哪種網址

問使用者：

> 你有自己掛在 Cloudflare 的 domain 嗎？（例如 `example.com` 已在 Cloudflare 管理 DNS）
>
> - **有** → 請告訴我要用哪個子網域，例如 `wp.example.com`。會建立永久固定網址。
> - **沒有** → 直接啟動，會拿到 `xxx-xxx.trycloudflare.com` 臨時網址，**每次啟動都會變**。

### 步驟 2A：使用者有 domain（永久網址）

1. 把使用者提供的 hostname 寫入 `wp-bridge.config.ts` 的 `tunnel.hostname`：

   ```ts
   tunnel: {
     hostname: "wp.example.com", // 使用者給的值
   },
   ```

2. 執行：

   ```bash
   npm run wp:tunnel
   ```

3. 第一次執行時腳本會：
   - 自動開瀏覽器執行 `cloudflared tunnel login`（請使用者選擇對應的 Cloudflare zone）
   - 建立 tunnel（名稱由 hostname 衍生）
   - 自動建立 DNS CNAME 記錄
   - 寫入 `~/.cloudflared/<tunnel-id>.yml` 設定檔
   - 啟動 tunnel

4. 之後每次啟動都會用同一個網址 `https://wp.example.com`。

### 步驟 2B：使用者沒有 domain（臨時網址）

1. 確保 `wp-bridge.config.ts` 的 `tunnel.hostname` 是空字串（`""`）。

2. 執行：

   ```bash
   npm run wp:tunnel
   ```

3. **明確告知使用者**：

   > ⚠️ 這是臨時網址，每次啟動都會變。如果需要給人分享的固定網址，請在 Cloudflare 上註冊一個 domain（一年約 10 美金），再切回永久模式。

4. 終端機會印出 `https://xxx-xxx.trycloudflare.com`，使用者可以直接把這個網址分享出去。

### 步驟 3：驗證

使用者訪問 tunnel 網址應該看到 WordPress 首頁。如果看到 404 或空白，檢查：

- 本地 `http://localhost:8888` 是否正常（Playground 是否啟動）
- `wp-bridge.config.ts` 的 port 是否正確

## Host header 自動處理

永久模式的設定檔會自動加上 `httpHostHeader: localhost:8888`，讓 WordPress 收到的請求看起來像來自本地，**不需要修改 WP 的 `siteurl` 或 `home` 設定**。圖片、API 路徑都會維持原狀。

## 疑難排解

| 症狀 | 處理 |
|---|---|
| `cloudflared npm package not found` | 使用者可能沒跑 `npm install`。執行 `npm install cloudflared` 補上 |
| 瀏覽器沒開 | 手動跑 `npx cloudflared tunnel login`，貼 URL 到瀏覽器 |
| DNS route 失敗 | 先到 Cloudflare Dashboard 檢查該 hostname 是否已被其他 CNAME 佔用，刪除後重試 |
| 網址連上但一直 loading | 檢查本地 `http://localhost:8888` 是否真的能通 |
| WordPress 的圖片壞掉 | 確認使用的是永久模式，且 config.yml 有 `httpHostHeader` |

## 不要做的事

- ❌ 不要叫使用者用 `*.workers.dev`（Workers 專用，不能給 Tunnel 用）
- ❌ 不要叫使用者 `brew install cloudflared`（npm 套件已經內建 binary）
- ❌ 不要修改 WordPress 的 `siteurl` / `home`（用 `httpHostHeader` 解決）
- ❌ 不要在 CI 環境跑 `wp:tunnel`（需要互動登入）
