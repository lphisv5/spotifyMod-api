const axios = require('axios');
const cheerio = require('cheerio');

// ตั้งค่า headers
const headers = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9,th;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection': 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache'
};

// Cache ข้อมูล (ในหน่วยความจำ)
let cache = {
  data: null,
  timestamp: 0
};
const CACHE_DURATION = 5 * 60 * 1000; // 5 นาที

async function extractDownloadLink(pageUrl) {
  try {
    console.log(`กำลังดึงข้อมูลจาก: ${pageUrl}`);
    
    // Step 1: ดึงหน้าเว็บหลัก
    const mainResponse = await axios.get(pageUrl, { headers, timeout: 10000 });
    const $ = cheerio.load(mainResponse.data);
    
    // Step 2: หาเวอร์ชั่นจาก h1
    const h1Element = $('h1.h5.font-weight-semibold');
    const h1Text = h1Element.text();
    
    // ใช้ regex ที่แม่นยำกว่า
    const versionMatch = h1Text.match(/v(\d+(?:\.\d+)+)/) || 
                        h1Text.match(/v(\d+\.\d+\.\d+\.\d+)/) ||
                        h1Text.match(/v(\d+\.\d+\.\d+)/);
    
    if (!versionMatch) {
      throw new Error('ไม่พบเวอร์ชั่นในหน้าเว็บ');
    }
    
    const version = versionMatch[1];
    console.log(`พบเวอร์ชั่น: ${version}`);
    
    // Step 3: หาลิงก์ intermediate
    const downloadBtn = $('a.btn.btn-light.btn-sm.btn-block.text-left.d-flex.align-items-center.px-3');
    const intermediateLink = downloadBtn.attr('href');
    
    if (!intermediateLink) {
      throw new Error('ไม่พบลิงก์ดาวน์โหลด');
    }
    
    // สร้างลิงก์เต็มถ้าเป็น relative
    const fullIntermediateLink = intermediateLink.startsWith('http') 
      ? intermediateLink 
      : `https://liteapks.com${intermediateLink}`;
    
    console.log(`Intermediate link: ${fullIntermediateLink}`);
    
    // Step 4: ติดตามลิงก์เพื่อหาลิงก์จริง
    const followResponse = await axios.get(fullIntermediateLink, { 
      headers, 
      timeout: 15000,
      maxRedirects: 5,
      validateStatus: function (status) {
        return status >= 200 && status < 400; // อนุญาต redirect
      }
    });
    
    // ดึงลิงก์สุดท้ายจาก response
    const finalUrl = followResponse.request?.res?.responseUrl || followResponse.config.url;
    console.log(`Final URL: ${finalUrl}`);
    
    // Step 5: ดึงหน้าเว็บอีกครั้งเพื่อหาลิงก์ดาวน์โหลดจริง
    const finalResponse = await axios.get(finalUrl, { headers, timeout: 10000 });
    const $$ = cheerio.load(finalResponse.data);
    
    // ลองหาลิงก์ดาวน์โหลดจากหลายที่
    let directLink = null;
    
    // 1. ลองหา link ที่มี .apk
    $$('a[href*=".apk"]').each((i, el) => {
      const href = $$(el).attr('href');
      if (href && href.includes('cloud') && href.includes('Spotify')) {
        directLink = href;
        return false; // หยุด loop
      }
    });
    
    // 2. ถ้าไม่เจอ ลองหา from JavaScript หรือ onclick
    if (!directLink) {
      const scriptContent = $$('script').text();
      const apkMatch = scriptContent.match(/(https?:\/\/[^"']+\.apk[^"']*)/);
      if (apkMatch) {
        directLink = apkMatch[1];
      }
    }
    
    // 3. ถ้ายังไม่เจอ ใช้ finalUrl เป็นลิงก์
    if (!directLink && finalUrl.includes('.apk')) {
      directLink = finalUrl;
    }
    
    // 4. ถ้ายังไม่เจออีก ให้ใช้ intermediate link
    if (!directLink) {
      directLink = fullIntermediateLink;
    }
    
    // Step 6: Clean up ลิงก์
    // ลบ token หรือ parameter ที่ไม่จำเป็น
    const cleanLink = directLink.split('?')[0];
    
    // ถ้าลิงก์เป็น base64 encoded ให้ decode
    if (cleanLink.includes('data-href') || cleanLink.includes('base64')) {
      // ไม่ต้องทำอะไรในนี้
    }
    
    return {
      version: version,
      linkDownload: cleanLink,
      timestamp: new Date().toISOString()
    };
    
  } catch (error) {
    console.error('Error in extractDownloadLink:', error.message);
    throw error;
  }
}

async function getSpotifyData() {
  try {
    // ตรวจสอบ cache
    const now = Date.now();
    if (cache.data && (now - cache.timestamp) < CACHE_DURATION) {
      console.log('ใช้ข้อมูลจาก cache');
      return cache.data;
    }
    
    const SPOTIFY_URL = 'https://liteapks.com/download/spotify-music-98';
    const data = await extractDownloadLink(SPOTIFY_URL);
    
    // อัพเดท cache
    cache = {
      data: data,
      timestamp: now
    };
    
    return data;
    
  } catch (error) {
    console.error('Error getting Spotify data:', error.message);
    
    // ถ้า error แต่มี cache เก่า ให้ใช้ cache
    if (cache.data) {
      console.log('ใช้ข้อมูลจาก cache (fallback)');
      return cache.data;
    }
    
    throw error;
  }
}

module.exports = async (req, res) => {
  // ตั้งค่า CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // Handle preflight request
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // อนุญาตเฉพาะ GET
  if (req.method !== 'GET') {
    return res.status(405).json({ 
      error: 'Method not allowed. Use GET.' 
    });
  }
  
  try {
    console.log('เริ่มดึงข้อมูล Spotify Mod...');
    
    // ดึงข้อมูล
    const spotifyData = await getSpotifyData();
    
    // ส่ง response ตาม format ที่ต้องการ
    const response = {
      data: {
        version: spotifyData.version,
        linkDownload: spotifyData.linkDownload
      }
    };
    
    console.log('ส่งข้อมูลสำเร็จ:', spotifyData.version);
    
    // กำหนด Content-Type
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    
    // ส่ง response
    return res.status(200).json(response);
    
  } catch (error) {
    console.error('API Error:', error.message);
    
    // Error response
    return res.status(500).json({
      error: 'ไม่สามารถดึงข้อมูลได้',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
};
