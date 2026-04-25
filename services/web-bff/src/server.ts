import { buildApp } from './build-app';

async function main() {
  const port = Number(process.env.BFF_PORT ?? process.env.PORT ?? 3080);
  const app = await buildApp();
  await app.listen({ port, host: '0.0.0.0' });
  app.log.info({ port }, 'OAT Web BFF listening');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
