import { describe, expect, it } from 'vitest'
import { CommandRegistry } from '../../src/core/dispatch/command.js'
import type { CommandHandler } from '../../src/core/plugin/types.js'

const handler: CommandHandler = async () => {}

function registration(
    name: string,
    overrides: Partial<{
        pluginId: string
        aliases: string[]
        prefixes: string[]
    }> = {}
) {
    return {
        pluginId: overrides.pluginId ?? 'test',
        name,
        aliases: overrides.aliases ?? [],
        prefixes: overrides.prefixes ?? ['/'],
        permission: 'User' as const,
        handler,
    }
}

describe('command registry', () => {
    it('matches commands and aliases case-insensitively', () => {
        const registry = new CommandRegistry()

        registry.register(registration('help', { aliases: ['h'] }))

        expect(registry.match('/HELP now')?.match).toEqual({
            command: 'HELP',
            prefix: '/',
            args: ['now'],
            rest: 'now',
        })
        expect(registry.match('/h')?.match.command).toBe('h')
        expect(registry.match('help')).toBeNull()
    })

    it('prefers longer prefixes', () => {
        const registry = new CommandRegistry()

        registry.register(
            registration('help', {
                prefixes: ['/', '//'],
            })
        )

        const found = registry.match('//help x')

        expect(found?.match.prefix).toBe('//')
        expect(found?.match.rest).toBe('x')
    })

    it('supports empty prefixes', () => {
        const registry = new CommandRegistry()

        registry.register(registration('ping', { prefixes: [''] }))

        expect(registry.match('ping')?.match.command).toBe('ping')
        expect(registry.match('pong')).toBeNull()
    })

    it('rejects command conflicts', () => {
        const registry = new CommandRegistry()

        registry.register(registration('help'))

        expect(() => registry.register(registration('help'))).toThrow(
            /command conflict/
        )
        expect(() =>
            registry.register(registration('other', { aliases: ['help'] }))
        ).toThrow(/command conflict/)
    })

    it('removes plugin registrations', () => {
        const registry = new CommandRegistry()

        registry.register(
            registration('a', { pluginId: 'one', aliases: ['x'] })
        )
        registry.register(registration('b', { pluginId: 'two' }))

        registry.removePlugin('one')

        expect(registry.match('/a')).toBeNull()
        expect(registry.match('/x')).toBeNull()
        expect(registry.match('/b')).not.toBeNull()
        expect(registry.list().map((item) => item.name)).toEqual(['b'])
    })

    it('lists registrations with metadata', () => {
        const registry = new CommandRegistry()

        registry.register(
            registration('help', {
                pluginId: 'core',
                aliases: ['h'],
            })
        )

        expect(registry.list()).toEqual([
            {
                name: 'help',
                aliases: ['h'],
                permission: 'User',
                pluginId: 'core',
            },
        ])
    })

    it('removes a command when its disposer runs', () => {
        const registry = new CommandRegistry()
        const dispose = registry.register(registration('temp'))

        dispose()
        dispose()

        expect(registry.match('/temp')).toBeNull()
        expect(registry.list()).toEqual([])
    })
})
