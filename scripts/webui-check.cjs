// vue-tsc requires `typescript/lib/tsc`, a subpath that TypeScript 7 no
// longer exports. Run vue-tsc with the TypeScript 5 alias instead.
process.argv = [
    process.argv[0],
    'tsc',
    '--noEmit',
    '-p',
    `${__dirname}/../webui/tsconfig.json`,
]

const { run } = require('vue-tsc')

run(require.resolve('typescript5/lib/tsc'))
