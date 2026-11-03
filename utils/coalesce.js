// ===== Tiện ích chạy tuần tự / gộp lượt cho các tác vụ dùng chung =====
// Dùng khi NHIỀU người kích hoạt cùng 1 việc gần như cùng lúc (vd 10 người cùng
// cập nhật điểm Thí Kiếm -> 10 lần "tính lại hạng + edit bảng xếp hạng"). Chạy
// song song sẽ (1) đốt quota Google Sheets, (2) có thể để bản tính CŨ ghi đè bản
// MỚI (lượt nào xong sau thì thắng, dù dữ liệu cũ hơn).

// Mutex đơn giản: runExclusive(fn) chạy fn KHI các lượt gọi trước đó đã xong,
// đúng thứ tự gọi (FIFO). Lỗi của 1 lượt KHÔNG chặn các lượt sau.
function createMutex() {
  let tail = Promise.resolve();
  return {
    runExclusive(fn) {
      const result = tail.then(() => fn());
      tail = result.then(
        () => undefined,
        () => undefined
      );
      return result;
    },
  };
}

// Gộp lượt: nếu đang có 1 lượt chạy thì các lời gọi tới trong lúc đó CHIA SẺ
// chung đúng 1 lượt kế tiếp (chạy ngay khi lượt hiện tại xong). Mỗi lời gọi luôn
// nhận kết quả của 1 lượt BẮT ĐẦU SAU khi nó gọi -> chắc chắn thấy dữ liệu mới
// nhất mà nó vừa ghi, không bao giờ nhận kết quả của lượt đã bắt đầu từ trước.
function createCoalescedRunner(fn) {
  let running = null;
  let queued = null;

  function start() {
    const promise = Promise.resolve().then(() => fn());
    running = promise;
    const clear = () => {
      if (running === promise) running = null;
    };
    promise.then(clear, clear);
    return promise;
  }

  return function run() {
    if (!running) return start();
    if (!queued) {
      queued = running
        .catch(() => undefined)
        .then(() => {
          queued = null;
          return start();
        });
    }
    return queued;
  };
}

module.exports = { createMutex, createCoalescedRunner };
