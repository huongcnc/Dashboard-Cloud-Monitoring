/* Bộ lọc khoảng thời gian dùng chung cho trang Logs và Cảnh báo.
 *
 * Một "range" được lưu dưới dạng { preset, from, to }:
 *   - preset: khóa của mốc có sẵn ('today', 'last24h', ...), 'all' hoặc 'custom'
 *   - from / to: chuỗi datetime-local, chỉ dùng khi preset === 'custom'
 * Mốc tương đối ("24 giờ qua") và mốc theo lịch ("Hôm nay") luôn được tính lại
 * từ giờ hiện tại mỗi lần gọi resolveRange(), nên "Hôm nay" qua ngày mới vẫn đúng.
 * Tuần bắt đầu từ Thứ Hai (theo thông lệ Việt Nam).
 */

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const endOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const mondayOf = d => addDays(startOfDay(d), -((d.getDay() + 6) % 7));
const endOfMonth = (y, m) => new Date(y, m + 1, 0, 23, 59, 59, 999);

/* calc(now) -> [from, to] */
export const PRESET_GROUPS = [
  {
    title: 'Gần đây',
    items: [
      { key: 'last15m', label: '15 phút qua', calc: n => [new Date(n - 15 * MIN), n] },
      { key: 'last1h',  label: '1 giờ qua',   calc: n => [new Date(n - HOUR), n] },
      { key: 'last24h', label: '24 giờ qua',  calc: n => [new Date(n - DAY), n] },
      { key: 'last7d',  label: '7 ngày qua',  calc: n => [new Date(n - 7 * DAY), n] },
      { key: 'last30d', label: '30 ngày qua', calc: n => [new Date(n - 30 * DAY), n] },
    ],
  },
  {
    title: 'Theo lịch',
    items: [
      { key: 'today',     label: 'Hôm nay',    calc: n => [startOfDay(n), endOfDay(n)] },
      { key: 'yesterday', label: 'Hôm qua',    calc: n => [startOfDay(addDays(n, -1)), endOfDay(addDays(n, -1))] },
      { key: 'thisWeek',  label: 'Tuần này',   calc: n => [mondayOf(n), endOfDay(addDays(mondayOf(n), 6))] },
      { key: 'lastWeek',  label: 'Tuần trước', calc: n => [addDays(mondayOf(n), -7), endOfDay(addDays(mondayOf(n), -1))] },
      { key: 'thisMonth', label: 'Tháng này',  calc: n => [new Date(n.getFullYear(), n.getMonth(), 1), endOfMonth(n.getFullYear(), n.getMonth())] },
      { key: 'lastMonth', label: 'Tháng trước', calc: n => [new Date(n.getFullYear(), n.getMonth() - 1, 1), endOfMonth(n.getFullYear(), n.getMonth() - 1)] },
    ],
  },
];

const PRESET_MAP = Object.fromEntries(
  PRESET_GROUPS.flatMap(g => g.items).map(p => [p.key, p]),
);

export const DEFAULT_RANGE = { preset: 'all', from: '', to: '' };
export const isRangeActive = r => !!r && r.preset !== 'all';

/* Ô datetime-local bỏ phần giây khi giây = 0: "…T08:07" nghĩa là hết phút 08:07 đó,
 * nên mốc kết thúc được cộng thêm 59,999 giây để không loại nhầm các bản ghi 08:07:45. */
const parseFrom = v => { const d = v ? new Date(v) : null; return d && !isNaN(d.getTime()) ? d : null; };
export const parseCustomEnd = v => {
  const d = v ? new Date(v) : null;
  if (!d || isNaN(d.getTime())) return null;
  return v.length <= 16 ? new Date(d.getTime() + 59999) : d;
};

/* -> { from: Date|null, to: Date|null } ; null = không giới hạn phía đó */
export function resolveRange(range, now = new Date(Date.now())) {
  if (!range || range.preset === 'all') return { from: null, to: null };
  if (range.preset === 'custom') return { from: parseFrom(range.from), to: parseCustomEnd(range.to) };
  const p = PRESET_MAP[range.preset];
  if (!p) return { from: null, to: null };
  const [from, to] = p.calc(now);
  return { from, to };
}

/* ts: mili-giây. Không có giới hạn thì luôn đúng. */
export function inRange(ts, r) {
  if (!r || (!r.from && !r.to)) return true;
  if (typeof ts !== 'number' || isNaN(ts)) return false;
  if (r.from && ts < r.from.getTime()) return false;
  if (r.to && ts > r.to.getTime()) return false;
  return true;
}

const pad = n => String(n).padStart(2, '0');
const fmtShort = d => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

export function formatRangeLabel(range) {
  if (!isRangeActive(range)) return 'Tất cả thời gian';
  if (range.preset === 'custom') {
    const f = parseFrom(range.from);
    const t = parseCustomEnd(range.to);
    if (f && t) return `${fmtShort(f)} → ${fmtShort(t)}`;
    if (f) return `Từ ${fmtShort(f)}`;
    if (t) return `Đến ${fmtShort(t)}`;
    return 'Tùy chỉnh';
  }
  return PRESET_MAP[range.preset]?.label || 'Tất cả thời gian';
}

/* Cho trang khác mở lên vẫn giữ khoảng thời gian đang chọn (như Kibana) */
const STORAGE_KEY = 'timeRange.v1';
export function loadSharedRange() {
  try {
    const r = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (r && typeof r.preset === 'string') {
      return { preset: r.preset, from: r.from || '', to: r.to || '' };
    }
  } catch (e) { /* ignore */ }
  return DEFAULT_RANGE;
}
export function saveSharedRange(r) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(r)); } catch (e) { /* ignore */ }
}

/* Date -> 'YYYY-MM-DDTHH:mm:ss' cho <input type="datetime-local"> */
export const toInputValue = d =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;