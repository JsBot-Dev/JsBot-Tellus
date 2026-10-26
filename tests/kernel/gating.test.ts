import { z } from 'zod'
import { describe, expect, it } from 'vitest'
import type { SnowLumaEvent } from '@snowluma/sdk'
import type { PluginEnvelope } from '../../src/core/config/schema.js'
import { PluginGate } from '../../src/core/plugin/gating.js'
import {
    definePlugin,
    type AnyPluginDefinition,
} from '../../src/core/plugin/types.js'
import { groupMessage, privateMessage } from '../helpers/events.js'

function plugin(id: string, defaultEnabled: boolean): AnyPluginDefinition {
    return definePlugin({
        manifest: {
            id,
            version: '1.0.0',
            defaultEnabled,
            configSchema: z.object({}).strict(),
        },
        setup() {},
    })
}

function configs(
    value: Record<string, unknown>
): Record<string, PluginEnvelope> {
    return value as Record<string, PluginEnvelope>
}

describe('plugin gate', () => {
    it('uses manifest defaults', () => {
        const gate = new PluginGate(
            [plugin('on', true), plugin('off', false)],
            configs({})
        )

        expect(gate.isPluginEnabled('on')).toBe(true)
        expect(gate.isPluginEnabled('off')).toBe(false)
        expect(gate.isPluginEnabled('missing')).toBe(false)
    })

    it('lets config override the default', () => {
        const gate = new PluginGate(
            [plugin('a', true), plugin('b', false)],
            configs({
                a: { enabled: false },
                b: { enabled: true },
            })
        )

        expect(gate.isPluginEnabled('a')).toBe(false)
        expect(gate.isPluginEnabled('b')).toBe(true)
    })

    it('applies group allow lists', () => {
        const gate = new PluginGate(
            [plugin('a', true)],
            configs({
                a: {
                    groups: { allow: [1], deny: [] },
                },
            })
        )

        expect(gate.isEnabled('a', groupMessage({ group_id: 1 }))).toBe(true)
        expect(gate.isEnabled('a', groupMessage({ group_id: 2 }))).toBe(false)
    })

    it('applies group deny lists', () => {
        const gate = new PluginGate(
            [plugin('a', true)],
            configs({
                a: {
                    groups: { allow: [], deny: [2] },
                },
            })
        )

        expect(gate.isEnabled('a', groupMessage({ group_id: 1 }))).toBe(true)
        expect(gate.isEnabled('a', groupMessage({ group_id: 2 }))).toBe(false)
    })

    it('applies the private switch', () => {
        const gate = new PluginGate(
            [plugin('a', true)],
            configs({ a: { private: false } })
        )

        expect(gate.isEnabled('a', privateMessage())).toBe(false)
        expect(gate.isEnabled('a', groupMessage())).toBe(true)
    })

    it('allows private chats by default', () => {
        const gate = new PluginGate([plugin('a', true)], configs({}))

        expect(gate.isEnabled('a', privateMessage())).toBe(true)
    })

    it('handles events without a group id', () => {
        const gate = new PluginGate(
            [plugin('a', true)],
            configs({ a: { private: false } })
        )
        const event = {
            time: 1,
            self_id: 1,
            post_type: 'meta_event',
            meta_event_type: 'heartbeat',
        } as SnowLumaEvent

        expect(gate.isEnabled('a', event)).toBe(false)
    })
})
