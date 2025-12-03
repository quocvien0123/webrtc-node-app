// routes/auth.js
// ==========================================
// AUTH ROUTES - XỪL LÝ ĐĂNG KÝ/ĐĂNG NHẬP
// ==========================================
// Chứa 3 endpoints:
// 1. POST /api/auth/register - Đăng ký tài khoản mới
// 2. POST /api/auth/login - Đăng nhập và nhận JWT token
// 3. GET /api/auth/verify - Xác thực token (kiểm tra đã đăng nhập)
// ==========================================

const express = require('express');
const jwt = require('jsonwebtoken');  // Tạo và verify JWT tokens
const User = require('../models/User'); // User model (MongoDB schema)

const router = express.Router();

// ===== JWT SECRET KEY =====
// Key dùng để ký và xác thực JWT tokens
// Nên đặt trong .env và giữ bí mật
const JWT_SECRET = process.env.JWT_SECRET;

// ===== MIDDLEWARE: AUTHENTICATE TOKEN =====
// Kiểm tra và xác thực JWT token trong request header
// Sử dụng cho các protected routes (verify endpoint)
const authenticateToken = (req, res, next) => {
  // Lấy Authorization header: "Bearer <token>"
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Lấy phần token sau "Bearer"

  // Nếu không có token → trả lỗi 401 Unauthorized
  if (!token) {
    return res.status(401).json({ message: 'Không có token xác thực' });
  }

  // Verify token với JWT_SECRET
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      // Token không hợp lệ hoặc hết hạn → trả lỗi 403 Forbidden
      return res.status(403).json({ message: 'Token không hợp lệ hoặc đã hết hạn' });
    }
    // Token hợp lệ → lưu user info vào req.user
    req.user = user;
    next(); // Tiếp tục xử lý request
  });
};

// ===== ENDPOINT: POST /api/auth/register =====
// Đăng ký tài khoản mới
// Body: { username, email, password }
router.post('/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;

    // ===== VALIDATE INPUT =====
    // Kiểm tra các trường bắt buộc
    if (!username || !email || !password) {
      return res.status(400).json({ message: 'Vui lòng điền đầy đủ thông tin' });
    }

    // Kiểm tra độ dài mật khẩu (tối thiểu 6 ký tự)
    if (password.length < 6) {
      return res.status(400).json({ message: 'Mật khẩu phải có ít nhất 6 ký tự' });
    }

    // ===== CHECK DUPLICATE =====
    // Kiểm tra username hoặc email đã tồn tại chưa
    const existingUser = await User.findOne({ $or: [{ username }, { email }] });
    if (existingUser) {
      return res.status(400).json({ 
        message: existingUser.username === username 
          ? 'Tên đăng nhập đã tồn tại' 
          : 'Email đã được sử dụng' 
      });
    }

    // ===== CREATE USER =====
    // Tạo user mới (password sẽ tự động hash trong User model)
    const user = new User({ username, email, password });
    await user.save(); // Lưu vào MongoDB

    // ===== GENERATE JWT TOKEN =====
    // Tạo token với thông tin user, hết hạn sau 7 ngày
    const token = jwt.sign(
      { id: user._id, username: user.username }, // Payload
      JWT_SECRET,                                 // Secret key
      { expiresIn: '7d' }                         // Thời gian hết hạn
    );

    // ===== RESPONSE =====
    // Trả về token và thông tin user (không gửi password)
    res.status(201).json({
      message: 'Đăng ký thành công',
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email
      }
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ message: 'Lỗi server khi đăng ký' });
  }
});

// ===== ENDPOINT: POST /api/auth/login =====
// Đăng nhập với username và password
// Body: { username, password }
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    // ===== VALIDATE INPUT =====
    if (!username || !password) {
      return res.status(400).json({ message: 'Vui lòng nhập tên đăng nhập và mật khẩu' });
    }

    // ===== FIND USER =====
    // Tìm user theo username trong MongoDB
    const user = await User.findOne({ username });
    if (!user) {
      // Không tìm thấy user → trả lỗi chung chung (bảo mật)
      return res.status(401).json({ message: 'Tên đăng nhập hoặc mật khẩu không đúng' });
    }

    // ===== VERIFY PASSWORD =====
    // So sánh password với hash trong database (dùng bcrypt)
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      // Password sai → trả lỗi chung chung
      return res.status(401).json({ message: 'Tên đăng nhập hoặc mật khẩu không đúng' });
    }

    // ===== GENERATE JWT TOKEN =====
    // Đăng nhập thành công → tạo token mới
    const token = jwt.sign(
      { id: user._id, username: user.username },
      JWT_SECRET,
      { expiresIn: '7d' } // Token hết hạn sau 7 ngày
    );

    // ===== RESPONSE =====
    // Trả về token để client lưu vào localStorage
    res.json({
      message: 'Đăng nhập thành công',
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Lỗi server khi đăng nhập' });
  }
});

// ===== ENDPOINT: GET /api/auth/verify =====
// Xác thực token - kiểm tra xem user đã đăng nhập chưa
// Header: Authorization: Bearer <token>
// Sử dụng middleware authenticateToken để verify token
router.get('/verify', authenticateToken, async (req, res) => {
  try {
    // ===== GET USER INFO =====
    // req.user được set bởi middleware authenticateToken
    // Tìm user trong database, không lấy trường password
    const user = await User.findById(req.user.id).select('-password');
    
    if (!user) {
      // User không tồn tại (có thể đã bị xóa)
      return res.status(404).json({ message: 'Không tìm thấy người dùng' });
    }

    // ===== RESPONSE =====
    // Token hợp lệ → trả về thông tin user
    res.json({
      user: {
        id: user._id,
        username: user.username,
        email: user.email
      }
    });
  } catch (error) {
    console.error('Verify error:', error);
    res.status(500).json({ message: 'Lỗi server khi xác thực' });
  }
});

// Export router để sử dụng trong server.js
module.exports = router;
