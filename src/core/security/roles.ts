import type { RolesConfig } from '../config/schema.js'
import { hasPermission, type Permission } from './permission.js'

export class RoleService {
    private readonly superadmin: ReadonlySet<number>
    private readonly admin: ReadonlySet<number>

    constructor(config: RolesConfig) {
        this.superadmin = new Set(config.superadmin)
        this.admin = new Set(config.admin)
    }

    roleOf(userId: number): Permission {
        if (this.superadmin.has(userId)) return 'SuperAdmin'
        if (this.admin.has(userId)) return 'Admin'

        return 'User'
    }

    can(actual: Permission, required: Permission): boolean {
        return hasPermission(actual, required)
    }
}
