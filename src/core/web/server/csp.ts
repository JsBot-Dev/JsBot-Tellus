import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * CSP for the WebUI. webui/index.html ships a single authorized inline
 * script (the no-flash appearance bootstrap for the first paint); its exact
 * hash is derived from the built index.html on disk so editing the bootstrap
 * only needs a rebuild, never a source edit. Every other inline script
 * stays blocked.
 */
export function buildCsp(scriptSrc: string): string {
    return `default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src ${scriptSrc}; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`
}

/** Extracts the bootstrap script's sha256 from a built index.html. */
export function cspForStaticDir(staticDir: string): string | null {
    try {
        const html = readFileSync(join(staticDir, 'index.html'), 'utf8')
        const match = /<script>([\s\S]*?)<\/script>/.exec(html)
        const bootstrap = match?.[1]

        if (bootstrap === undefined) return null

        const hash = createHash('sha256')
            .update(bootstrap, 'utf8')
            .digest('base64')

        return buildCsp(`'self' 'sha256-${hash}'`)
    } catch {
        return null
    }
}
