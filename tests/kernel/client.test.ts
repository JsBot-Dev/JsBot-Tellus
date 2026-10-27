import type { ApiResponse, ActionResult, SnowLumaAction } from '@snowluma/sdk'
import { describe, expect, it } from 'vitest'
import { unwrapActionResult } from '../../src/core/client.js'

const action = 'get_login_info' as const

function response(
    overrides: Partial<ApiResponse<ActionResult<typeof action>>>
): ApiResponse<ActionResult<typeof action>> {
    return {
        status: 'ok',
        retcode: 0,
        data: {
            user_id: 10000,
            nickname: 'Bot',
        } as ActionResult<typeof action>,
        ...overrides,
    }
}

describe('BotClient action responses', () => {
    it('returns data for successful responses', () => {
        const result = unwrapActionResult(action, response({}))

        expect(result).toEqual({ user_id: 10000, nickname: 'Bot' })
    })

    it('rejects failed status responses', () => {
        expect(() =>
            unwrapActionResult(
                action,
                response({ status: 'failed', retcode: 100 })
            )
        ).toThrow(/status=failed, retcode=100/)
    })

    it('rejects non-zero retcodes even when status is ok', () => {
        expect(() =>
            unwrapActionResult(action, response({ retcode: 1404 }))
        ).toThrow(/status=ok, retcode=1404/)
    })

    it('prefers the server wording', () => {
        expect(() =>
            unwrapActionResult(
                'send_group_msg' as SnowLumaAction,
                {
                    status: 'ok',
                    retcode: -1,
                    data: null,
                    wording: 'operation denied',
                } as ApiResponse<ActionResult<SnowLumaAction>>
            )
        ).toThrow('operation denied')
    })

    it('falls back when the server wording is empty', () => {
        expect(() =>
            unwrapActionResult(
                'send_group_msg' as SnowLumaAction,
                {
                    status: 'failed',
                    retcode: 100,
                    data: null,
                    wording: '',
                } as ApiResponse<ActionResult<SnowLumaAction>>
            )
        ).toThrow(/status=failed, retcode=100/)
    })
})
