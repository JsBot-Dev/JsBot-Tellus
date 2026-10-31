type Whitespace = ' ' | '\n' | '\r' | '\t' | '\v' | '\f'

type TrimLeft<Source extends string> =
    Source extends `${Whitespace}${infer Rest}` ? TrimLeft<Rest> : Source

type TrimRight<Source extends string> =
    Source extends `${infer Rest}${Whitespace}` ? TrimRight<Rest> : Source

type Trim<Source extends string> = TrimLeft<TrimRight<Source>>

type ParamValue<Type extends string> =
    Trim<Type> extends 'string' | 'text'
        ? string
        : Trim<Type> extends 'number' | 'integer' | 'at' | 'reply' | 'time'
          ? number
          : Trim<Type> extends 'boolean'
            ? boolean
            : unknown

interface VariadicParam {
    readonly variadic: true
}

type ParamType<Head extends string> = Head extends `${string}:${infer Type}`
    ? ParamValue<Type>
    : string

type ParamElement<Body extends string, Required extends boolean> =
    Trim<Body> extends `...${string}`
        ? VariadicParam
        : Trim<Body> extends `${infer Head}=${string}`
          ? ParamType<Head>
          : Required extends true
            ? ParamType<Body>
            : ParamType<Body> | undefined

type AppendParam<Acc extends unknown[], Element> = [Element] extends [
    VariadicParam,
]
    ? [...Acc, ...string[]]
    : [...Acc, Element]

type ParseCommandParams<Source extends string, Acc extends unknown[] = []> =
    Trim<Source> extends ''
        ? Acc
        : Trim<Source> extends `<${infer Body}>${infer Rest}`
          ? ParamElement<Body, true> extends VariadicParam
              ? any[]
              : ParseCommandParams<
                    Rest,
                    AppendParam<Acc, ParamElement<Body, true>>
                >
          : Trim<Source> extends `[${infer Body}]${infer Rest}`
            ? ParamElement<Body, false> extends VariadicParam
                ? Trim<Rest> extends ''
                    ? [...Acc, ...string[]]
                    : any[]
                : ParseCommandParams<
                      Rest,
                      AppendParam<Acc, ParamElement<Body, false>>
                  >
            : any[]

/**
 * 把 `params` 声明字符串推导成 handler 的位置参数 tuple。
 *
 * 非字面量声明（例如运行时拼接的 `string`）或无法解析的声明会回退为
 * `any[]`，以保证现有插件仍然可以编译。
 */
export type CommandParamArgs<Declaration extends string> =
    string extends Declaration ? any[] : ParseCommandParams<Declaration>
