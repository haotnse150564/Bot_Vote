// ===== Hàng chờ vẽ thẻ ảnh (/level, /hoso, ...) =====
// Vẽ thẻ = sharp + librsvg + font CJK 19 MB, mỗi lần tốn nhiều RAM. Nếu nhiều người gõ lệnh cùng lúc thì các lần vẽ
// chạy song song và RAM vọt lên. Dùng chung 1 hàng chờ: người đến sau chờ người trước vẽ xong rồi mới tới lượt.
//
// Dùng:  const png = await runRenderQueue(() => renderXxxCard(...), (ahead) => báoNgườiDùng(ahead));
//   - onWait(ahead): gọi ĐÚNG 1 lần nếu phải chờ; ahead = số người đang vẽ/đang chờ phía trước. Lỗi trong onWait bị bỏ qua.
//   - Chờ quá lâu hoặc hàng đầy -> ném lỗi (nơi gọi đã có sẵn nhánh "vẽ lỗi thì quay về embed").
const MAX_WAITING = 20; // tối đa 20 người đứng chờ
const MAX_WAIT_MS = 45 * 1000; // chờ tối đa 45 giây
const MAX_JOB_MS = 60 * 1000; // 1 lần vẽ kẹt quá 60 giây thì nhả lượt để hàng chờ không đứng mãi

let busy = false;
const waiters = [];

function acquire(onWait) {
  if (!busy) {
    busy = true;
    return Promise.resolve();
  }
  if (waiters.length >= MAX_WAITING) return Promise.reject(new Error('Hàng chờ vẽ thẻ đã đầy.'));
  const ahead = waiters.length + 1; // người đang vẽ + những người đã xếp trước
  if (typeof onWait === 'function') {
    try {
      Promise.resolve(onWait(ahead)).catch(() => {});
    } catch (_) {
      /* bỏ qua lỗi báo chờ */
    }
  }
  return new Promise((resolve, reject) => {
    const waiter = { resolve, timer: null };
    waiter.timer = setTimeout(() => {
      const i = waiters.indexOf(waiter);
      if (i >= 0) waiters.splice(i, 1);
      reject(new Error('Chờ vẽ thẻ quá lâu.'));
    }, MAX_WAIT_MS);
    waiters.push(waiter);
  });
}

function release() {
  const next = waiters.shift();
  if (next) {
    clearTimeout(next.timer);
    next.resolve(); // trao lượt cho người kế tiếp, busy giữ nguyên true
  } else {
    busy = false;
  }
}

async function runRenderQueue(job, onWait) {
  await acquire(onWait);
  let released = false;
  const releaseOnce = () => {
    if (released) return;
    released = true;
    release();
  };
  const guard = setTimeout(releaseOnce, MAX_JOB_MS);
  try {
    return await job();
  } finally {
    clearTimeout(guard);
    releaseOnce();
  }
}

function getRenderQueueSize() {
  return { busy, waiting: waiters.length };
}

module.exports = { runRenderQueue, getRenderQueueSize };
