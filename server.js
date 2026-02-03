const express = require('express');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const STUDYSPARK_API_BASE = process.env.STUDYSPARK_API_BASE || 'https://studyspark.site/api';

// Middleware
app.use(cors());
app.use(express.json());

// Helper function to extract KID from MPD content
const extractKidFromMpd = (mpdContent) => {
  try {
    // Look for KID in various formats
    let match = mpdContent.match(/cenc:default_KID\s*=\s*"([^"]+)"/i);
    if (match && match[1]) return match[1].replace(/-/g, '');
    
    match = mpdContent.match(/\bkid\s*=\s*"([^"]+)"/i);
    if (match && match[1]) return match[1].replace(/-/g, '');
    
    match = mpdContent.match(/\bkeyId\s*=\s*"([^"]+)"/i);
    if (match && match[1]) return match[1].replace(/-/g, '');
    
    match = mpdContent.match(/<ContentProtection[^>]*value\s*=\s*"([^"]+)"/i);
    if (match && match[1]) return match[1].replace(/-/g, '');
    
    // Look for UUID pattern
    match = mpdContent.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    if (match) return match[0].replace(/-/g, '');
    
    return null;
  } catch (error) {
    console.error('Error extracting KID from MPD:', error);
    return null;
  }
};

// Helper function to get DRM keys from StudySpark
const getDrmKeys = async (kid) => {
  try {
    const response = await axios.post(`${STUDYSPARK_API_BASE}/otp`, 
      { kid: kid },
      {
        headers: generateHeaders(),
        timeout: 30000
      }
    );
    
    if (response.data && response.data.success && response.data.data && response.data.data.clearKeys) {
      return response.data.data.clearKeys;
    }
    return null;
  } catch (error) {
    console.error('Error getting DRM keys:', error.message);
    return null;
  }
};

// Helper function to decrypt StudySpark data
const decryptStudySparkData = (encryptedData, iv) => {
  try {
    // The hardcoded key derivation logic from StudySpark JS source
    const keyStr = "TERA@BAAP-hu$BSDMK@555";
    const keyBytes = Buffer.from(keyStr, 'utf-8');
    
    // Create 32-byte key
    const derivedKey = Buffer.alloc(32);
    keyBytes.copy(derivedKey, 0, 0, Math.min(keyBytes.length, 32));
    
    // Decode base64 inputs
    const ciphertext = Buffer.from(encryptedData, 'base64');
    const ivBuffer = Buffer.from(iv, 'base64');
    
    // Decrypt using AES-GCM
    const decipher = crypto.createDecipheriv('aes-256-gcm', derivedKey, ivBuffer);
    decipher.setAuthTag(ciphertext.slice(ciphertext.length - 16));
    
    let decrypted = decipher.update(ciphertext.slice(0, ciphertext.length - 16), null, 'utf8');
    decrypted += decipher.final('utf8');
    
    return JSON.parse(decrypted);
  } catch (error) {
    console.error('Decryption error:', error);
    return null;
  }
};

// Helper function to generate random headers
const generateHeaders = () => {
  const timestamp = Date.now();
  const randomDeviceId = Math.random().toString(36).substring(2, 15);
  const randomUserAgent = Array.from({length: 64}, () => 
    Math.floor(Math.random() * 16).toString(16)
  ).join('');

  return {
    'accept': 'application/json',
    'accept-language': 'en-GB,en-US;q=0.9,en;q=0.8',
    'content-type': 'application/json',
    'priority': 'u=1, i',
    'sec-ch-ua': '"Not(A:Brand";v="8", "Chromium";v="144", "Google Chrome";v="144"',
    'sec-ch-ua-mobile': '?1',
    'sec-ch-ua-platform': '"Android"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    'x-client-info': timestamp.toString(),
    'x-device-id': randomDeviceId,
    'x-user-agent': randomUserAgent,
    'origin': 'https://studyspark.site',
    'referer': 'https://studyspark.site/'
  };
};

// API Route to get video URL details
app.get('/api/get-video-url-details', async (req, res) => {
  try {
    const { batchId, subjectId, childId } = req.query;

    // Validate required parameters
    if (!batchId || !subjectId || !childId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: batchId, subjectId, childId',
        timestamp: new Date().toISOString()
      });
    }

    console.log(`Fetching video URL for batchId: ${batchId}, subjectId: ${subjectId}, childId: ${childId}`);

    // Make request to StudySpark API
    const response = await axios.post(`${STUDYSPARK_API_BASE}/video-url`, 
      {
        batchId: batchId,
        childId: childId
      },
      {
        headers: generateHeaders(),
        timeout: 30000
      }
    );

    // Decrypt the response data
    let decryptedData = null;
    if (response.data && response.data.data && response.data.iv) {
      decryptedData = decryptStudySparkData(response.data.data, response.data.iv);
    }

    if (decryptedData && decryptedData.success) {
      // Get DRM information if video URL is available
      let drmInfo = null;
      const videoUrl = decryptedData.data?.url;
      
      if (videoUrl && videoUrl.includes('.mpd')) {
        try {
          console.log('🔐 Fetching MPD file for DRM extraction...');
          const completeVideoUrl = videoUrl + (decryptedData.data?.signedUrl || '');
          const mpdResponse = await axios.get(completeVideoUrl, {
            headers: {
              'accept': '*/*',
              'accept-language': 'en-GB,en-US;q=0.9,en;q=0.8',
              'priority': 'u=1, i',
              'sec-ch-ua': '"Not(A:Brand";v="8", "Chromium";v="144", "Google Chrome";v="144"',
              'sec-ch-ua-mobile': '?1',
              'sec-ch-ua-platform': '"Android"',
              'sec-fetch-dest': 'empty',
              'sec-fetch-mode': 'cors',
              'sec-fetch-site': 'cross-site',
              'referrer': 'https://studyspark.site/'
            },
            timeout: 30000
          });
          
          const kid = extractKidFromMpd(mpdResponse.data);
          if (kid) {
            console.log(`🔑 Found KID: ${kid}`);
            const drmKeys = await getDrmKeys(kid);
            if (drmKeys && drmKeys[kid]) {
              drmInfo = {
                kid: kid,
                key: drmKeys[kid]
              };
              console.log('✅ DRM keys retrieved successfully');
            } else {
              console.log('⚠️ No DRM keys found for KID');
            }
          } else {
            console.log('⚠️ No KID found in MPD file');
          }
        } catch (error) {
          console.error('❌ Error fetching DRM information:', error.message);
        }
      }
      
      // Create complete response
      const completeVideoUrl = videoUrl + (decryptedData.data?.signedUrl || '');
      
      // Return the decrypted response with OpenSpace branding and DRM info
      res.json({
        success: true,
        source: 'OpenSpace',
        powered_by: 'Satyam RojhaX',
        data: {
          url: decryptedData.data?.url,
          signedUrl: decryptedData.data?.signedUrl,
          urlType: decryptedData.data?.urlType || 'penpencilvdo',
          videoContainer: decryptedData.data?.videoContainer || 'DASH',
          isCmaf: decryptedData.data?.isCmaf || false,
          cdnType: decryptedData.data?.cdnType || 'Gcp',
          original_source: 'OpenSpace'
        },
        stream_url: completeVideoUrl,
        url_type: decryptedData.data?.urlType || 'penpencilvdo',
        drm: drmInfo,
        timestamp: new Date().toISOString()
      });
    } else {
      // Return encrypted response if decryption fails
      res.json({
        success: true,
        source: 'OpenSpace',
        powered_by: 'Satyam RojhaX',
        data: response.data,
        timestamp: new Date().toISOString(),
        note: 'Encrypted response - decryption failed'
      });
    }

  } catch (error) {
    console.error('Error fetching video URL:', error.message);
    
    // Handle different types of errors
    if (error.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      const errorDetails = error.response.data;
      if (errorDetails && typeof errorDetails === 'object') {
        errorDetails.timestamp = new Date().toISOString();
      }
      
      res.status(error.response.status).json({
        success: false,
        error: 'OpenSpace API error',
        details: errorDetails,
        status: error.response.status
      });
    } else if (error.request) {
      // The request was made but no response was received
      res.status(503).json({
        success: false,
        error: 'Service unavailable - No response from OpenSpace API',
        details: error.message,
        timestamp: new Date().toISOString()
      });
    } else {
      // Something happened in setting up the request that triggered an Error
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        details: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Pie Wallah API is running',
    version: '1.0.0',
    source: 'OpenSpace',
    powered_by: 'Satyam RojhaX',
    timestamp: new Date().toISOString()
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    status: false,
    message: "Please update your app. You are using outdated version(1).",
    data: [],
    time: Math.floor(Date.now() / 1000),
    interval: 10,
    limit: 0,
    cd_time: Date.now() * 10000
  });
});

// API documentation endpoint
app.get('/api', (req, res) => {
  res.json({
    success: true,
    message: 'Pie Wallah API - Powered By Satyam RojhaX',
    source: 'OpenSpace',
    powered_by: 'Satyam RojhaX',
    endpoints: {
      'GET /api/get-video-url-details': 'Get video URL details from OpenSpace',
      'GET /health': 'Health check endpoint'
    },
    parameters: {
      'batchId': 'Required - Batch ID',
      'subjectId': 'Required - Subject ID',
      'childId': 'Required - Child ID'
    },
    example: '/api/get-video-url-details?batchId=6960d1d20549bb69d7d7e872&subjectId=6960db9fcfd09d8d25220daf&childId=697896f49159246207286630'
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Pie Wallah API server is running on port ${PORT}`);
  console.log(`📡 Health check: http://localhost:${PORT}/health`);
  console.log(`🔗 API endpoint: http://localhost:${PORT}/api/get-video-url-details`);
  console.log(`⚡ Powered By Satyam RojhaX`);
  console.log(`🏷️  Source: OpenSpace`);
});

module.exports = app;
