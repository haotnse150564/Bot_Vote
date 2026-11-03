# Nhất Mộng — Bot Bang + Role

Bản rút gọn của NhatMongBot, chỉ giữ tính năng liên quan tới bang và cấp role. Node.js ≥ 20, discord.js v14, CommonJS.

## Tính năng
- **Điểm danh Bang Chiến / Scrim**: `nm!scrim`, `us1`, `us2`, `reset`, `rsvote`, `code`, `bc`, `checkvote`, `topvote` (và slash tương ứng), react vote Thứ 4/5/6, nhắc lịch (`reminders/`), `/upload /usi /post /rpost /where` (ảnh vị trí từ Google Sheet nguồn), `nm!testbc/testgcmn/testscrim1/2`.
- **Thống kê Bang Chiến**: `/bcstat` (đọc ảnh bằng Gemini), Sảnh Vinh Danh (`/vinhdanh`, `/xem-vinh-danh`), thống kê voice (`/voice`, `/voicestats`, `/lich`).
- **Cấp role**: Pick Role bằng react (`/pickrole`), tự gán role + ảnh chào khi có người vào server (`welcome/`), chào khi được gắn role member bang (`events/roleGreet.js`), role Auto Vote bằng react ✅ (`events/autoVoteRoleEvents.js`).
- **Đua Rank Thí Kiếm**: `/rank`, `/set-mua-giai`, `/xoa-diem-thi-kiem`, `/xem-bang-xep-hang-thi-kiem`, bảng xếp hạng trong kênh Hub.
- Menu Hub (3 nút: Đua Rank, Vinh Danh, BC Stat), `/ping`, `/help`.

## Chạy
```bash
npm install
cp .env.example .env   # điền giá trị rồi nạp vào môi trường
node index.js
```

## Lưu ý quan trọng
- Nhiều ID kênh/role/sheet trong `config/*.js` là mặc định của server cũ. Đổi qua ENV (xem `.env.example`) hoặc sửa trực tiếp, nếu không bot sẽ trỏ vào kênh/sheet cũ.
- Mỗi lần khởi động bot **xoá sạch tin trong kênh Hub, Thí Kiếm, Vinh Danh** rồi đăng lại tin cố định (`utils/channelReset.js`). Đặt đúng ID kênh trước khi chạy.
- Đừng chạy song song với bot NMB cũ trong cùng server với cùng token/ID kênh (trùng handler, trùng lệnh).
- Slash command đăng ký cho đúng 1 server (`DISCORD_GUILD_ID`), Discord giới hạn 100 lệnh/server.
