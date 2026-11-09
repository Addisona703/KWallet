import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadLedger, mutateLedger } from './store';
import { newLedger, type Entry } from '../domain/ledger';

beforeEach(async () => {
  await mutateLedger(() => newLedger('2026-01-01', 0, 0, 200000));
});
const income = (id: string): Entry => ({
  id,
  kind: 'income',
  date: '2026-01-01',
  cents: 100,
  categoryId: 'income-0',
  createdAt: 1,
  note: '',
});
describe('IndexedDB atomic writes', () => {
  it('migrates an existing ledger when loading it without changing entries', async () => {
    const legacy = newLedger('2026-01-01', 10000, 0, 0);
    legacy.categories = legacy.categories.filter(c => c.name !== '生活');
    legacy.entries.push(income('old'));
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('kwallet-local', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('ledger', 'readwrite');
      tx.objectStore('ledger').put(legacy, 'current');
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    });
    db.close();
    const loaded = (await loadLedger())!;
    expect(loaded.categories.filter(c => c.name === '生活')).toHaveLength(1);
    expect(loaded.entries).toEqual(legacy.entries);
    expect((await loadLedger())!.revision).toBe(loaded.revision);
  });
  it('serializes concurrent writes without losing either entry', async () => {
    await Promise.all(
      ['a', 'b'].map((id) =>
        mutateLedger((l) => {
          l!.entries.push(income(id));
          return l!;
        }),
      ),
    );
    expect((await loadLedger())!.entries.map((e) => e.id).sort()).toEqual(['a', 'b']);
  });
  it('rolls back invalid data without modifying existing ledger', async () => {
    const original = await loadLedger();
    await expect(
      mutateLedger((l) => {
        l!.entries.push({ ...income('bad'), cents: -100 });
        return l!;
      }),
    ).rejects.toThrow();
    expect(await loadLedger()).toEqual(original);
  });
  it('rejects stale edits', async () => {
    const original = await loadLedger();
    await mutateLedger((l) => {
      l!.settings.allowance = 100;
      return l!;
    });
    await expect(mutateLedger((l) => l!, original!.revision)).rejects.toThrow('其他页面');
  });
  it('keeps a local recovery copy during restore and preserves it on failure', async () => {
    const previous = await loadLedger();
    await mutateLedger(() => newLedger('2026-01-01', 10000, 0, 0), previous!.revision, true);
    expect(await loadLedger('before-restore')).toEqual(previous);
    const current = await loadLedger();
    await expect(
      mutateLedger(() => newLedger('2026-01-01', 0, -1, 0), current!.revision, true),
    ).rejects.toThrow();
    expect(await loadLedger()).toEqual(current);
    expect(await loadLedger('before-restore')).toEqual(previous);
  });
});
