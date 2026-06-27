Splice into `apps/{{DOMAIN}}-api/src/main.ts` after `NestFactory.create`, before `app.listen` (use your chosen UI dev-server port for `{{UI_PORT}}`):

```typescript
app.enableCors({ origin: 'http://localhost:{{UI_PORT}}' });
```
