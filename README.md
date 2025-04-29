# StreamFetch 視頻流捕獲工具

一個強大的基於 Node.js 和 Puppeteer 的工具，用於從網頁中捕獲和下載視頻流。專門設計用於處理各種流媒體格式，包括 MP4 片段、HLS 流等。

## 功能特點

- 🔍 自動檢測網頁中的視頻元素和資源
- 🎬 支持多種視頻格式 (MP4, HLS, DASH)
- ⚡ 高效下載並保存視頻片段
- 🔄 自動嘗試播放和觸發視頻加載
- 📊 提供下載進度和狀態報告
- 🛠️ 自定義配置選項 (播放時間, 檢查間隔等)
- 🔧 支持手動和自動合併視頻片段

## 安裝要求

- Node.js (版本 12 或更高)
- Chrome 瀏覽器 (用於 Puppeteer)
- FFmpeg (可選，用於視頻處理)

## 安裝步驟

1. 克隆此存儲庫:

```bash
git clone https://github.com/zinojeng/streamfetch.git
cd streamfetch
```

2. 安裝依賴:

```bash
npm install
```

3. 確保您的系統上安裝了 Chrome 瀏覽器。如果需要自定義 Chrome 路徑，請修改腳本中的 `getChromePath` 函數。

## 使用方法

### 基本用法

```bash
node capture-mp4.js
```

### 配置選項

在 `capture-mp4.js` 文件中，您可以修改 `config` 對象來自定義行為:

```javascript
const config = {
  url: '要捕獲視頻的網址',
  playbackTime: 3 * 60 * 1000, // 模擬播放時間 (毫秒)
  checkInterval: 5 * 1000, // 檢查間隔 (毫秒)
  outputDir: './downloads', // 下載目錄
  outputList: 'video_links.txt', // 視頻連結清單
  downloadFiles: true, // 是否下載檔案
  headless: false, // 是否在無頭模式運行
  // ... 其他配置選項
};
```

## 腳本工作流程

1. **網頁導航**: 打開目標網頁
2. **視頻觸發**: 自動尋找並點擊播放按鈕
3. **資源捕獲**: 攔截視頻相關請求和響應
4. **過濾分析**: 識別完整視頻和流媒體片段
5. **下載保存**: 將視頻資源下載到本地

## 處理流媒體視頻

本工具特別處理了以下流媒體格式:

- **HLS (.m3u8)**: 解析播放列表並收集片段 URL
- **MP4 片段**: 識別並下載視頻片段，過濾掉不完整的部分
- **DASH**: 支持基本的 DASH 流識別

## 限制和已知問題

- 某些流媒體片段無法直接使用標準工具合併
- 強加密的視頻流可能無法捕獲
- 某些網站可能有反爬蟲措施
- 下載的視頻片段可能需要特殊的播放器或後處理

## 進階使用

### 使用 FFmpeg 合併下載的視頻

如果下載的是標準 MP4 檔案，可以使用以下命令合併:

```bash
cd downloads
ffmpeg -f concat -safe 0 -i filelist.txt -c copy combined_video.mp4
```

### 處理 HLS 流

下載 HLS 流的完整視頻:

```bash
ffmpeg -i "playlist.m3u8" -c copy video.mp4
```

## 貢獻

歡迎提交 Pull Request 或建立 Issue 來改進此項目。

## 許可證

MIT 許可證 - 詳見 LICENSE 文件

## 免責聲明

本工具僅用於合法下載擁有版權的內容。用戶需自行負責使用本工具的方式和下載的內容。請尊重版權並遵守相關法律法規。
