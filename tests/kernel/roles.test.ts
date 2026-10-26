import { describe, expect, it } from 'vitest'
import { hasPermission } from '../../src/core/security/permission.js'
import { RoleService } from '../../src/core/security/roles.js'

describe('roles', () => {
    const roles = new RoleService({
        superadmin: [10001],
        admin: [10002],
    })

    it('resolves roles by user id', () => {
        expect(roles.roleOf(10001)).toBe('SuperAdmin')
        expect(roles.roleOf(10002)).toBe('Admin')
        expect(roles.roleOf(10003)).toBe('User')
    })

    it('gives superadmin precedence', () => {
        const both = new RoleService({
            superadmin: [1],
            admin: [1],
        })

        expect(both.roleOf(1)).toBe('SuperAdmin')
    })

    it('compares permissions by rank', () => {
        expect(roles.can('SuperAdmin', 'Admin')).toBe(true)
        expect(roles.can('Admin', 'Admin')).toBe(true)
        expect(roles.can('User', 'Admin')).toBe(false)
        expect(hasPermission('Admin', 'SuperAdmin')).toBe(false)
    })
})
