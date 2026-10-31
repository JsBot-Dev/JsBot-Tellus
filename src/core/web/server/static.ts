import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname, join, resolve, sep } from 'node:path'
import { HttpError, isImmutableAsset, mimeType, withTimeout } from '../http.js'

export interface FallbackPageOptions {
    listening: string
}

export const FALLBACK_BODY = (
    options: FallbackPageOptions
): string => `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>JsBot WebUI</title>
<style>body{font-family:system-ui,sans-serif;max-width:36em;margin:4rem auto;padding:0 1rem;color:#333}</style>
</head><body>
<h1>WebUI 前端未构建</h1>
<p>管理 API 正常运行，但静态资源缺失。请在项目根目录执行：</p>
<pre><code>npm run build:webui</code></pre>
<p>然后重启进程，访问 <code>${options.listening}</code>。</p>
<p>API 仍可通过 <code>/api/health</code>、登录和各接口访问。</p>
</body></html>
`

export interface ServeStaticOptions {
    req: IncomingMessage
    res: ServerResponse
    pathname: string
    staticDir: string | null
    fallbackBody: string
}

export async function serveStatic(options: ServeStaticOptions): Promise<void> {
    const { req, res, pathname, staticDir, fallbackBody } = options

    if (req.method !== 'GET' && req.method !== 'HEAD') {
        throw new HttpError(405, `method not allowed: ${req.method}`)
    }

    if (staticDir === null) {
        res.setHeader('content-type', 'text/html; charset=utf-8')
        res.setHeader('cache-control', 'no-store')
        res.writeHead(503)
        res.end(fallbackBody)

        return
    }

    const cleaned = pathname.replace(/\/+$/, '') || '/'
    let filePath =
        cleaned === '/'
            ? join(staticDir, 'index.html')
            : resolve(staticDir, `.${cleaned}`)

    if (!filePath.startsWith(staticDir + sep) && filePath !== staticDir) {
        throw new HttpError(403, 'forbidden')
    }

    let fileStat = await statOrNull(filePath)

    if (fileStat?.isDirectory()) {
        filePath = join(filePath, 'index.html')
        fileStat = await statOrNull(filePath)
    }

    if (fileStat === null) {
        // SPA fallback: only routes without a file extension.
        if (extname(cleaned) === '') {
            filePath = join(staticDir, 'index.html')
            fileStat = await statOrNull(filePath)
        }

        if (fileStat === null) throw new HttpError(404, 'not found')
    }

    const cacheControl = isImmutableAsset(cleaned)
        ? 'public, max-age=31536000, immutable'
        : 'no-cache'

    res.setHeader('content-type', mimeType(filePath))
    res.setHeader('cache-control', cacheControl)
    res.setHeader('content-length', String(fileStat.size))
    res.writeHead(200)

    if (req.method === 'HEAD') {
        res.end()

        return
    }

    const stream = createReadStream(filePath)

    stream.on('error', () => {
        try {
            res.end()
        } catch {
            // Already closed.
        }
    })
    stream.pipe(res)
}

export async function statOrNull(
    filePath: string
): Promise<Awaited<ReturnType<typeof stat>> | null> {
    try {
        return await withTimeout(stat(filePath), 1_000)
    } catch {
        return null
    }
}
