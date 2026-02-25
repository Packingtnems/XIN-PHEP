require('dotenv').config();
const express = require('express');
const webpush = require('web-push');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

// ==================== KHỞI TẠO ====================
const app = express();
const PORT = process.env.PORT || 3000;

// Cấu hình VAPID từ file .env
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';

// Kiểm tra VAPID keys
if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  console.error('❌ LỖI: Thiếu VAPID keys!');
  console.error('Vui lòng tạo file .env với VAPID keys');
  process.exit(1);
}

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

// ==================== MIDDLEWARE ====================
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Serve static files từ thư mục public
app.use(express.static(path.join(__dirname, 'public')));

// Logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// ==================== FILE LƯU TRỮ ====================
const DATA_DIR = path.join(__dirname, 'data');
const SUBSCRIPTIONS_FILE = path.join(DATA_DIR, 'subscriptions.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

// Tạo thư mục data nếu chưa có
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Tạo file users.json mẫu nếu chưa có
if (!fs.existsSync(USERS_FILE)) {
  const defaultUsers = {
    "4810": { 
      name: "Trà Thị Tuyết Trang", 
      role: "manager", 
      department: "Nhân sự"
    },
    "5035": { 
      name: "Lê Văn Luýt", 
      role: "employee", 
      department: "Kỹ thuật"
    },
    "1234": { 
      name: "Nguyễn Thị Vân Hiếu", 
      role: "HR", 
      department: "Nhân sự"
    }
  };
  fs.writeFileSync(USERS_FILE, JSON.stringify(defaultUsers, null, 2));
  console.log('✅ Đã tạo file users.json mẫu');
}

// ==================== HÀM ĐỌC/GHI FILE ====================
function readJSONFile(filePath, defaultValue = {}) {
  try {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error(`❌ Lỗi đọc file ${filePath}:`, error.message);
  }
  return defaultValue;
}

function writeJSONFile(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    return true;
  } catch (error) {
    console.error(`❌ Lỗi ghi file ${filePath}:`, error.message);
    return false;
  }
}

// ==================== API ROUTES ====================

// Trang chủ
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Lấy VAPID public key cho frontend
app.get('/api/vapid-key', (req, res) => {
  res.json({ 
    success: true, 
    publicKey: VAPID_PUBLIC_KEY 
  });
});

// Đăng ký nhận thông báo (gọi từ frontend)
app.post('/api/subscribe', (req, res) => {
  try {
    console.log('📥 Nhận subscription mới');
    
    const { userId, subscription } = req.body;
    
    if (!userId || !subscription || !subscription.endpoint) {
      return res.status(400).json({ 
        success: false, 
        error: 'Thiếu thông tin bắt buộc' 
      });
    }
    
    let subscriptions = readJSONFile(SUBSCRIPTIONS_FILE, {});
    
    subscriptions[userId] = {
      endpoint: subscription.endpoint,
      keys: subscription.keys,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    writeJSONFile(SUBSCRIPTIONS_FILE, subscriptions);
    
    console.log(`✅ Đã lưu subscription cho user: ${userId}`);
    
    res.json({ 
      success: true, 
      message: 'Đăng ký nhận thông báo thành công'
    });
    
  } catch (error) {
    console.error('❌ Lỗi lưu subscription:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Lỗi server' 
    });
  }
});

// API cho Google Apps Script gọi khi có đơn mới
app.post('/api/notify-new-leave', async (req, res) => {
  try {
    const { userName, userId, leaveData } = req.body;
    
    console.log(`📤 Gửi thông báo đơn mới từ: ${userName}`);
    
    const users = readJSONFile(USERS_FILE, {});
    const subscriptions = readJSONFile(SUBSCRIPTIONS_FILE, {});
    
    // Lọc quản lý và HR (trừ người gửi)
    const managerIds = Object.keys(users).filter(id => 
      (users[id].role === 'manager' || users[id].role === 'HR') && 
      id !== userId
    );
    
    console.log(`👔 Tìm thấy ${managerIds.length} quản lý`);
    
    let sentCount = 0;
    let removedCount = 0;
    
    // Gửi thông báo đến từng quản lý
    for (const managerId of managerIds) {
      const subscription = subscriptions[managerId];
      
      if (subscription) {
        try {
          const payload = JSON.stringify({
            title: '📝 ĐƠN NGHỈ PHÉP MỚI',
            body: `${userName} vừa gửi đơn nghỉ phép`,
            icon: '/icon-192x192.png',
            badge: '/icon-192x192.png',
            data: {
              type: 'new_leave',
              userId: userId,
              userName: userName,
              leaveId: leaveData?.id || Date.now(),
              url: '/'
            },
            vibrate: [200, 100, 200],
            requireInteraction: true
          });
          
          await webpush.sendNotification(subscription, payload);
          sentCount++;
          console.log(`   ✅ Đã gửi đến ${users[managerId]?.name || managerId}`);
        } catch (error) {
          console.error(`   ❌ Lỗi gửi đến ${managerId}:`, error.message);
          
          // Xóa subscription không hợp lệ
          if (error.statusCode === 410) {
            delete subscriptions[managerId];
            removedCount++;
          }
        }
      }
    }
    
    // Lưu lại sau khi xóa
    if (removedCount > 0) {
      writeJSONFile(SUBSCRIPTIONS_FILE, subscriptions);
    }
    
    res.json({
      success: true,
      message: `Đã gửi ${sentCount} thông báo`
    });
    
  } catch (error) {
    console.error('❌ Lỗi:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Lỗi server' 
    });
  }
});

// API cho Google Apps Script gọi khi duyệt/từ chối đơn
app.post('/api/notify-leave-result', async (req, res) => {
  try {
    const { userId, userName, status, reason } = req.body;
    
    console.log(`📤 Gửi thông báo kết quả cho: ${userName} (${status})`);
    
    const subscriptions = readJSONFile(SUBSCRIPTIONS_FILE, {});
    const subscription = subscriptions[userId];
    
    if (!subscription) {
      return res.json({ 
        success: false, 
        message: 'Người dùng chưa đăng ký nhận thông báo' 
      });
    }
    
    const isApproved = status === 'approved';
    const title = isApproved ? '✅ ĐƠN ĐÃ ĐƯỢC DUYỆT' : '❌ ĐƠN BỊ TỪ CHỐI';
    const body = isApproved 
      ? `Đơn nghỉ phép của bạn đã được duyệt`
      : `Đơn bị từ chối: ${reason || 'Không rõ lý do'}`;
    
    const payload = JSON.stringify({
      title: title,
      body: body,
      icon: '/icon-192x192.png',
      badge: '/icon-192x192.png',
      data: {
        type: `leave_${status}`,
        url: '/'
      },
      vibrate: [200, 100, 200],
      requireInteraction: true
    });
    
    await webpush.sendNotification(subscription, payload);
    console.log(`✅ Đã gửi thông báo đến ${userName}`);
    
    res.json({ success: true, message: 'Đã gửi thông báo' });
    
  } catch (error) {
    console.error('❌ Lỗi:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Test notification (dùng để test)
app.post('/api/test-notification', async (req, res) => {
  try {
    const { userId } = req.body;
    
    const subscriptions = readJSONFile(SUBSCRIPTIONS_FILE, {});
    const subscription = subscriptions[userId];
    
    if (!subscription) {
      return res.status(404).json({ 
        success: false, 
        error: 'Chưa đăng ký nhận thông báo' 
      });
    }
    
    const payload = JSON.stringify({
      title: '🔔 TEST NOTIFICATION',
      body: 'Đây là thông báo test từ hệ thống',
      icon: '/icon-192x192.png',
      data: { type: 'test' }
    });
    
    await webpush.sendNotification(subscription, payload);
    res.json({ success: true, message: 'Đã gửi test notification' });
    
  } catch (error) {
    console.error('❌ Lỗi test:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Kiểm tra health
app.get('/api/health', (req, res) => {
  const subscriptions = readJSONFile(SUBSCRIPTIONS_FILE, {});
  const users = readJSONFile(USERS_FILE, {});
  
  res.json({
    success: true,
    status: 'running',
    uptime: process.uptime(),
    stats: {
      totalSubscriptions: Object.keys(subscriptions).length,
      totalUsers: Object.keys(users).length
    }
  });
});

// Xóa subscription
app.delete('/api/unsubscribe/:userId', (req, res) => {
  try {
    const { userId } = req.params;
    let subscriptions = readJSONFile(SUBSCRIPTIONS_FILE, {});
    
    if (subscriptions[userId]) {
      delete subscriptions[userId];
      writeJSONFile(SUBSCRIPTIONS_FILE, subscriptions);
      res.json({ success: true, message: 'Đã hủy đăng ký' });
    } else {
      res.json({ success: false, message: 'Không tìm thấy' });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== KHỞI CHẠY SERVER ====================
app.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔════════════════════════════════════════════════╗
║                                                ║
║   🚀 SERVER ĐANG CHẠY                          ║
║                                                ║
╠════════════════════════════════════════════════╣
║                                                ║
║   📍 Port: ${PORT}                                 ║
║   🔑 VAPID: ${VAPID_PUBLIC_KEY.substring(0, 20)}...  ║
║   📁 Data: ${DATA_DIR}                           ║
║                                                ║
╚════════════════════════════════════════════════╝
  `);
});