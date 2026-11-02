import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Check } from 'lucide-react';
import { monthDays, monthOf, shiftMonth } from '../domain/ledger';

const weekdays = ['一', '二', '三', '四', '五', '六', '日'];
const weekdayNames = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
function localDate(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}
function isoDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function offsetDate(value: string, delta: number) {
  const date = localDate(value);
  date.setDate(date.getDate() + delta);
  return isoDate(date);
}
function chineseDate(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return `${year} 年 ${month} 月 ${day} 日`;
}

/** Inline calendar keeps date picking inside the existing, focus-trapped entry dialog. */
export default function DatePicker({
  value,
  min,
  max,
  onChange,
}: {
  value: string;
  min: string;
  max: string;
  onChange: (date: string) => void;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const calendar = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [month, setMonth] = useState(monthOf(value));
  const [focused, setFocused] = useState(value);
  useEffect(() => {
    if (!expanded) return;
    const frame = requestAnimationFrame(() => {
      grid.current
        ?.querySelector<HTMLButtonElement>(`button[data-date="${value}"]`)
        ?.focus({ preventScroll: true });
      calendar.current?.scrollIntoView({ block: 'nearest' });
    });
    return () => cancelAnimationFrame(frame);
  }, [expanded]);
  const quick = ['今天', '昨天', '前天'].map((label, index) => ({
    label,
    date: offsetDate(max, -index),
  }));
  const relative = quick.find((item) => item.date === value)?.label;
  const weekday = weekdayNames[localDate(value).getDay()];
  const firstDay = (localDate(`${month}-01`).getDay() + 6) % 7;
  const slots = Array.from(
    { length: Math.ceil((firstDay + monthDays(month)) / 7) * 7 },
    (_, index) => {
      const day = index - firstDay + 1;
      return day > 0 && day <= monthDays(month) ? `${month}-${String(day).padStart(2, '0')}` : null;
    },
  );
  const months: string[] = [];
  for (let m = monthOf(min); m <= monthOf(max); m = shiftMonth(m, 1)) months.push(m);
  const allowed = (date: string) => date >= min && date <= max;
  function choose(date: string) {
    if (!allowed(date)) return;
    onChange(date);
    setFocused(date);
    setMonth(monthOf(date));
    setExpanded(false);
    trigger.current?.focus();
  }
  function moveMonth(next: string) {
    setMonth(next);
    const first = `${next}-01`;
    setFocused(first < min ? min : first);
  }
  function onKey(event: KeyboardEvent<HTMLButtonElement>, date: string) {
    let next: string | undefined;
    const day = (localDate(date).getDay() + 6) % 7;
    switch (event.key) {
      case 'ArrowLeft':
        next = offsetDate(date, -1);
        break;
      case 'ArrowRight':
        next = offsetDate(date, 1);
        break;
      case 'ArrowUp':
        next = offsetDate(date, -7);
        break;
      case 'ArrowDown':
        next = offsetDate(date, 7);
        break;
      case 'Home':
        next = offsetDate(date, -day);
        break;
      case 'End':
        next = offsetDate(date, 6 - day);
        break;
      case 'PageUp':
      case 'PageDown': {
        const target = shiftMonth(monthOf(date), event.key === 'PageUp' ? -1 : 1);
        next = `${target}-${String(Math.min(Number(date.slice(8)), monthDays(target))).padStart(2, '0')}`;
        break;
      }
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        setExpanded(false);
        trigger.current?.focus();
        return;
      default:
        return;
    }
    event.preventDefault();
    next = next < min ? min : next > max ? max : next;
    setFocused(next);
    setMonth(monthOf(next));
    const target = next;
    requestAnimationFrame(() =>
      grid.current?.querySelector<HTMLButtonElement>(`button[data-date="${target}"]`)?.focus(),
    );
  }
  return (
    <section
      className="date-picker"
      aria-labelledby={`${id}-label`}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && expanded) {
          event.preventDefault();
          event.stopPropagation();
          setExpanded(false);
          trigger.current?.focus();
        }
      }}
    >
      <div className="date-label" id={`${id}-label`}>
        发生日期
      </div>
      <div className="date-shortcuts" aria-label="快捷选择日期">
        {quick.map((item) => (
          <button
            key={item.date}
            type="button"
            aria-pressed={value === item.date}
            disabled={!allowed(item.date)}
            className={value === item.date ? 'selected' : ''}
            onClick={() => choose(item.date)}
          >
            {item.label}
            {value === item.date && <Check size={13} />}
          </button>
        ))}
        <span>补记也很方便</span>
      </div>
      <button
        ref={trigger}
        type="button"
        className={`date-trigger${expanded ? ' expanded' : ''}`}
        aria-label={`发生日期：${relative ? relative + '，' : ''}${chineseDate(value)}，${weekday}`}
        aria-expanded={expanded}
        aria-controls={`${id}-calendar`}
        onClick={() => {
          setMonth(monthOf(value));
          setFocused(value);
          setExpanded(!expanded);
        }}
      >
        <span className="date-trigger-icon">
          <CalendarDays size={20} />
        </span>
        <span className="date-trigger-text">
          <strong>
            {relative ? `${relative} · ` : ''}
            {chineseDate(value)}
          </strong>
          <small>
            {weekday} · {expanded ? '点选日期，即可收起' : '点击展开月历'}
          </small>
        </span>
        <ChevronDown size={18} className="date-chevron" />
      </button>
      {expanded && (
        <div ref={calendar} className="date-calendar" id={`${id}-calendar`}>
          <div className="calendar-heading">
            <button
              type="button"
              className="icon-button"
              aria-label="日期选择：上个月"
              disabled={month <= monthOf(min)}
              onClick={() => moveMonth(shiftMonth(month, -1))}
            >
              <ChevronLeft size={19} />
            </button>
            <select
              aria-label="日期选择：月份"
              value={month}
              onChange={(event) => moveMonth(event.target.value)}
            >
              {months.map((m) => (
                <option key={m} value={m}>
                  {Number(m.slice(0, 4))} 年 {Number(m.slice(5))} 月
                </option>
              ))}
            </select>
            <button
              type="button"
              className="icon-button"
              aria-label="日期选择：下个月"
              disabled={month >= monthOf(max)}
              onClick={() => moveMonth(shiftMonth(month, 1))}
            >
              <ChevronRight size={19} />
            </button>
          </div>
          <div className="calendar-weekdays" aria-hidden="true">
            {weekdays.map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>
          <div
            ref={grid}
            className="calendar-days"
            role="group"
            aria-label={`${Number(month.slice(0, 4))} 年 ${Number(month.slice(5))} 月日期`}
          >
            {slots.map((date, index) =>
              date ? (
                <button
                  key={date}
                  type="button"
                  data-date={date}
                  className={`calendar-day${date === value ? ' selected' : ''}${date === max ? ' is-today' : ''}`}
                  disabled={!allowed(date)}
                  aria-label={`${chineseDate(date)}${date === max ? '，今天' : ''}`}
                  aria-pressed={date === value}
                  aria-current={date === max ? 'date' : undefined}
                  tabIndex={date === focused && allowed(date) ? 0 : -1}
                  onFocus={() => setFocused(date)}
                  onKeyDown={(event) => onKey(event, date)}
                  onClick={() => choose(date)}
                >
                  {Number(date.slice(8))}
                  <span className="today-marker" />
                </button>
              ) : (
                <span key={`empty-${index}`} />
              ),
            )}
          </div>
          <div className="calendar-footer">
            <span>
              可选：{min.replaceAll('-', '.')} — {max.replaceAll('-', '.')}
            </span>
            <button type="button" className="text-button" onClick={() => choose(max)}>
              回到今天
            </button>
          </div>
        </div>
      )}
      {!expanded && <p className="date-hint">可以补记历史账单，未来日期不可选</p>}
    </section>
  );
}
