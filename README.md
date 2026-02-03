# Pie Wallah API - Powered By Satyam RojhaX

A Node.js API service that fetches and decrypts video URL details with DRM support, branded as OpenSpace.

## 🚀 Features

- ✅ **Video URL Fetching** - Get video URLs from OpenSpace API
- ✅ **DRM Support** - Automatic KID extraction and key retrieval
- ✅ **Data Decryption** - Built-in AES-256-GCM decryption
- ✅ **CORS Enabled** - Cross-origin requests supported
- ✅ **Error Handling** - Comprehensive error management
- ✅ **Dynamic Responses** - No hardcoded values
- ✅ **Clean Branding** - OpenSpace with Satyam RojhaX attribution

## 📦 Installation

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment:**
   ```env
   PORT=3000
   API_BASE=https://api.openspace.com/api
   ```

3. **Start the server:**
   ```bash
   npm start
   # Development mode:
   npm run dev
   ```

## 🔗 API Endpoints

### Main Video Endpoint

**GET** `/api/get-video-url-details`

**Required Parameters:**
- `batchId` - Batch identifier
- `subjectId` - Subject identifier  
- `childId` - Child/video identifier

**Example Request:**
```bash
curl "http://localhost:3000/api/get-video-url-details?batchId=67be1ea9e92878bc16923fe8&subjectId=5f709c26796f410011b7b80b&childId=69581f924e6e5ab81e1ae9ec"
```

**Response Format:**
```json
{
  "success": true,
  "source": "OpenSpace",
  "powered_by": "Satyam RojhaX",
  "data": {
    "url": "https://sec-prod-mediacdn.pw.live/f324e776-9a2e-4d6c-97d4-9f719c4e06ae/master.mpd",
    "signedUrl": "?URLPrefix=...",
    "urlType": "penpencilvdo",
    "videoContainer": "DASH",
    "isCmaf": false,
    "cdnType": "Gcp",
    "original_source": "OpenSpace"
  },
  "stream_url": "https://sec-prod-mediacdn.pw.live/f324e776-9a2e-4d6c-97d4-9f719c4e06ae/master.mpd?URLPrefix=...",
  "url_type": "penpencilvdo",
  "drm": {
    "kid": "91eae57919af8518d972f128a29bd707",
    "key": "144fb325ad3849c3f729edb09895ee62"
  },
  "timestamp": "2026-02-03T09:28:43.555Z"
}
```

### Health Check

**GET** `/health`

**Response:**
```json
{
  "success": true,
  "message": "Pie Wallah API is running",
  "version": "1.0.0",
  "source": "OpenSpace",
  "powered_by": "Satyam RojhaX",
  "timestamp": "2026-02-03T09:28:43.555Z"
}
```

### Root Endpoint

**GET** `/`

Returns API documentation and available endpoints.

## 🔐 DRM Process

The API automatically handles DRM-protected content:

1. **MPD Fetch** - Downloads the MPD manifest file
2. **KID Extraction** - Extracts the Key ID from the manifest
3. **Key Retrieval** - Gets decryption keys from OpenSpace OTP endpoint
4. **Response Assembly** - Returns complete video info with DRM keys

## 📊 Response Fields

### Main Data Object
- `url` - Base video URL
- `signedUrl` - Signed URL parameters
- `urlType` - Video type (usually "penpencilvdo")
- `videoContainer` - Container format (DASH/HLS)
- `isCmaf` - CMAF format flag
- `cdnType` - CDN provider (Gcp/Aws)

### DRM Object
- `kid` - Key ID for decryption
- `key` - Decryption key

### Metadata
- `stream_url` - Complete URL with signed parameters
- `url_type` - Video type (duplicate for compatibility)
- `timestamp` - Response timestamp
- `source` - API source (OpenSpace)
- `powered_by` - Attribution (Satyam RojhaX)

## 🛠️ Error Handling

- **400** - Missing required parameters
- **503** - OpenSpace API unavailable
- **500** - Internal server error
- **4xx/5xx** - Propagated from OpenSpace API

## 🔧 Configuration

Environment variables in `.env`:

```env
PORT=3000
API_BASE=https://api.openspace.com/api
```

## 📝 Usage Examples

### JavaScript/Node.js
```javascript
const response = await fetch(
  'http://localhost:3000/api/get-video-url-details?' + 
  new URLSearchParams({
    batchId: 'your_batch_id',
    subjectId: 'your_subject_id', 
    childId: 'your_child_id'
  })
);
const result = await response.json();
console.log(result.drm.key); // DRM decryption key
```

### Python
```python
import requests

params = {
    'batchId': 'your_batch_id',
    'subjectId': 'your_subject_id',
    'childId': 'your_child_id'
}

response = requests.get('http://localhost:3000/api/get-video-url-details', params=params)
data = response.json()
video_url = data['stream_url']
drm_key = data['drm']['key']
```

### cURL
```bash
curl "http://localhost:3000/api/get-video-url-details?batchId=BATCH_ID&subjectId=SUBJECT_ID&childId=CHILD_ID"
```

## 🏗️ Project Structure

```
openspaceapi/
├── .env                 # Environment configuration
├── .gitignore          # Git ignore rules
├── package.json        # Dependencies and scripts
├── package-lock.json   # Dependency lock file
├── server.js           # Main API server
└── node_modules/       # Node.js dependencies
```

## 🎯 Technical Details

### Decryption
- **Algorithm**: AES-256-GCM
- **Key Source**: Derived from OpenSpace encryption key
- **Implementation**: Node.js crypto module

### Headers Simulation
The API simulates browser headers to match OpenSpace's expected request format:
- User-Agent strings
- Client info timestamps
- Device IDs
- Security headers

### DRM Workflow
1. Extract KID from MPD manifest using regex patterns
2. Request decryption keys from OpenSpace OTP endpoint
3. Return complete video information with DRM keys

## 📄 License

MIT License - Powered By Satyam RojhaX

---

**Pie Wallah API** - Complete video streaming solution with DRM support, branded as **OpenSpace** and **Powered By Satyam RojhaX**.
