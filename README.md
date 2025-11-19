# VN Meet – WebRTC Video Conference App

Ứng dụng video conference 1-1 sử dụng WebRTC, Node.js, và Electron.

## Cấu trúc dự án

- `server.js`: Máy chủ signaling (Socket.IO) và web server (Express).
- `public/`: Thư mục chứa các file phía client (HTML, CSS, JS).
  - `client.js`: Logic WebRTC phía client, xử lý giao diện và tương tác.
  - `index.html`: Giao diện chính của ứng dụng.
  - `style.css`: CSS cho giao diện.
- `electron/`: Thư mục chứa code cho ứng dụng Electron.
  - `main.js`: Tiến trình chính của Electron, tạo cửa sổ và xử lý quyền.
  - `preload.js`: Cầu nối an toàn giữa tiến trình chính và renderer của Electron.
- `package.json`: Quản lý các gói phụ thuộc và script cho dự án.
- `key.pem` & `cert.pem`: Cặp khóa SSL tự động tạo ra để chạy HTTPS.

## Yêu cầu

- [Node.js](https://nodejs.org/) (phiên bản 16.x trở lên).
- `npm` (thường đi kèm với Node.js).

## Hướng dẫn cài đặt và chạy

### 1. Clone repository

```bash
git clone <your-repo-url>
cd webrtc-node-app
```

### 2. Cài đặt các gói phụ thuộc

Chạy lệnh sau trong thư mục gốc của dự án để cài đặt các thư viện cần thiết (Express, Socket.IO, Electron, v.v.):

```bash
npm install
```

### 3. Chạy ứng dụng

Dự án cung cấp một script tiện lợi để khởi chạy cả server và ứng dụng Electron cùng lúc.

```bash
npm run dev
```

Lệnh này sẽ:
1.  Khởi động server Node.js ở chế độ watch (tự khởi động lại khi có thay đổi file).
2.  Mở ứng dụng Electron.

**Lưu ý về HTTPS:**
- Lần đầu tiên chạy, server sẽ tự động tạo ra hai file `key.pem` và `cert.pem`. Đây là chứng chỉ SSL tự ký (self-signed) để server có thể chạy trên giao thức `https`.
- Trình duyệt có thể sẽ cảnh báo về chứng chỉ này. Bạn cần chấp nhận rủi ro để tiếp tục (ví dụ: trong Chrome, gõ `thisisunsafe`).
- Ứng dụng Electron đã được cấu hình để tin tưởng chứng chỉ này và sẽ kết nối mà không gặp vấn đề.

### 4. Cách chạy riêng lẻ (Tùy chọn)

Nếu bạn muốn chạy server và Electron riêng biệt:

**Terminal 1: Chạy Server**

```bash
node server.js
```

Server sẽ khởi động, thường là trên `https://0.0.0.0:3000`.

**Terminal 2: Chạy Electron App**

```bash
npx electron .
```

Cửa sổ Electron sẽ mở ra và tự động tải trang từ server đang chạy.

## Kết nối từ máy khác trong cùng mạng LAN

Để người khác trong cùng mạng LAN có thể kết nối, bạn cần:

1.  Tìm địa chỉ IP của máy đang chạy server (ví dụ: `192.168.1.10`).
2.  Chỉnh sửa file `electron/main.js` và thay đổi biến `SERVER_URL` để trỏ đến IP đó.

    ```javascript
    // electron/main.js
    const HOST = process.env.HOST || '192.168.1.10'; // <-- Thay đổi ở đây
    // ...
    ```

3.  Người dùng khác có thể truy cập vào `https://192.168.1.10:3000` từ trình duyệt của họ (và chấp nhận chứng chỉ không an toàn).
4.  Nhập cùng một Room ID để kết nối.

## Các chức năng chính

- **Gọi video 1-1**: Chất lượng cao, độ trễ thấp.
- **Chat**: Nhắn tin văn bản trong phòng.
- **Chia sẻ màn hình**: Chia sẻ toàn màn hình hoặc một cửa sổ ứng dụng.
- **Thả cảm xúc**: Gửi các emoji cảm xúc nhanh.
- **Chạy đa nền tảng**: Hoạt động trên trình duyệt và dưới dạng ứng dụng desktop (Windows, macOS, Linux) nhờ Electron.
