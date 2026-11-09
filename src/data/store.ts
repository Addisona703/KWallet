import { type Ledger, validateLedger, todayLocal, ensureLifeCategory } from '../domain/ledger';

const DB_NAME = 'kwallet-local';
const STORE = 'ledger';
let connection: Promise<IDBDatabase> | undefined;
let channel: BroadcastChannel | undefined;
const listeners = new Set<() => void>();
function notify() {
  listeners.forEach((fn) => fn());
}
function database() {
  if (!connection)
    connection = new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => {
        req.result.onversionchange = () => {
          req.result.close();
          connection = undefined;
        };
        resolve(req.result);
      };
      req.onerror = () => {
        connection = undefined;
        reject(new Error('无法打开本地数据库，请检查浏览器存储设置'));
      };
      req.onblocked = () => reject(new Error('数据库正在更新，请关闭其他 KWallet 页面后重试'));
    });
  return connection;
}
export async function loadLedger(key = 'current'): Promise<Ledger | null> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, key === 'current' ? 'readwrite' : 'readonly');
    const store = tx.objectStore(STORE);
    const req = store.get(key);
    let result: Ledger | null = null;
    let migrated = false;
    req.onsuccess = () => {
      result = req.result || null;
      if (key === 'current' && result && ensureLifeCategory(result)) {
        result.revision++;
        store.put(result, key);
        migrated = true;
      }
    };
    tx.oncomplete = () => {
      if (migrated) { notify(); channel?.postMessage('changed'); }
      resolve(result);
    };
    tx.onabort = () => reject(new Error('读取账本失败，请重试'));
    req.onerror = () => reject(new Error('读取账本失败，请重试'));
  });
}
export async function mutateLedger(
  change: (current: Ledger | null) => Ledger,
  expectedRevision?: number,
  preservePrevious = false,
): Promise<Ledger> {
  const db = await database();
  return new Promise((resolve, reject) => {
    let output: Ledger;
    let reason: unknown;
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const read = store.get('current');
    read.onsuccess = () => {
      try {
        const current: Ledger | null = read.result || null;
        if (expectedRevision !== undefined && current?.revision !== expectedRevision)
          throw new Error('账本已在其他页面更新，请关闭表单后重新操作');
        if (preservePrevious && current) store.put(current, 'before-restore');
        output = change(current);
        ensureLifeCategory(output);
        output.revision = (current?.revision ?? 0) + 1;
        validateLedger(output, todayLocal());
        store.put(output, 'current');
      } catch (error) {
        reason = error;
        tx.abort();
      }
    };
    tx.oncomplete = () => {
      notify();
      channel?.postMessage('changed');
      resolve(output);
    };
    tx.onabort = () => reject(reason || new Error('保存失败，请检查剩余存储空间后重试'));
    tx.onerror = () => {
      reason ||= new Error('保存失败，请检查浏览器存储权限');
    };
  });
}
export function subscribeLedger(listener: () => void) {
  if (!channel && typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel(DB_NAME);
    channel.onmessage = notify;
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export async function requestPersistence() {
  return navigator.storage?.persist ? navigator.storage.persist() : false;
}
export function download(text: string, filename: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function backup(ledger: Ledger, label = '') {
  download(
    JSON.stringify(ledger, null, 2),
    `wallet-backup-${label}${todayLocal()}-${Date.now()}.json`,
  );
}
export function exportCsv(ledger: Ledger) {
  const cell = (value: unknown) => {
    let text = String(value ?? '');
    if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  const rows = [
    ['日期', '类型', '金额（元）', '分类', '备注'],
    ...ledger.entries.map((e) => [
      e.date,
      e.kind,
      (e.cents / 100).toFixed(2),
      ledger.categories.find((c) => c.id === e.categoryId)?.name || '资金调整',
      e.note,
    ]),
  ];
  download(
    '\uFEFF' + rows.map((row) => row.map(cell).join(',')).join('\r\n'),
    `kwallet-${todayLocal()}.csv`,
    'text/csv;charset=utf-8',
  );
}
