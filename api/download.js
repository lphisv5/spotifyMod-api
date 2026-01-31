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
  'Referer': 'https://liteapks.com/',
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
    console.log(`[STEP 1] Fetching main page: ${pageUrl}`);
    
    // Step 1: ดึงหน้าเว็บหลัก
    const mainResponse = await axios.get(pageUrl, { headers, timeout: 10000 });
    const $ = cheerio.load(mainResponse.data);
    
    // Step 2: หาเวอร์ชั่นจาก h1
    const h1Element = $('h1.h5.font-weight-semibold');
    const h1Text = h1Element.text();
    console.log(`[STEP 2] H1 text: ${h1Text}`);
    
    // ใช้ regex ที่แม่นยำกว่า
    const versionMatch = h1Text.match(/v(\d+(?:\.\d+)+)/) || 
                        h1Text.match(/v(\d+\.\d+\.\d+\.\d+)/) ||
                        h1Text.match(/v(\d+\.\d+\.\d+)/);
    
    if (!versionMatch) {
      throw new Error('No version found on the webpage.');
    }
    
    const version = versionMatch[1];
    console.log(`[STEP 2] Version found: ${version}`);
    
    // Step 3: หาลิงก์ดาวน์โหลด
    const downloadBtn = $('a.btn.btn-light.btn-sm.btn-block.text-left.d-flex.align-items-center.px-3');
    const intermediateLink = downloadBtn.attr('href');
    
    if (!intermediateLink) {
      console.log('[STEP 3] No download button found, trying alternative selectors...');
      
      // ลองหาจาก selector อื่น
      const altLink = $('a[href*="/download/"]').first().attr('href');
      if (!altLink) {
        throw new Error('No download link found.');
      }
      console.log(`[STEP 3] Found alternative link: ${altLink}`);
    }
    
    // สร้างลิงก์เต็มถ้าเป็น relative
    const fullIntermediateLink = intermediateLink.startsWith('http') 
      ? intermediateLink 
      : `https://liteapks.com${intermediateLink}`;
    
    console.log(`[STEP 3] Intermediate link: ${fullIntermediateLink}`);
    
    // Step 4: ติดตามลิงก์เพื่อหาหน้าดาวน์โหลด
    console.log(`[STEP 4] Following intermediate link...`);
    const followResponse = await axios.get(fullIntermediateLink, { 
      headers: {
        ...headers,
        'Referer': pageUrl
      }, 
      timeout: 15000,
      maxRedirects: 0,
      validateStatus: function (status) {
        return status >= 200 && status < 400;
      }
    }).catch(async (error) => {
      // จัดการกรณี redirect
      if (error.response && error.response.status >= 300 && error.response.status < 400) {
        const redirectUrl = error.response.headers.location;
        console.log(`[STEP 4] Redirect detected to: ${redirectUrl}`);
        
        if (redirectUrl && redirectUrl.includes('.apk')) {
          console.log(`[STEP 4] Direct APK link found in redirect!`);
          return {
            data: '',
            config: { url: redirectUrl }
          };
        }
        
        // ติดตาม redirect
        return await axios.get(redirectUrl, {
          headers: {
            ...headers,
            'Referer': fullIntermediateLink
          },
          timeout: 15000,
          maxRedirects: 5
        });
      }
      throw error;
    });
    
    const finalUrl = followResponse.request?.res?.responseUrl || followResponse.config.url;
    console.log(`[STEP 4] Final URL: ${finalUrl}`);
    
    // ถ้า finalUrl เป็นไฟล์ .apk แล้ว ให้ return เลย
    if (finalUrl.includes('.apk')) {
      console.log(`[STEP 5] Direct APK URL found: ${finalUrl}`);
      return {
        version: version,
        linkDownload: finalUrl.split('?')[0],
        timestamp: new Date().toISOString()
      };
    }
    
    // Step 5: Parse หน้าเว็บเพื่อหาลิงก์ดาวน์โหลดจริง
    console.log(`[STEP 5] Parsing download page...`);
    const $$ = cheerio.load(followResponse.data);
    
    let directLink = null;
    
    // 1. หาลิงก์จาก <a> tag ที่มี .apk
    console.log(`[STEP 5.1] Searching for APK links in <a> tags...`);
    const excludedDomains = ['play.google.com', 'apps.apple.com', 'facebook.com', 'twitter.com', 'instagram.com'];
    
    $$('a').each((i, el) => {
      const href = $$(el).attr('href');
      if (href && href.includes('.apk')) {
        // ตรวจสอบว่าไม่ใช่ลิงก์ที่ไม่ต้องการ
        const isExcluded = excludedDomains.some(domain => href.includes(domain));
        
        if (!isExcluded) {
          console.log(`[STEP 5.1] Found APK link: ${href}`);
          
          // ให้ความสำคัญกับลิงก์ที่มี cloud หรือ 9mod
          if (href.includes('cloud') || href.includes('9mod')) {
            directLink = href;
            console.log(`[STEP 5.1] Selected cloud/9mod link: ${href}`);
            return false; // หยุด loop
          } else if (!directLink) {
            directLink = href; // เก็บเป็น fallback
          }
        } else {
          console.log(`[STEP 5.1] Excluded link (unwanted domain): ${href}`);
        }
      }
    });
    
    // 2. หาจาก onclick, data-href, หรือ attributes อื่นๆ
    if (!directLink) {
      console.log(`[STEP 5.2] Searching in element attributes...`);
      $$('[onclick], [data-href], [data-download], [data-url]').each((i, el) => {
        const onClick = $$(el).attr('onclick') || '';
        const dataHref = $$(el).attr('data-href') || '';
        const dataDownload = $$(el).attr('data-download') || '';
        const dataUrl = $$(el).attr('data-url') || '';
        
        const combined = onClick + dataHref + dataDownload + dataUrl;
        const apkMatch = combined.match(/(https?:\/\/[^\s"']+\.apk[^\s"']*)/);
        
        if (apkMatch) {
          directLink = apkMatch[1];
          console.log(`[STEP 5.2] Found APK in attributes: ${directLink}`);
          return false;
        }
      });
    }
    
    // 3. หาจาก JavaScript code
    if (!directLink) {
      console.log(`[STEP 5.3] Searching in JavaScript code...`);
      const excludedDomains = ['play.google.com', 'apps.apple.com', 'facebook.com', 'twitter.com'];
      
      $$('script').each((i, el) => {
        const scriptContent = $$(el).html() || '';
        
        // หา URL ที่มี .apk
        const apkMatches = scriptContent.match(/(https?:\/\/[^\s"']+\.apk[^\s"']*)/g);
        
        if (apkMatches && apkMatches.length > 0) {
          console.log(`[STEP 5.3] Found ${apkMatches.length} APK links in scripts`);
          
          // กรองลิงก์ที่ไม่ต้องการออก
          const validLinks = apkMatches.filter(link => {
            return !excludedDomains.some(domain => link.includes(domain));
          });
          
          if (validLinks.length > 0) {
            // ให้ความสำคัญกับลิงก์ที่มี cloud หรือ 9mod
            const cloudLink = validLinks.find(link => link.includes('cloud') || link.includes('9mod'));
            if (cloudLink) {
              directLink = cloudLink;
              console.log(`[STEP 5.3] Selected cloud/9mod link: ${directLink}`);
            } else {
              directLink = validLinks[0];
              console.log(`[STEP 5.3] Selected first valid APK link: ${directLink}`);
            }
            return false;
          } else {
            console.log(`[STEP 5.3] All APK links were filtered out as unwanted`);
          }
        }
      });
    }
    
    // 4. หาจาก meta tags
    if (!directLink) {
      console.log(`[STEP 5.4] Searching in meta tags...`);
      const metaUrl = $$('meta[property="og:url"]').attr('content') || 
                      $$('meta[name="download-url"]').attr('content');
      
      if (metaUrl && metaUrl.includes('.apk')) {
        directLink = metaUrl;
        console.log(`[STEP 5.4] Found APK in meta tags: ${directLink}`);
      }
    }
    
    // 5. ถ้ายังหาไม่เจอ ลองสร้างลิงก์จาก pattern
    if (!directLink) {
      console.log(`[STEP 5.5] Attempting to construct download URL...`);
      
      // Pattern ที่เป็นไปได้: https://cloud.9mod.space/Spotify/Spotify%20vX.X.X.X%20(Premium).apk
      const constructedUrl = `https://cloud.9mod.space/Spotify/Spotify%20v${version}%20(Premium).apk`;
      console.log(`[STEP 5.5] Constructed URL: ${constructedUrl}`);
      
      // ลองตรวจสอบว่า URL นี้มีอยู่จริงหรือไม่
      try {
        const headResponse = await axios.head(constructedUrl, { 
          headers, 
          timeout: 5000,
          maxRedirects: 5
        });
        
        if (headResponse.status === 200) {
          directLink = constructedUrl;
          console.log(`[STEP 5.5] Constructed URL is valid!`);
        }
      } catch (error) {
        console.log(`[STEP 5.5] Constructed URL is not accessible: ${error.message}`);
      }
    }
    
    // 6. Fallback: ใช้ intermediate link
    if (!directLink) {
      console.log(`[STEP 5.6] No direct link found, using intermediate link as fallback`);
      directLink = fullIntermediateLink;
    }
    
    // Clean up ลิงก์
    const cleanLink = directLink.split('?')[0].trim();
    console.log(`[STEP 6] Final clean link: ${cleanLink}`);
    
    // Validate: ตรวจสอบว่าลิงก์ที่ได้ไม่ใช่ Play Store หรือลิงก์ที่ไม่ถูกต้อง
    const invalidDomains = ['play.google.com', 'apps.apple.com', 'facebook.com', 'twitter.com'];
    const isInvalid = invalidDomains.some(domain => cleanLink.includes(domain));
    
    if (isInvalid) {
      console.log(`[STEP 6] ERROR: Invalid download link detected (Play Store or other): ${cleanLink}`);
      throw new Error('Could not find valid APK download link. Found invalid link: ' + cleanLink);
    }
    
    // ตรวจสอบว่าลิงก์มี .apk จริงๆ หรือมี pattern ที่คาดหวัง
    if (!cleanLink.includes('.apk') && !cleanLink.includes('download')) {
      console.log(`[STEP 6] WARNING: Link may not be a direct APK download: ${cleanLink}`);
    }
    
    return {
      version: version,
      linkDownload: cleanLink,
      timestamp: new Date().toISOString()
    };
    
  } catch (error) {
    console.error('[ERROR] extractDownloadLink failed:', error.message);
    throw error;
  }
}

async function getSpotifyData() {
  try {
    // ตรวจสอบ cache
    const now = Date.now();
    if (cache.data && (now - cache.timestamp) < CACHE_DURATION) {
      console.log('[CACHE] Using cached data');
      return cache.data;
    }
    
    const SPOTIFY_URL = 'https://liteapks.com/download/spotify-music-98';
    const data = await extractDownloadLink(SPOTIFY_URL);
    
    // อัพเดท cache
    cache = {
      data: data,
      timestamp: now
    };
    
    console.log('[CACHE] Data cached successfully');
    return data;
    
  } catch (error) {
    console.error('[ERROR] getSpotifyData failed:', error.message);
    
    // ถ้า error แต่มี cache เก่า ให้ใช้ cache
    if (cache.data) {
      console.log('[CACHE] Using stale cache as fallback');
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
    console.log('[API] Request received');
    
    // ดึงข้อมูล
    const spotifyData = await getSpotifyData();
    
    // ส่ง response ตาม format ที่ต้องการ
    const response = {
      data: {
        version: spotifyData.version,
        linkDownload: spotifyData.linkDownload
      }
    };
    
    console.log('[API] Success - Version:', spotifyData.version);
    
    // กำหนด Content-Type
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    
    // ส่ง response
    return res.status(200).json(response);
    
  } catch (error) {
    console.error('[API] Error:', error.message);
    
    // Error response
    return res.status(500).json({
      error: 'Unable to retrieve data.',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
};
