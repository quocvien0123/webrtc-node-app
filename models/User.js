// models/User.js
// ==========================================
// USER MODEL - MONGODB SCHEMA
// ==========================================
// Định nghĩa cấu trúc dữ liệu user trong MongoDB
// Bao gồm: username, email, password (hashed), createdAt
// Sử dụng bcrypt để mã hóa password
// ==========================================

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs'); // Thư viện hash password

// ===== USER SCHEMA =====
// Định nghĩa các field và validation rules
const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,    // Bắt buộc phải có
    unique: true,      // Không được trùng trong database
    trim: true,        // Tự động xóa khoảng trắng 2 đầu
    minlength: 3,      // Tối thiểu 3 ký tự
    maxlength: 30      // Tối đa 30 ký tự
  },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true    // Tự động chuyển thành chữ thường
  },
  password: {
    type: String,
    required: true,
    minlength: 6       // Tối thiểu 6 ký tự (sẽ được hash)
  },
  createdAt: {
    type: Date,
    default: Date.now  // Tự động set thời gian tạo
  }
});

// ===== PRE-SAVE MIDDLEWARE =====
// Tự động mã hóa password trước khi lưu vào database
// Chỉ chạy khi password bị thay đổi (tạo mới hoặc update)
userSchema.pre('save', async function(next) {
  // Nếu password không bị thay đổi → bỏ qua
  if (!this.isModified('password')) return next();
  
  try {
    // Tạo salt (random data) để tăng độ bảo mật
    // Salt rounds = 10 (càng cao càng bảo mật nhưng chậm hơn)
    const salt = await bcrypt.genSalt(10);
    
    // Hash password với salt
    // Kết quả: password plaintext → hash string (60 ký tự)
    this.password = await bcrypt.hash(this.password, salt);
    
    next(); // Tiếp tục lưu
  } catch (error) {
    next(error); // Truyền lỗi lên trên
  }
});

// ===== INSTANCE METHOD: COMPARE PASSWORD =====
// So sánh password plaintext với password đã hash trong DB
// Dùng khi đăng nhập
userSchema.methods.comparePassword = async function(candidatePassword) {
  // bcrypt.compare tự động xử lý salt và so sánh
  // Trả về true nếu khớp, false nếu không
  return await bcrypt.compare(candidatePassword, this.password);
};

// Export model để sử dụng trong routes/auth.js
module.exports = mongoose.model('User', userSchema);
