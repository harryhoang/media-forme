// server.js - Backend cho streaming từ Google Drive
const express = require('express');
const { google } = require('googleapis');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Cấu hình Google Drive API
const SCOPES = ['https://www.googleapis.com/auth/drive.readonly'];
let auth = null;

// Hàm xác thực với Google Drive
async function authorize() {
  const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
  const { client_secret, client_id, redirect_uris } = credentials.installed;
  
  const oAuth2Client = new google.auth.OAuth2(
    client_id, client_secret, redirect_uris[0]
  );

  // Sử dụng refresh token được lưu trữ
  oAuth2Client.setCredentials({
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN
  });
  
  return oAuth2Client;
}

// Khởi tạo xác thực khi khởi động
(async () => {
  try {
    auth = await authorize();
    console.log('Google Drive authentication successful');
  } catch (error) {
    console.error('Error authorizing with Google Drive:', error);
  }
})();

// API route để lấy danh sách nội dung
app.get('/api/library/:type', async (req, res) => {
  try {
    const { type } = req.params; // 'movies', 'tv', 'music'
    const drive = google.drive({ version: 'v3', auth });
    
    // Lấy ID của thư mục tương ứng
    let folderId;
    switch(type) {
      case 'movies':
        folderId = process.env.MOVIES_FOLDER_ID;
        break;
      case 'tv':
        folderId = process.env.TV_FOLDER_ID;
        break;
      case 'music':
        folderId = process.env.MUSIC_FOLDER_ID;
        break;
      default:
        return res.status(400).json({ error: 'Invalid content type' });
    }
    
    // Truy vấn files trong thư mục
    const response = await drive.files.list({
      q: `'${folderId}' in parents and trashed=false`,
      fields: 'files(id, name, mimeType, size)',
      orderBy: 'name'
    });
    
    // Định dạng kết quả để MonPlayer có thể hiểu
    const formattedItems = response.data.files.map(file => {
      return {
        id: file.id,
        title: file.name.replace(/\.[^/.]+$/, ""), // Loại bỏ phần mở rộng tệp
        source: `/api/stream/${file.id}`,
        poster: `/api/thumbnail/${file.id}`,
        type: file.mimeType
      };
    });
    
    res.json(formattedItems);
  } catch (error) {
    console.error('Error fetching library:', error);
    res.status(500).json({ error: 'Failed to fetch content library' });
  }
});

// API route để phát nội dung
app.get('/api/stream/:fileId', async (req, res) => {
  try {
    const { fileId } = req.params;
    const drive = google.drive({ version: 'v3', auth });
    
    // Lấy thông tin file
    const fileInfo = await drive.files.get({
      fileId: fileId,
      fields: 'name,mimeType,size'
    });
    
    // Kiểm tra range request cho streaming
    const range = req.headers.range;
    const fileSize = parseInt(fileInfo.data.size);
    
    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = (end - start) + 1;
      
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': fileInfo.data.mimeType
      });
      
      // Stream file từ Google Drive
      const fileStream = await drive.files.get({
        fileId: fileId,
        alt: 'media',
        headers: {
          Range: `bytes=${start}-${end}`
        }
      }, { responseType: 'stream' });
      
      fileStream.data.pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': fileInfo.data.mimeType
      });
      
      const fileStream = await drive.files.get({
        fileId: fileId,
        alt: 'media'
      }, { responseType: 'stream' });
      
      fileStream.data.pipe(res);
    }
  } catch (error) {
    console.error('Error streaming content:', error);
    res.status(500).json({ error: 'Failed to stream content' });
  }
});

// API để lấy thumbnail
app.get('/api/thumbnail/:fileId', async (req, res) => {
  try {
    const { fileId } = req.params;
    const drive = google.drive({ version: 'v3', auth });
    
    // Lấy thumbnail từ Google Drive
    const thumbnail = await drive.files.get({
      fileId: fileId,
      fields: 'thumbnailLink'
    });
    
    if (thumbnail.data.thumbnailLink) {
      res.redirect(thumbnail.data.thumbnailLink);
    } else {
      // Gửi một thumbnail mặc định nếu không có
      res.sendFile(path.join(__dirname, 'default-thumbnail.jpg'));
    }
  } catch (error) {
    console.error('Error fetching thumbnail:', error);
    res.status(500).json({ error: 'Failed to fetch thumbnail' });
  }
});

// API để lấy manifest.json cho MonPlayer
app.get('/api/manifest', (req, res) => {
  const manifest = {
    name: "Thư viện cá nhân",
    version: "1.0",
    description: "Kho nội dung cá nhân từ Google Drive",
    categories: [
      {
        name: "Phim",
        endpoint: "/api/library/movies"
      },
      {
        name: "TV Shows",
        endpoint: "/api/library/tv"
      },
      {
        name: "Nhạc",
        endpoint: "/api/library/music"
      }
    ]
  };
  
  res.json(manifest);
});

// Khởi động server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
