const fs = require('fs-extra');
const puppeteer = require('puppeteer-core');
const path = require('path');
const os = require('os');
const https = require('https');
const http = require('http');
const url = require('url');

// 根據作業系統取得 Chrome 瀏覽器的預設路徑
function getChromePath() {
  switch (os.platform()) {
    case 'darwin': // macOS
      return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    case 'win32': // Windows
      return 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    case 'linux': // Linux
      return '/usr/bin/google-chrome';
    default:
      return null;
  }
}

// 等待函數，用於替代 page.waitForTimeout
function delay(time) {
  return new Promise(function(resolve) { 
    setTimeout(resolve, time);
  });
}

// 判斷是否為完整 MP4 文件的網址 (而非片段)
function isCompleteVideoUrl(url) {
  // 排除包含這些關鍵字的 URL，它們通常是片段
  const fragmentPatterns = [
    'range=', 'segment', 'frag', 'chunk', 'part', 'moof', 'ts-', 
    'sequence', 'track', '/range/', '/seg-', '-seg', 'dash'
  ];
  
  // 檢查是否含有片段關鍵字
  if (fragmentPatterns.some(pattern => url.includes(pattern))) {
    return false;
  }
  
  // 檢查是否是直接影片檔案而非流片段
  return url.endsWith('.mp4') || url.includes('video/mp4') || 
         url.includes('/mp4/') || url.includes('.m3u8');
}

// 下載文件
async function downloadFile(fileUrl, outputPath) {
  return new Promise((resolve, reject) => {
    // 依據協議選擇 http 或 https
    const httpClient = fileUrl.startsWith('https') ? https : http;
    
    httpClient.get(fileUrl, (response) => {
      // 檢查狀態碼
      if (response.statusCode !== 200) {
        reject(new Error(`下載失敗，狀態碼: ${response.statusCode}`));
        return;
      }
      
      // 獲取響應中的內容類型
      const contentType = response.headers['content-type'] || '';
      console.log(`內容類型: ${contentType}`);
      
      // 檢查是否為m3u8文件 (HLS流)
      if (fileUrl.endsWith('.m3u8') || contentType.includes('application/vnd.apple.mpegurl')) {
        console.log(`發現HLS流: ${fileUrl}`);
        
        let data = '';
        response.on('data', (chunk) => {
          data += chunk;
        });
        
        response.on('end', async () => {
          // 保存m3u8文件
          const m3u8Path = path.join(path.dirname(outputPath), 'playlist.m3u8');
          await fs.writeFile(m3u8Path, data);
          console.log(`HLS播放列表已保存至: ${m3u8Path}`);
          
          // 解析m3u8提取視頻片段
          const lines = data.split('\n');
          const baseUrl = fileUrl.substring(0, fileUrl.lastIndexOf('/') + 1);
          
          // 尋找片段URL
          const segmentUrls = [];
          for (const line of lines) {
            if (!line.startsWith('#') && line.trim() !== '') {
              // 構建完整URL
              const segmentUrl = line.startsWith('http') ? line : new URL(line, baseUrl).toString();
              segmentUrls.push(segmentUrl);
            }
          }
          
          console.log(`找到 ${segmentUrls.length} 個HLS片段`);
          resolve({
            type: 'hls',
            path: m3u8Path,
            segments: segmentUrls
          });
        });
      } else {
        // 一般檔案下載
        const fileStream = fs.createWriteStream(outputPath);
        response.pipe(fileStream);
        
        fileStream.on('finish', () => {
          fileStream.close();
          console.log(`檔案已下載至: ${outputPath}`);
          resolve({
            type: 'file',
            path: outputPath
          });
        });
        
        fileStream.on('error', (err) => {
          fs.unlink(outputPath, () => {}); // 清理不完整檔案
          reject(err);
        });
      }
    }).on('error', (err) => {
      reject(err);
    });
  });
}

// 配置參數
const config = {
  url: 'https://idf2025.cmvirtual.eu/cmvirtualportal/_idf/ba2025/session/0000039320/b46b18b1a2d524cd5fe07930d436cfbac9719994/0000000130',
  playbackTime: 3 * 60 * 1000, // 模擬播放時間延長到 3 分鐘
  checkInterval: 5 * 1000, // 每 5 秒檢查一次網絡請求
  outputDir: './downloads', // 下載檔案儲存目錄
  outputList: 'video_links.txt', // 視頻連結清單檔案
  downloadFiles: true, // 是否自動下載檔案
  headless: false, // 是否在無頭模式下運行瀏覽器
  outputFilename: 'complete_video.mp4', // 合併後的檔案名稱
  chromePath: getChromePath(), // Chrome 瀏覽器路徑
  debugMode: true, // 啟用更多調試輸出
  maxRetries: 3, // 下載重試次數
  pageLoadTimeout: 120000, // 頁面加載超時 (毫秒)
};

(async () => {
  // 確保輸出目錄存在
  await fs.ensureDir(config.outputDir);
  
  const videoLinks = new Set();
  const videoFiles = [];
  const hlsStreams = [];
  const downloadedUrls = new Set(); // 用於跟踪已下載的URL
  let fileCounter = 1; // 用於文件序號

  // 檢查 Chrome 路徑是否有效
  if (!config.chromePath || !await fs.pathExists(config.chromePath)) {
    console.error('無法找到 Chrome 瀏覽器，請在 config 中手動設定 chromePath');
    process.exit(1);
  }

  console.log('啟動瀏覽器...');
  const browser = await puppeteer.launch({
    headless: config.headless ? 'new' : false,
    defaultViewport: null,
    args: ['--start-maximized', '--autoplay-policy=no-user-gesture-required'],
    executablePath: config.chromePath // 使用本機 Chrome 瀏覽器
  });

  const page = await browser.newPage();
  
  // 啟用網絡請求攔截
  await page.setRequestInterception(true);
  
  // 請求攔截 - 捕獲更多可能的視頻格式
  page.on('request', request => {
    // 允許請求繼續
    request.continue();
    
    // 記錄可能的視頻相關請求
    if (config.debugMode) {
      const reqUrl = request.url();
      if (reqUrl.includes('.mp4') || reqUrl.includes('.ts') || reqUrl.includes('.m3u8') || 
          reqUrl.includes('video') || reqUrl.includes('media') || reqUrl.includes('stream')) {
        console.log('潛在視頻請求:', reqUrl);
      }
    }
  });
  
  // 設置下載行為
  if (config.downloadFiles) {
    const client = await page.target().createCDPSession();
    await client.send('Page.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: path.resolve(config.outputDir)
    });
  }

  // 攔截所有的視頻相關請求
  page.on('response', async (response) => {
    const respUrl = response.url();
    const contentType = response.headers()['content-type'] || '';
    
    // 檢查是否為視頻媒體，並重點篩選完整MP4文件
    const isVideoContent = (respUrl.endsWith('.mp4') && isCompleteVideoUrl(respUrl)) || 
                          contentType.includes('video/mp4') || 
                          respUrl.endsWith('.m3u8') || 
                          contentType.includes('application/vnd.apple.mpegurl');
    
    if (isVideoContent) {
      console.log(`發現視頻源: ${respUrl}`);
      console.log(`內容類型: ${contentType}`);
      
      // 篩選出很可能是完整視頻的URL
      if (isCompleteVideoUrl(respUrl)) {
        console.log(`發現完整視頻: ${respUrl}`);
        videoLinks.add(respUrl);
        
        if (config.downloadFiles && !downloadedUrls.has(respUrl)) {
          try {
            // 使用序號命名
            const urlObj = new URL(respUrl);
            const originalFilename = path.basename(urlObj.pathname) || 'video.mp4';
            const fileExt = path.extname(originalFilename) || '.mp4'; // 如果沒有擴展名,使用.mp4
            const baseName = path.basename(originalFilename, fileExt);
            
            // 生成帶序號的唯一文件名
            const paddedCounter = String(fileCounter).padStart(4, '0'); // 四位數序號
            const filename = `${paddedCounter}_${baseName}${fileExt}`;
            const filePath = path.join(config.outputDir, filename);
            
            console.log(`下載: ${filename} 從 ${respUrl}`);
            
            let retryCount = 0;
            let downloadSuccess = false;
            
            // 下載重試邏輯
            while (!downloadSuccess && retryCount < config.maxRetries) {
              try {
                const result = await downloadFile(respUrl, filePath);
                if (result.type === 'file') {
                  videoFiles.push(result.path);
                } else if (result.type === 'hls') {
                  hlsStreams.push(result);
                }
                
                downloadedUrls.add(respUrl);
                fileCounter++;
                downloadSuccess = true;
              } catch (downloadError) {
                retryCount++;
                console.error(`下載失敗 (嘗試 ${retryCount}/${config.maxRetries}): ${downloadError.message}`);
                if (retryCount >= config.maxRetries) {
                  console.error(`達到最大重試次數，跳過檔案: ${respUrl}`);
                } else {
                  // 等待一秒後重試
                  await delay(1000);
                }
              }
            }
          } catch (error) {
            console.error('下載檔案錯誤:', error);
          }
        }
      }
    }
  });

  // 監控網頁控制台訊息
  page.on('console', msg => console.log('瀏覽器日誌:', msg.text()));

  // 開啟目標網頁
  console.log(`正在開啟網頁: ${config.url}`);
  try {
    await page.goto(config.url, {
      waitUntil: 'networkidle2',
      timeout: config.pageLoadTimeout
    });
  } catch (error) {
    console.error(`頁面加載超時或錯誤: ${error.message}`);
    console.log('繼續執行，嘗試尋找視頻元素...');
  }

  // 頁面載入後，自動點擊播放按鈕
  try {
    console.log('尋找並點擊播放按鈕...');
    await page.waitForSelector('video, .video-player, [class*="play"], [id*="play"]', { timeout: 10000 });
    
    // 點擊找到的第一個播放器或播放按鈕
    const playButtons = await page.$$('video, .video-player, [class*="play"], [id*="play"]');
    if (playButtons.length > 0) {
      console.log(`找到 ${playButtons.length} 個播放相關元素`);
      for (const button of playButtons) {
        try {
          await button.click();
          console.log('點擊播放按鈕');
          await delay(1000); // 等待一秒看是否有響應
        } catch (clickError) {
          console.log(`點擊播放按鈕失敗: ${clickError.message}`);
        }
      }
    }
    
    // 額外嘗試 - 執行播放相關 JavaScript
    await page.evaluate(() => {
      // 嘗試尋找並播放所有視頻元素
      const videos = document.querySelectorAll('video');
      if (videos.length > 0) {
        console.log(`找到 ${videos.length} 個視頻元素`);
        videos.forEach(video => {
          try {
            video.play();
            console.log('執行 play() 命令');
            
            // 嘗試設置音量為0（靜音播放）
            video.volume = 0;
            
            // 嘗試設置播放速度
            video.playbackRate = 1.0;
          } catch (e) {
            console.error('播放視頻時出錯:', e);
          }
        });
      }
      
      // 尋找並點擊播放按鈕
      [
        '[class*="play"]', '[id*="play"]', '.play-button', 
        'button:contains("Play")', '.vjs-big-play-button', 
        '.ytp-play-button', '.play-btn'
      ].forEach(selector => {
        try {
          const buttons = document.querySelectorAll(selector);
          buttons.forEach(btn => btn.click());
        } catch (e) {}
      });
    });
  } catch (error) {
    console.log('未找到標準播放按鈕，嘗試其他方法...');
    
    // 嘗試查找iframe中的視頻
    const frames = await page.frames();
    for (const frame of frames) {
      try {
        const videoInFrame = await frame.$('video');
        if (videoInFrame) {
          console.log('在iframe中找到視頻元素，嘗試播放...');
          await frame.evaluate(() => {
            const videos = document.querySelectorAll('video');
            videos.forEach(v => v.play());
          });
        }
      } catch (e) {}
    }
  }

  console.log('尋找網頁中的視頻元素和資源...');
  
  // 定期檢查和提取視頻元素資訊
  let checkCount = 0;
  const maxChecks = Math.ceil(config.playbackTime / config.checkInterval);
  
  for (let i = 0; i < maxChecks; i++) {
    checkCount++;
    console.log(`[${checkCount}/${maxChecks}] 檢查視頻元素...`);
    
    // 提取所有視頻元素資訊
    const videoSources = await page.evaluate(() => {
      const results = [];
      
      // 收集所有視頻元素
      const videos = document.querySelectorAll('video');
      videos.forEach((video, index) => {
        results.push({
          type: 'video元素',
          index: index,
          src: video.src,
          currentSrc: video.currentSrc,
          duration: video.duration,
          currentTime: video.currentTime,
          paused: video.paused,
          muted: video.muted
        });
        
        // 如果視頻暫停，嘗試播放
        if (video.paused) {
          try {
            video.play();
          } catch (e) {}
        }
      });
      
      // 收集所有視頻源元素
      document.querySelectorAll('source').forEach((source, index) => {
        results.push({
          type: 'source元素',
          index: index,
          src: source.src,
          type: source.type
        });
      });
      
      // 尋找可能的HLS流
      document.querySelectorAll('script').forEach(script => {
        const text = script.textContent;
        if (text && text.includes('.m3u8')) {
          const m3u8Match = text.match(/(https?:\/\/[^"'\s]+\.m3u8[^"'\s]*)/g);
          if (m3u8Match) {
            results.push({
              type: 'script中的HLS流',
              src: m3u8Match[0]
            });
          }
        }
      });
      
      return results;
    });
    
    if (videoSources.length > 0) {
      console.log('找到視頻元素:');
      videoSources.forEach(source => {
        console.log(JSON.stringify(source));
        if (source.src) {
          const url = source.src || source.currentSrc;
          if (url && (url.includes('.mp4') || url.includes('.m3u8'))) {
            console.log('添加發現的視頻連結:', url);
            if (isCompleteVideoUrl(url)) {
              videoLinks.add(url);
            }
          }
        }
      });
    } else {
      console.log('未找到視頻元素');
    }
    
    // 檢查是否找到足夠的完整視頻連結
    if (videoLinks.size > 0) {
      console.log(`已捕獲 ${videoLinks.size} 個完整視頻連結`);
    }
    
    // 尋找視頻播放器並設置最大音量(幫助檢測自動播放)
    await page.evaluate(() => {
      document.querySelectorAll('video').forEach(v => {
        v.volume = 1.0;
        if (v.paused) v.play().catch(() => {});
      });
    });
    
    // 等待下一次檢查
    if (i < maxChecks - 1) {
      console.log(`等待 ${config.checkInterval / 1000} 秒...`);
      await delay(config.checkInterval);
    }
  }

  // 儲存視頻連結清單
  console.log(`總共捕獲 ${videoLinks.size} 個完整視頻連結`);
  if (videoLinks.size > 0) {
    await fs.writeFile(config.outputList, Array.from(videoLinks).join('\n'), 'utf-8');
    console.log(`視頻連結已儲存至: ${config.outputList}`);
  } else {
    console.log('未找到完整視頻連結');
  }

  // 顯示下載的檔案
  console.log(`總共下載了 ${videoFiles.length} 個視頻檔案`);
  if (videoFiles.length > 0) {
    console.log('下載的檔案:');
    videoFiles.forEach(file => console.log(`- ${path.basename(file)}`));
  }
  
  // 顯示發現的 HLS 流
  if (hlsStreams.length > 0) {
    console.log(`發現 ${hlsStreams.length} 個 HLS 流`);
    console.log('要下載 HLS 流，可以使用 ffmpeg:');
    hlsStreams.forEach((stream, index) => {
      console.log(`ffmpeg -i "${stream.path}" -c copy "${config.outputDir}/hls_video_${index+1}.mp4"`);
    });
  }

  await browser.close();
  console.log('任務完成!');
})().catch(error => {
  console.error('發生錯誤:', error);
  process.exit(1);
}); 