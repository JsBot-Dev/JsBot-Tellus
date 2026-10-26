# Hello external plugin

This is a minimal external plugin. It registers `/hello` and `/hey`, and reads
its own `reply` option from `plugins.hello`.

Point the bot at this directory:

```bash
npm run build
node dist/app.js --plugin-dir examples/plugins
```

Enable and configure it in `bot.config.v2.json`:

```json
{
    "plugins": {
        "hello": {
            "enabled": true,
            "reply": "hello from config"
        }
    }
}
```

The plugin is written in plain ESM JavaScript so it can be loaded by the
production build without a separate compilation step. TypeScript plugins can
use the public API:

```ts
import { definePlugin } from '@jsbot/core'
import { z } from 'zod'

export default definePlugin({
    manifest: {
        id: 'typed',
        version: '1.0.0',
        configSchema: z.object({}),
    },
    setup(ctx) {
        ctx.commands.register({ name: 'typed' }, async (_event, context) => {
            await context.send('typed')
        })
    },
})
```

TypeScript plugins must be compiled to JavaScript before the production runtime
loads them.
