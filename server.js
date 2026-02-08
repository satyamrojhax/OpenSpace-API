const express = require('express');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const STUDYSPARK_API_BASE = process.env.STUDYSPARK_API_BASE || 'https://studyspark.site/api';

// Performance optimizations
const axiosInstance = axios.create({
  timeout: 15000, // Reduce timeout for faster responses
  maxRedirects: 2,
  httpAgent: new require('http').Agent({ keepAlive: true }),
  httpsAgent: new require('https').Agent({ keepAlive: true })
});

// Simple in-memory cache
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Token cache for verified JWT tokens
const tokenCache = new Map();
const TOKEN_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

const getCacheKey = (batchId, subjectId, childId) => `${batchId}-${subjectId}-${childId}`;
const getFromCache = (key) => {
  const cached = cache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  cache.delete(key);
  return null;
};
const setCache = (key, data) => {
  cache.set(key, { data, timestamp: Date.now() });
};

// Middleware
app.use(cors({
  origin: '*', // Allow all origins
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Cache-Control', 'X-Client-Info', 'X-User-Agent', 'X-Device-Id', 'Author'],
  credentials: true,
  optionsSuccessStatus: 200 // Some legacy browsers choke on 204
}));
app.use(express.json({ limit: '10mb' })); // Increase payload limit
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Author header validation middleware
app.use((req, res, next) => {
  const authorHeader = req.headers.author;
  
  // Skip validation for health check and root endpoints
  if (req.path === '/health' || req.path === '/' || req.path === '/api' || req.path === '/api/docs') {
    return next();
  }
  
  // Check for required Author header
  if (!authorHeader || authorHeader !== 'Satyam RojhaX') {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized',
      timestamp: new Date().toISOString()
    });
  }
  
  next();
});

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
    const headers = await generateHeaders();
    const response = await axiosInstance.post(`${STUDYSPARK_API_BASE}/otp`, 
      { kid: kid },
      {
        headers: headers,
        timeout: 10000 // Faster timeout for DRM keys
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

// Helper function to verify JWT token with key.pwxavengers.xyz
const verifyJwtToken = async (token) => {
  try {
    // Check token cache first
    const cachedToken = tokenCache.get(token);
    if (cachedToken && Date.now() - cachedToken.timestamp < TOKEN_CACHE_TTL) {
      console.log('📋 Token cache hit');
      return cachedToken.data;
    }

    console.log('🔐 Verifying JWT token...');
    const response = await axiosInstance.post('https://key.pwxavengers.xyz/api/verify', 
      { token: token },
      {
        headers: {
          'accept': '*/*',
          'accept-language': 'en-US,en;q=0.9',
          'content-type': 'application/json',
          'origin': 'https://studyspark.site',
          'referer': 'https://studyspark.site/'
        },
        timeout: 10000
      }
    );
    
    if (response.data && response.data.success && response.data.data && response.data.data.valid) {
      const tokenData = {
        userId: response.data.data.userId,
        token: response.data.data.token,
        expires: response.data.data.expires,
        expiresISO: response.data.data.expiresISO,
        valid: response.data.data.valid
      };
      
      // Cache the verified token
      tokenCache.set(token, { data: tokenData, timestamp: Date.now() });
      console.log('✅ JWT token verified successfully');
      return tokenData;
    }
    
    return null;
  } catch (error) {
    console.error('❌ Error verifying JWT token:', error.message);
    return null;
  }
};

// Helper function to generate device ID in JWT format
const generateDeviceId = (userId, sessionId) => {
  const jwtPayload = {
    userId: userId,
    sessionId: sessionId,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + (2 * 24 * 60 * 60) // 2 days expiry
  };
  
  // This is a simplified version - in real implementation, you'd use proper JWT signing
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const encodedPayload = Buffer.from(JSON.stringify(jwtPayload)).toString('base64url');
  
  // For demo purposes, using a mock signature
  const signature = 'ZXlKaGJHY2lPaUpJVXpJMU5pSXNJblI1Y0NJNklrcFhWQ0o5LmV5SjFjMlZ5U1dRaU9pSTNOemN5T0RNMElpd2ljMlZ6YzJsdmJrbGtJam9pWVhod1kyVnlhWFl6ZFcxNk9ETnJkRGN5Tm1GMklpd2lhV0YwSWpveE56Y3dOVEl5TXpBNExDSmxlSEFpT2pFM056QTJPVFV4TURoOS5zZWNyZXQ';
  
  return `${encodedHeader}.${encodedPayload}.${signature}`;
};

// Helper function to generate random headers with proper device ID
const generateHeaders = async (useRealToken = true) => {
  const timestamp = Date.now();
  let deviceId;
  
  if (useRealToken) {
    // Try to get a valid token from cache or generate new one
    const cachedTokens = Array.from(tokenCache.keys());
    if (cachedTokens.length > 0) {
      deviceId = cachedTokens[0]; // Use first cached token
    } else {
      // Generate a new device ID with mock user data
      deviceId = generateDeviceId('7772834', 'axpceriv3umz83kdt726av');
      
      // Verify the token to get it cached
      await verifyJwtToken(deviceId);
    }
  } else {
    // Fallback to random device ID
    deviceId = Math.random().toString(36).substring(2, 15);
  }
  
  const randomUserAgent = Array.from({length: 64}, () => 
    Math.floor(Math.random() * 16).toString(16)
  ).join('');

  return {
    'accept': 'application/json',
    'accept-language': 'en-US,en;q=0.9',
    'content-type': 'application/json',
    'priority': 'u=1, i',
    'sec-ch-ua': '"Not(A:Brand";v="8", "Chromium";v="144", "Google Chrome";v="144"',
    'sec-ch-ua-mobile': '?1',
    'sec-ch-ua-platform': '"Android"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    'x-client-info': timestamp.toString(),
    'x-device-id': deviceId,
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

    // Check cache first
    const cacheKey = getCacheKey(batchId, subjectId, childId);
    const cachedResponse = getFromCache(cacheKey);
    if (cachedResponse) {
      console.log('📋 Cache hit for:', cacheKey);
      return res.json(cachedResponse);
    }

    console.log(`Fetching video URL for batchId: ${batchId}, subjectId: ${subjectId}, childId: ${childId}`);

    // Make request to StudySpark API using optimized instance
    const headers = await generateHeaders();
    const response = await axiosInstance.post(`${STUDYSPARK_API_BASE}/video-url`, 
      {
        batchId: batchId,
        childId: childId
      },
      {
        headers: headers,
        timeout: 15000
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
          const mpdResponse = await axiosInstance.get(completeVideoUrl, {
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
            timeout: 10000 // Faster timeout for MPD
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
      const finalResponse = {
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
      };

      // Cache the response
      setCache(cacheKey, finalResponse);
      console.log('💾 Cached response for:', cacheKey);
      
      res.json(finalResponse);
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

// Token verification endpoint
app.post('/api/verify-token', async (req, res) => {
  try {
    const { token } = req.body;
    
    if (!token) {
      return res.status(400).json({
        success: false,
        error: 'Token is required',
        timestamp: new Date().toISOString()
      });
    }

    const tokenData = await verifyJwtToken(token);
    
    if (tokenData) {
      res.json({
        success: true,
        message: 'Token verified successfully',
        data: tokenData,
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(401).json({
        success: false,
        error: 'Invalid or expired token',
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    console.error('Error in token verification endpoint:', error.message);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: error.message,
      timestamp: new Date().toISOString()
    });
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
      'POST /api/verify-token': 'Verify JWT token for authentication',
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

// API integration documentation endpoint
app.get('/api/docs', (req, res) => {
  res.json({
    success: true,
    title: 'OpenSpace API Integration Guide',
    version: '1.0.0',
    powered_by: 'Satyam RojhaX',
    source: 'OpenSpace',
    authentication: {
      required: true,
      method: 'Header',
      header_name: 'Author',
      header_value: 'Satyam RojhaX',
      note: 'All protected endpoints require Author header with exact value "Satyam RojhaX"'
    },
    base_url: 'https://openspaceapi.vercel.app',
    endpoints: {
      main_api: {
        url: '/api/get-video-url-details',
        method: 'GET',
        description: 'Get video URL details with DRM support',
        authentication: 'Required',
        parameters: {
          query: {
            batchId: {
              type: 'string',
              required: true,
              description: 'Batch identifier for the video content'
            },
            subjectId: {
              type: 'string', 
              required: true,
              description: 'Subject identifier for the video content'
            },
            childId: {
              type: 'string',
              required: true,
              description: 'Child/video identifier for the specific video'
            }
          },
          headers: {
            Author: {
              type: 'string',
              required: true,
              value: 'Satyam RojhaX',
              description: 'Authentication header - must be exactly "Satyam RojhaX"'
            }
          }
        },
        response: {
          success: 'boolean',
          source: 'OpenSpace',
          powered_by: 'Satyam RojhaX',
          data: {
            url: 'string - Base video URL',
            signedUrl: 'string - Signed URL parameters',
            urlType: 'string - Video type (usually "penpencilvdo")',
            videoContainer: 'string - Container format (DASH/HLS)',
            isCmaf: 'boolean - CMAF format flag',
            cdnType: 'string - CDN provider (Gcp/Aws)',
            original_source: 'string - Source attribution'
          },
          stream_url: 'string - Complete URL with signed parameters',
          url_type: 'string - Video type (duplicate for compatibility)',
          drm: {
            kid: 'string - Key ID for DRM decryption',
            key: 'string - Decryption key for DRM content'
          },
          timestamp: 'string - ISO 8601 timestamp'
        },
        example_request: {
          url: 'https://openspaceapi.vercel.app/api/get-video-url-details?batchId=67be1ea9e92878bc16923fe8&subjectId=5f709c26796f410011b7b80b&childId=69581f924e6e5ab81e1ae9ec',
          headers: {
            'Author': 'Satyam RojhaX'
          }
        },
        example_response: {
          success: true,
          source: 'OpenSpace',
          powered_by: 'Satyam RojhaX',
          data: {
            url: 'https://sec-prod-mediacdn.pw.live/f324e776-9a2e-4d6c-97d4-9f719c4e06ae/master.mpd',
            signedUrl: '?URLPrefix=...',
            urlType: 'penpencilvdo',
            videoContainer: 'DASH',
            isCmaf: false,
            cdnType: 'Gcp',
            original_source: 'OpenSpace'
          },
          stream_url: 'https://sec-prod-mediacdn.pw.live/f324e776-9a2e-4d6c-97d4-9f719c4e06ae/master.mpd?URLPrefix=...',
          url_type: 'penpencilvdo',
          drm: {
            kid: '91eae57919af8518d972f128a29bd707',
            key: '144fb325ad3849c3f729edb09895ee62'
          },
          timestamp: '2026-02-03T10:05:45.123Z'
        }
      },
      health_check: {
        url: '/health',
        method: 'GET',
        description: 'API health check endpoint',
        authentication: 'Not Required',
        response: {
          success: 'boolean',
          message: 'string',
          version: 'string',
          source: 'OpenSpace',
          powered_by: 'Satyam RojhaX',
          timestamp: 'string'
        }
      },
      public_endpoints: {
        url: ['/', '/api'],
        method: 'GET',
        description: 'Public documentation endpoints',
        authentication: 'Not Required'
      }
    },
    integration_examples: {
      javascript: {
        title: 'JavaScript/Node.js Integration',
        code: `// Basic API call with authentication
const response = await fetch(
  'https://openspaceapi.vercel.app/api/get-video-url-details?' + 
  new URLSearchParams({
    batchId: 'your_batch_id',
    subjectId: 'your_subject_id', 
    childId: 'your_child_id'
  }),
  {
    headers: {
      'Author': 'Satyam RojhaX'
    }
  }
);

const data = await response.json();
if (data.success) {
  console.log('Video URL:', data.stream_url);
  console.log('DRM Key:', data.drm.key);
} else {
  console.error('Error:', data.error);
}`
      },
      python: {
        title: 'Python Integration',
        code: `import requests

# API call with authentication
params = {
    'batchId': 'your_batch_id',
    'subjectId': 'your_subject_id',
    'childId': 'your_child_id'
}

headers = {
    'Author': 'Satyam RojhaX'
}

response = requests.get(
    'https://openspaceapi.vercel.app/api/get-video-url-details',
    params=params,
    headers=headers
)

data = response.json()
if data['success']:
    print('Video URL:', data['stream_url'])
    print('DRM Key:', data['drm']['key'])
else:
    print('Error:', data['error'])`
      },
      curl: {
        title: 'cURL Command',
        code: `curl -H "Author: Satyam RojhaX" \\
  "https://openspaceapi.vercel.app/api/get-video-url-details?batchId=your_batch_id&subjectId=your_subject_id&childId=your_child_id"`
      },
      php: {
        title: 'PHP Integration',
        code: `<?php
// API call with authentication
$params = [
    'batchId' => 'your_batch_id',
    'subjectId' => 'your_subject_id',
    'childId' => 'your_child_id'
];

$headers = [
    'Author: Satyam RojhaX'
];

$ch = curl_init();
$url = 'https://openspaceapi.vercel.app/api/get-video-url-details?' . http_build_query($params);
curl_setopt($ch, CURLOPT_URL, $url);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);

$response = curl_exec($ch);
curl_close($ch);

$data = json_decode($response, true);
if ($data['success']) {
    echo 'Video URL: ' . $data['stream_url'] . '\\n';
    echo 'DRM Key: ' . $data['drm']['key'] . '\\n';
} else {
    echo 'Error: ' . $data['error'] . '\\n';
}
?>`
      }
    },
    error_handling: {
      unauthorized: {
        status_code: 401,
        error: 'Unauthorized',
        cause: 'Missing or invalid Author header',
        solution: 'Add "Author: Satyam RojhaX" header to your request'
      },
      bad_request: {
        status_code: 400,
        error: 'Missing required parameters',
        cause: 'batchId, subjectId, or childId missing',
        solution: 'Ensure all required query parameters are included'
      },
      not_found: {
        status_code: 404,
        error: 'Video not found',
        cause: 'Invalid batchId, subjectId, or childId',
        solution: 'Verify your parameters are correct'
      },
      server_error: {
        status_code: 500,
        error: 'Internal server error',
        cause: 'API processing error',
        solution: 'Try again later or contact support'
      }
    },
    features: {
      drm_support: 'Automatic KID extraction and key retrieval for protected content',
      caching: '5-minute response caching for improved performance',
      cors_enabled: 'Full CORS support for cross-origin requests',
      dynamic_timestamps: 'Real-time timestamps in all responses',
      open_space_branding: 'Clean OpenSpace branding with Satyam RojhaX attribution'
    },
    support: {
      documentation: 'https://openspaceapi.vercel.app/api/docs',
      health_check: 'https://openspaceapi.vercel.app/health',
      github: 'https://github.com/satyamrojhax/OpenSpace-API',
      contact: 'Powered By Satyam RojhaX'
    }
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
