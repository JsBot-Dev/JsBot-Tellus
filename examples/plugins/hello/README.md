# Hello local plugin

This is a minimal local plugin. It registers `/hello` and `/hey`, and reads its
own `reply` option from `plugins.hello`.

Build the project first, then copy the example into the fixed local plugin
directory:

```bash
npm run build
mkdir -p plugins/hello/dist
cp examples/plugins/hello/index.js plugins/hello/dist/index.js
node dist/app.js
```

The app automatically loads `plugins/<id>/dist`.

Enable and configure it in `bot.config.json`:

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
import { definePlugin } from '@jsbot-tellus/core'
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
