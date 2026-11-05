export type Permission = 'User' | 'Admin' | 'SuperAdmin'

export const DEFAULT_PERMISSION_DENIED_MESSAGE =
    '权限不足：需要 {required}，当前 {actual}'

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
