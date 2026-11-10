# 自動部署設定

目前已匯入既有版本；尚未連接 Cloudflare Builds。

1. 將 wrangler.jsonc 的 REQUIRED_EXISTING_D1_DATABASE_ID 換成既有 pingzhen-gym 資料庫 ID。
2. 若 Cloudflare 上有 CLOSED_DATES 等非秘密變數，先同步至 Wrangler 的 vars，避免遺失設定。秘密不要寫入 Git。
3. 到既有 Worker pingzhen-gym-tracker → Settings → Builds → Connect，連接本儲存庫 main 分支。
4. 根目錄使用儲存庫根目錄，Build command 可留空，Deploy command 設為 npm run deploy。
5. 首次部署後確認 DB 綁定、Cron、網站人數與最新紀錄持續更新。

部署腳本會先檢查程式語法與資料庫 ID。此專案不會執行資料庫建立、刪除或清空指令。保留每五分鐘採樣與原始人數，不做殘留人數扣除。

待下一版實作：開閉館觀察、零人複查保留兩次結果、閉館主畫面、狀態文案、畫面自動更新與當日走勢。
