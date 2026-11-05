import { createApp } from '../../app.mjs';
import { fetchApp } from '../../fetch-app.mjs';
import { storage } from '../../storage.mjs';
import { schema, loginId, clean } from '../../model.mjs';
import { connect } from '../../turso.mjs';

export const config = {
  path: ['/', '/admin/*', '/auth/*', '/work/*', '/logout'],
  preferStatic: true,
};

export function makeHandler(connectDatabase = connect) {
  let ready;
  function setup() {
    const { APP_ORIGIN = process.env.URL, TURSO_DATABASE_URL, TURSO_AUTH_TOKEN, ADMIN_PASSWORD_HASH } = process.env;
    if (!APP_ORIGIN || !TURSO_DATABASE_URL || !TURSO_AUTH_TOKEN || !/^[a-f0-9]{64}$/.test(ADMIN_PASSWORD_HASH || '')) {
      throw new Error('Netlify environment variables are incomplete.');
    }
    const origin = new URL(APP_ORIGIN).origin;
    const database = connectDatabase(TURSO_DATABASE_URL, TURSO_AUTH_TOKEN);
    const admin = [loginId(process.env.ADMIN_LOGIN || 'boshliq'),
      clean(process.env.ADMIN_NAME || 'Chevarxona boshlig‘i'), 'generated:' + ADMIN_PASSWORD_HASH];
    return database.initialize(schema, admin).then(() => ({ database, app: createApp(origin) }));
  }

  return async function handler(request, context) {
    try {
      const configuredOrigin = process.env.APP_ORIGIN || process.env.URL;
      if (configuredOrigin && new URL(request.url).origin !== new URL(configuredOrigin).origin) {
        return new Response('Ilovaning asosiy manzilini oching.', { status: 421 });
      }
      ready ||= Promise.resolve().then(setup).catch(error => {
        ready = undefined;
        throw error;
      });
      const { database, app } = await ready;
      return await storage.run(database, () => fetchApp(request, app, context?.ip));
    } catch (error) {
      console.error('Chevarxona:', error.code || error.name);
      return new Response('Ilova vaqtincha ishlamayapti. Netlify sozlamalarini tekshiring.',
        { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
    }
  };
}

export default makeHandler();

