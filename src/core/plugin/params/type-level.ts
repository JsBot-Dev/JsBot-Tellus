type Whitespace = ' ' | '\n' | '\r' | '\t' | '\v' | '\f'

type TrimLeft<Source extends string> =
    Source extends `${Whitespace}${infer Rest}` ? TrimLeft<Rest> : Source

type TrimRight<Source extends string> =
    Source extends `${infer Rest}${Whitespace}` ? TrimRight<Rest> : Source

type Trim<Source extends string> = TrimLeft<TrimRight<Source>>

type StripLength<Type extends string> =
    Trim<Type> extends `${infer Base}(${string})` ? Trim<Base> : Trim<Type>

type Unescape<Source extends string> =
    Source extends `${infer Head}\\${infer Next}${infer Rest}`
        ? `${Head}${Next}${Unescape<Rest>}`
        : Source

type SplitUnionScan<
    Source extends string,
    Quote extends string | null = null,
    Current extends string = '',
    Acc extends string[] = [],
> = Source extends `${infer Char}${infer Rest}`
    ? Char extends '\\'
        ? Rest extends `${infer Next}${infer Tail}`
            ? SplitUnionScan<Tail, Quote, `${Current}${Char}${Next}`, Acc>
            : [...Acc, `${Current}${Char}`]
        : Char extends '"' | "'"
          ? Quote extends null
              ? SplitUnionScan<Rest, Char, `${Current}${Char}`, Acc>
              : Char extends Quote
                ? SplitUnionScan<Rest, null, `${Current}${Char}`, Acc>
                : SplitUnionScan<Rest, Quote, `${Current}${Char}`, Acc>
          : Char extends '|'
            ? Quote extends null
                ? SplitUnionScan<Rest, null, '', [...Acc, Current]>
                : SplitUnionScan<Rest, Quote, `${Current}${Char}`, Acc>
            : SplitUnionScan<Rest, Quote, `${Current}${Char}`, Acc>
    : [...Acc, Current]

type SplitUnion<Source extends string> = Source extends `${string}|${string}`
    ? SplitUnionScan<Source>
    : [Source]

type LiteralValue<Type extends string> =
    Trim<Type> extends `'${infer Inner}'`
        ? Unescape<Inner>
        : Trim<Type> extends `"${infer Inner}"`
          ? Unescape<Inner>
          : never

type BuiltinValue<Type extends string> =
    StripLength<Type> extends 'string' | 'text'
        ? string
        : StripLength<Type> extends
                'number' | 'integer' | 'at' | 'reply' | 'time'
          ? number
          : StripLength<Type> extends 'boolean'
            ? boolean
            : unknown

type ParamValuePart<Type extends string> =
    Trim<Type> extends `'${string}'` | `"${string}"`
        ? LiteralValue<Type>
        : BuiltinValue<Type>

type ParamValue<Type extends string> =
    SplitUnion<Type>[number] extends infer Part
        ? Part extends string
            ? ParamValuePart<Part>
            : never
        : never

type SplitTypeScan<
    Source extends string,
    Quote extends string | null = null,
    Name extends string = '',
> = Source extends `${infer Char}${infer Rest}`
    ? Char extends '\\'
        ? Rest extends `${infer Next}${infer Tail}`
            ? SplitTypeScan<Tail, Quote, `${Name}${Char}${Next}`>
            : [Name, null]
        : Char extends '"' | "'"
          ? Quote extends null
              ? SplitTypeScan<Rest, Char, `${Name}${Char}`>
              : Char extends Quote
                ? SplitTypeScan<Rest, null, `${Name}${Char}`>
                : SplitTypeScan<Rest, Quote, `${Name}${Char}`>
          : Char extends ':'
            ? Quote extends null
                ? [Name, Rest]
                : SplitTypeScan<Rest, Quote, `${Name}${Char}`>
            : SplitTypeScan<Rest, Quote, `${Name}${Char}`>
    : [Name, null]

type SplitType<Source extends string> = Source extends `${string}:${string}`
    ? SplitTypeScan<Source>
    : [Source, null]

type SplitDefaultScan<
    Source extends string,
    Quote extends string | null = null,
    Head extends string = '',
> = Source extends `${infer Char}${infer Rest}`
    ? Char extends '\\'
        ? Rest extends `${infer Next}${infer Tail}`
            ? SplitDefaultScan<Tail, Quote, `${Head}${Char}${Next}`>
            : [Head, false]
        : Char extends '"' | "'"
          ? Quote extends null
              ? SplitDefaultScan<Rest, Char, `${Head}${Char}`>
              : Char extends Quote
                ? SplitDefaultScan<Rest, null, `${Head}${Char}`>
                : SplitDefaultScan<Rest, Quote, `${Head}${Char}`>
          : Char extends '='
            ? Quote extends null
                ? [Head, true]
                : SplitDefaultScan<Rest, Quote, `${Head}${Char}`>
            : SplitDefaultScan<Rest, Quote, `${Head}${Char}`>
    : [Head, false]

type SplitDefault<Source extends string> = Source extends `${string}=${string}`
    ? SplitDefaultScan<Source>
    : [Source, false]

interface VariadicParam {
    readonly variadic: true
}

type ParamType<Head extends string> =
    SplitType<Head> extends [unknown, infer Type]
        ? Type extends string
            ? ParamValue<Type>
            : string
        : string

type ParamElement<Body extends string, Required extends boolean> =
    Trim<Body> extends `...${string}`
        ? VariadicParam
        : SplitDefault<Trim<Body>> extends [infer Head, true]
          ? Head extends string
              ? ParamType<Head>
              : never
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
