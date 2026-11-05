import { createClient } from '@libsql/client/web';
import { storage } from './storage.mjs';

function queries(executor) {
  const execute = (sql, args) => executor.execute({ sql, args });
  return {
    async one(sql, ...args) { return (await execute(sql, args)).rows[0]; },
    async all(sql, ...args) { return (await execute(sql, args)).rows; },
    async run(sql, ...args) {
      const result = await execute(sql, args);
      return { changes: result.rowsAffected, lastInsertRowid: Number(result.lastInsertRowid ?? 0) };
    },
  };
}

export function connect(url, authToken) {
  return adaptClient(createClient({ url: url.replace(/^libsql:/, 'https:'), authToken }));
}

export function adaptClient(client) {
  return {
    ...queries(client),
    async transaction(work) {
      const tx = await client.transaction('write');
      try {
        const result = await storage.run(queries(tx), work);
        await tx.commit();
        return result;
      } catch (error) {
        if (!tx.closed) await tx.rollback();
        throw error;
      } finally {
        tx.close();
      }
    },
    initialize: (sql, admin) => client.batch([
      ...sql.split(';').map(statement => statement.trim()).filter(Boolean),
      { sql: `INSERT INTO people(login,name,role,password)
        SELECT ?,?,'admin',? WHERE NOT EXISTS(SELECT 1 FROM people WHERE role='admin')`, args: admin },
    ], 'write'),
  };
}

