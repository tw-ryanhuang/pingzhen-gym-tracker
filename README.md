# 平鎮健身房人潮指南

Cloudflare Worker 與 D1 製作的手機人潮報表。

- 台灣時間 06:00–21:55，每五分鐘採樣。
- 保留館方原始人數，不扣除疑似殘留值。
- 半小時熱門時段、連續一小時建議、資料更新狀態。
- 報表免登入，提供最近 56 天 CSV。

## 部署

Cloudflare Workers Builds 已連接此儲存庫，正式分支為 `main`。
推送提交後使用 `npm run deploy` 建置部署；結果請查看 Cloudflare Deployments 或提交檢查。

部署沿用 `wrangler.jsonc` 指定的既有 `pingzhen-gym` D1 資料庫，不建立或清空資料庫。

程式語法檢查：`npm run check`。

## 待實作

開閉館觀察、零人複查、閉館主畫面、狀態文案、自動更新與當日走勢尚未包含在本版。
