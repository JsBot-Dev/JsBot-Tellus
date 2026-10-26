export type Permission = 'User' | 'Admin' | 'SuperAdmin'

const RANK: Record<Permission, number> = {
    User: 0,
    Admin: 1,
    SuperAdmin: 2,
}

export function hasPermission(
    actual: Permission,
    required: Permission
): boolean {
    return RANK[actual] >= RANK[required]
}
