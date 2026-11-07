import { describe, expect, it } from 'vitest'
import {
    CommandRegistry,
    type CommandGroupRegistration,
} from '../../src/core/dispatch/command.js'
import type { CommandHandler } from '../../src/core/plugin/types.js'

const handler: CommandHandler = async () => {}

function registration(
    name: string,
    overrides: Partial<{
        pluginId: string
        aliases: string[]
        prefixes: string[]
        messageTypes: Array<'group' | 'private'>
        params: string
    }> = {}
) {
    return {
        pluginId: overrides.pluginId ?? 'test',
        name,
        aliases: overrides.aliases ?? [],
        prefixes: overrides.prefixes ?? ['/'],
        permission: 'User' as const,
        messageTypes: overrides.messageTypes ?? ['group', 'private'],
        ...(overrides.params !== undefined ? { params: overrides.params } : {}),
        handler,
    }
}

function groupRegistration(
    name: string,
    overrides: {
        pluginId?: string
        aliases?: string[]
        prefixes?: string[]
        permission?: 'User' | 'Admin' | 'SuperAdmin'
        messageTypes?: Array<'group' | 'private'>
        description?: string
        params?: string
        handler?: CommandHandler
    } = {}
): CommandGroupRegistration {
    return {
        pluginId: overrides.pluginId ?? 'test',
        name,
        aliases: overrides.aliases ?? [],
        prefixes: overrides.prefixes ?? ['/'],
        permission: overrides.permission ?? 'User',
        messageTypes: overrides.messageTypes ?? ['group', 'private'],
        ...(overrides.description !== undefined
            ? { description: overrides.description }
            : {}),
        ...(overrides.params !== undefined ? { params: overrides.params } : {}),
        ...(overrides.handler !== undefined
            ? { handler: overrides.handler }
            : {}),
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

    it('filters commands by message type', () => {
        const registry = new CommandRegistry()
        const groupOnly = registration('group', { messageTypes: ['group'] })
        const privateOnly = registration('private', {
            messageTypes: ['private'],
        })

        registry.register(groupOnly)
        registry.register(privateOnly)

        expect(registry.match('/group', 'group')?.registration.name).toBe(
            'group'
        )
        expect(registry.match('/group', 'private')).toBeNull()
        expect(registry.match('/private', 'private')?.registration.name).toBe(
            'private'
        )
        expect(registry.match('/private', 'group')).toBeNull()
        expect(registry.match('/group')).not.toBeNull()
    })

    it('inherits message types through command groups', () => {
        const registry = new CommandRegistry()

        registry.group(
            groupRegistration('admin', { messageTypes: ['group'] }),
            (group) => {
                group.register({ name: 'list' }, handler)
                group.register({ name: 'say', messageType: 'private' }, handler)
                group.group({ name: 'nested' }, (nested) => {
                    nested.register({ name: 'run' }, handler)
                })
            }
        )

        expect(registry.match('/admin list', 'group')).not.toBeNull()
        expect(registry.match('/admin list', 'private')).toBeNull()
        expect(registry.match('/admin say', 'private')?.registration.name).toBe(
            'admin say'
        )
        expect(registry.match('/admin say', 'group')?.registration.name).toBe(
            'admin'
        )
        expect(registry.match('/admin nested run', 'group')).not.toBeNull()
        expect(registry.match('/admin nested run', 'private')).toBeNull()
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

    it('detects conflicts across dot and whitespace paths', () => {
        const registry = new CommandRegistry()

        registry.register(registration('plugin.install'))

        expect(() =>
            registry.group(groupRegistration('plugin'), (plugin) => {
                plugin.register({ name: 'install' }, handler)
            })
        ).toThrow(/command conflict/)

        expect(registry.match('/plugin.install')).not.toBeNull()
        expect(registry.match('/plugin install')?.registration.name).toBe(
            'plugin.install'
        )
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

    it('removes dotted plugin registrations and prunes their paths', () => {
        const registry = new CommandRegistry()

        registry.register(
            registration('a.b', { pluginId: 'one', aliases: ['x.y'] })
        )
        registry.register(registration('a.c', { pluginId: 'one' }))
        registry.register(registration('a', { pluginId: 'two' }))

        registry.removePlugin('one')

        expect(registry.match('/a.b')?.registration.name).toBe('a')
        expect(registry.match('/a.b')?.match.rest).toBe('b')
        expect(registry.match('/x.y')).toBeNull()
        expect(registry.match('/a.c')?.registration.name).toBe('a')
        expect(registry.match('/a')).not.toBeNull()
        expect(() => registry.register(registration('a.b'))).not.toThrow()
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
                messageTypes: ['group', 'private'],
                pluginId: 'core',
            },
        ])
    })

    it('lists usage generated from params', () => {
        const registry = new CommandRegistry()

        registry.register(
            registration('ask', {
                params: '<question:string> [count:number=1]',
            })
        )

        expect(registry.list()).toEqual([
            {
                name: 'ask',
                aliases: [],
                permission: 'User',
                messageTypes: ['group', 'private'],
                usage: '<question> [count]',
                pluginId: 'test',
            },
        ])
    })

    it('rejects invalid params declarations at registration', () => {
        const registry = new CommandRegistry()

        expect(() =>
            registry.register(registration('bad', { params: '<arg> <arg>' }))
        ).toThrow(/参数名重复/)

        expect(registry.list()).toEqual([])
    })

    it('removes a command when its disposer runs', () => {
        const registry = new CommandRegistry()
        const dispose = registry.register(registration('temp'))

        dispose()
        dispose()

        expect(registry.match('/temp')).toBeNull()
        expect(registry.list()).toEqual([])
        expect(() => registry.register(registration('temp'))).not.toThrow()
    })

    it('prunes empty paths when a nested command is removed', () => {
        const registry = new CommandRegistry()
        const dispose = registry.register(registration('plugin.install'))

        dispose()

        expect(registry.match('/plugin.install')).toBeNull()
        expect(registry.match('/plugin')).toBeNull()
        expect(() =>
            registry.register(registration('plugin.install'))
        ).not.toThrow()
    })

    it('rejects multi-level names in register', () => {
        const registry = new CommandRegistry()

        expect(() => registry.register(registration('plugin install'))).toThrow(
            /single segment/
        )
    })

    it('treats dots and whitespace as equivalent path separators', () => {
        const registry = new CommandRegistry()

        registry.register(registration('utter'))
        registry.register(registration('utter.raw'))

        expect(registry.match('/utter')?.registration.name).toBe('utter')
        expect(registry.match('/utter.raw')?.registration.name).toBe(
            'utter.raw'
        )
        expect(registry.match('/utter raw')?.registration.name).toBe(
            'utter.raw'
        )
        expect(registry.match('/utter.raw hello world')?.match).toEqual({
            command: 'utter.raw',
            prefix: '/',
            args: ['hello', 'world'],
            rest: 'hello world',
        })
        expect(registry.match('/utter raw hello')?.match).toEqual({
            command: 'utter raw',
            prefix: '/',
            args: ['hello'],
            rest: 'hello',
        })
        expect(registry.match('/utter.hello')?.registration.name).toBe('utter')
        expect(registry.match('/utter.hello')?.match.rest).toBe('hello')
    })

    it('matches dotted group subcommands', () => {
        const registry = new CommandRegistry()
        const install: CommandHandler = async () => {}

        registry.group(groupRegistration('plugin'), (plugin) => {
            plugin.register({ name: 'install' }, install)
        })

        const spaced = registry.match('/plugin install demo')
        const dotted = registry.match('/plugin.install demo')

        expect(spaced?.registration.handler).toBe(install)
        expect(dotted?.registration.handler).toBe(install)
        expect(dotted?.match).toEqual({
            command: 'plugin.install',
            prefix: '/',
            args: ['demo'],
            rest: 'demo',
        })
        expect(registry.match('/plugin.unknown')?.match).toEqual({
            command: 'plugin',
            prefix: '/',
            args: ['unknown'],
            rest: 'unknown',
        })
    })

    it('keeps dotted arguments after the command path', () => {
        const registry = new CommandRegistry()

        registry.register(registration('visit'))

        expect(registry.match('/visit example.com')?.match).toEqual({
            command: 'visit',
            prefix: '/',
            args: ['example.com'],
            rest: 'example.com',
        })
        expect(registry.match('/visit.example.com')?.match).toEqual({
            command: 'visit',
            prefix: '/',
            args: ['example.com'],
            rest: 'example.com',
        })
    })

    it('matches dotted aliases', () => {
        const registry = new CommandRegistry()

        registry.register(registration('utter', { aliases: ['u'] }))
        registry.register(registration('utter.raw', { aliases: ['u.r'] }))

        expect(registry.match('/u.r')?.registration.name).toBe('utter.raw')
        expect(registry.match('/u r')?.registration.name).toBe('utter.raw')
    })

    it('matches multi-level commands by longest path', () => {
        const registry = new CommandRegistry()
        const root: CommandHandler = async () => {}
        const list: CommandHandler = async () => {}
        const install: CommandHandler = async () => {}

        registry.group(
            groupRegistration('plugin', {
                permission: 'SuperAdmin',
                handler: root,
            }),
            (plugin) => {
                plugin.register({ name: 'list' }, list)
                plugin.register({ name: 'install' }, install)
            }
        )

        expect(registry.match('/plugin')?.registration.handler).toBe(root)
        expect(registry.match('/plugin unknown')?.match).toEqual({
            command: 'plugin',
            prefix: '/',
            args: ['unknown'],
            rest: 'unknown',
        })

        const found = registry.match('/plugin install demo --force')

        expect(found?.registration.handler).toBe(install)
        expect(found?.match).toEqual({
            command: 'plugin install',
            prefix: '/',
            args: ['demo', '--force'],
            rest: 'demo --force',
        })
        expect(registry.list().map((item) => item.name)).toEqual([
            'plugin',
            'plugin install',
            'plugin list',
        ])
    })

    it('generates usage for group roots without handlers', async () => {
        const registry = new CommandRegistry()
        const messages: unknown[] = []

        registry.group(groupRegistration('plugin'), (plugin) => {
            plugin.register(
                { name: 'install', description: '安装插件包' },
                handler
            )
        })

        const found = registry.match('/plugin')

        if (!found) throw new Error('expected group root')

        await found.registration.handler(
            {} as never,
            {
                send: async (message: unknown) => {
                    messages.push(message)
                },
            } as never,
            found.match
        )

        expect(String(messages[0])).toContain('用法：/plugin <install>')
        expect(String(messages[0])).toContain('/plugin install - 安装插件包')
    })

    it('shows child params in group usage', async () => {
        const registry = new CommandRegistry()
        const messages: unknown[] = []

        registry.group(groupRegistration('demo'), (demo) => {
            demo.register(
                {
                    name: 'ask',
                    params: '<question:text>',
                    description: '提问',
                },
                handler
            )
        })

        const found = registry.match('/demo')

        if (!found) throw new Error('expected group root')

        await found.registration.handler(
            {} as never,
            {
                send: async (message: unknown) => {
                    messages.push(message)
                },
            } as never,
            found.match
        )

        expect(String(messages[0])).toContain('/demo ask <question...> - 提问')
        expect(
            registry.list().find((item) => item.name === 'demo ask')?.usage
        ).toBe('<question...>')
    })

    it('records usage for group roots with params', () => {
        const registry = new CommandRegistry()

        registry.group(
            groupRegistration('demo', { params: '[target:string]' }),
            (demo) => {
                demo.register({ name: 'child' }, handler)
            }
        )

        expect(registry.list()[0]).toMatchObject({
            name: 'demo',
            usage: '[target]',
        })
    })

    it('composes group and command aliases', () => {
        const registry = new CommandRegistry()
        const install: CommandHandler = async () => {}

        registry.group(
            groupRegistration('plugin', { aliases: ['p'] }),
            (plugin) => {
                plugin.register({ name: 'install', aliases: ['i'] }, install)
            }
        )

        const found = registry.match('/p i demo')

        expect(found?.registration.handler).toBe(install)
        expect(found?.match).toEqual({
            command: 'p i',
            prefix: '/',
            args: ['demo'],
            rest: 'demo',
        })
        expect(
            registry.list().find((item) => item.name === 'plugin install')
                ?.aliases
        ).toEqual(['plugin i', 'p install', 'p i'])
    })

    it('supports nested groups', () => {
        const registry = new CommandRegistry()
        const clear: CommandHandler = async () => {}

        registry.group(groupRegistration('plugin'), (plugin) => {
            plugin.group(
                groupRegistration('cache', { aliases: ['c'] }),
                (cache) => {
                    cache.register({ name: 'clear' }, clear)
                }
            )
        })

        const found = registry.match('/plugin c clear now')

        expect(found?.registration.handler).toBe(clear)
        expect(found?.match).toEqual({
            command: 'plugin c clear',
            prefix: '/',
            args: ['now'],
            rest: 'now',
        })
    })

    it('inherits group options and lets children override them', () => {
        const registry = new CommandRegistry()
        const list: CommandHandler = async () => {}
        const publicCommand: CommandHandler = async () => {}

        registry.group(
            groupRegistration('plugin', { permission: 'SuperAdmin' }),
            (plugin) => {
                plugin.register({ name: 'list' }, list)
                plugin.register(
                    {
                        name: 'public',
                        permission: 'User',
                        prefixes: ['!'],
                    },
                    publicCommand
                )
            }
        )

        expect(registry.match('/plugin list')?.registration.permission).toBe(
            'SuperAdmin'
        )
        expect(registry.match('!plugin public')?.registration.permission).toBe(
            'User'
        )
        expect(registry.match('/plugin public')?.match.command).toBe('plugin')
    })

    it('rolls back a group when setup fails', () => {
        const registry = new CommandRegistry()

        expect(() =>
            registry.group(groupRegistration('plugin'), (plugin) => {
                plugin.register({ name: 'install' }, handler)
                throw new Error('setup failed')
            })
        ).toThrow('setup failed')

        expect(registry.match('/plugin')).toBeNull()
        expect(registry.match('/plugin install')).toBeNull()
        expect(registry.list()).toEqual([])
    })

    it('rolls back group children when the group root conflicts', () => {
        const registry = new CommandRegistry()

        registry.register(registration('plugin'))

        expect(() =>
            registry.group(groupRegistration('plugin'), (plugin) => {
                plugin.register({ name: 'install' }, handler)
            })
        ).toThrow(/command conflict/)

        expect(registry.match('/plugin')).not.toBeNull()
        expect(registry.match('/plugin install')?.match.command).toBe('plugin')
        expect(registry.list().map((item) => item.name)).toEqual(['plugin'])
    })

    it('removes grouped commands when the group disposer runs', () => {
        const registry = new CommandRegistry()
        const dispose = registry.group(
            groupRegistration('plugin'),
            (plugin) => {
                plugin.register({ name: 'list' }, handler)
            }
        )

        dispose()
        dispose()

        expect(registry.match('/plugin')).toBeNull()
        expect(registry.match('/plugin list')).toBeNull()
        expect(registry.list()).toEqual([])
    })

    it('removes grouped commands by plugin', () => {
        const registry = new CommandRegistry()

        registry.group(
            groupRegistration('plugin', { pluginId: 'one' }),
            (plugin) => {
                plugin.register({ name: 'list' }, handler)
            }
        )
        registry.group(
            groupRegistration('other', { pluginId: 'two' }),
            (other) => {
                other.register({ name: 'list' }, handler)
            }
        )

        registry.removePlugin('one')

        expect(registry.match('/plugin')).toBeNull()
        expect(registry.match('/plugin list')).toBeNull()
        expect(registry.match('/other list')).not.toBeNull()
    })
})
