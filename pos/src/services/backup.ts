import { backfillSizes, db, TABLE_NAMES } from '@/data/db'
import { assertCan } from './context'
import { audit } from './audit'

export interface BackupFile {
  app: 'lattafa-pos'
  version: 1
  createdAt: number
  tables: Record<string, unknown[]>
}

/** Full copy of the local database (includes credential hashes — keep it private). */
export async function exportBackup(): Promise<BackupFile> {
  assertCan('backup.manage')
  const tables: Record<string, unknown[]> = {}
  // remembered sign-ins (tokens) never leave the device
  for (const name of TABLE_NAMES) if (name !== 'creds') tables[name] = await db.table(name).toArray()
  await audit('backup.export', 'backup', '*', { rows: Object.values(tables).reduce((a, r) => a + r.length, 0) })
  return { app: 'lattafa-pos', version: 1, createdAt: Date.now(), tables }
}

export function isBackupFile(x: unknown): x is BackupFile {
  const b = x as BackupFile
  return !!b && b.app === 'lattafa-pos' && b.version === 1 && typeof b.tables === 'object' && Array.isArray(b.tables.users)
}

/** Replaces everything with the backup's contents. */
export async function importBackup(file: BackupFile): Promise<void> {
  assertCan('backup.manage')
  if (!isBackupFile(file)) throw new Error('invalid_backup')
  await db.transaction('rw', TABLE_NAMES.map((n) => db.table(n)), async () => {
    for (const name of TABLE_NAMES) {
      await db.table(name).clear()
      const rows = file.tables[name] ?? []
      if (rows.length) await db.table(name).bulkAdd(rows)
    }
    await backfillSizes(db.variants) // a backup taken before ml/oz units existed
  })
}

/** Erase every table (factory reset). The caller reloads the app afterwards. */
export async function wipeAll(): Promise<void> {
  assertCan('backup.manage')
  await db.transaction('rw', TABLE_NAMES.map((n) => db.table(n)), async () => {
    for (const name of TABLE_NAMES) await db.table(name).clear()
  })
}
