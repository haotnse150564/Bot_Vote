// ===== Khoá tuần tự cho MỌI thao tác GHI vào sheet BotVote =====
// Vì sao cần: các handler react (thêm/gỡ 4️⃣5️⃣6️⃣0️⃣ ✅), resync, tạo tin vote mới,
// đổi role... chạy SONG SONG. Nhiều thao tác XOÁ dòng theo SỐ THỨ TỰ DÒNG đã đọc
// từ trước (deleteDimension) — khi 2 thao tác cùng đọc 1 bản sheet rồi cùng xoá,
// thao tác thứ 2 xoá TRÚNG DÒNG CỦA NGƯỜI KHÁC vì các dòng đã bị dồn lên. Đây là
// nguyên nhân người có role auto-vote bấm vote tay liên tiếp (4️⃣ rồi 5️⃣ rồi 6️⃣...)
// bị mất sạch vote. Mọi thao tác ghi BotVote giờ chạy lần lượt qua runExclusive().
//
// LƯU Ý: KHÔNG gọi runExclusive() lồng bên trong một runExclusive() khác
// (sẽ tự chờ chính mình -> treo).
let tail = Promise.resolve();

function runExclusive(fn) {
  const run = tail.then(fn);
  tail = run.catch(() => {});
  return run;
}

module.exports = { runExclusive };
