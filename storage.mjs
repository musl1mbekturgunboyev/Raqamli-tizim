import { AsyncLocalStorage } from 'node:async_hooks';
export const storage = new AsyncLocalStorage();
let local;
export function configureLocal(database) { local = database; }
export function currentStorage() {
  const database = storage.getStore() || local;
  if (!database) throw new Error('Ma’lumotlar bazasi ochilmagan.');
  return database;
}

