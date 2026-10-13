type PermissionType = 'SuperAdmin' | 'Admin' | 'User'
type MessageType = 'group' | 'private' | undefined
interface JsBotCommandOptions {
    permission?: PermissionType
    docs?: string
    prefix?: string[]
}
type DecoratorContext = ClassMethodDecoratorContext | ClassFieldDecoratorContext

export type { PermissionType, MessageType, JsBotCommandOptions, DecoratorContext}