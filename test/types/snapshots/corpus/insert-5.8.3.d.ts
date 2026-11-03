import { type InsertRow } from '@typedhouse/core';
export declare const target: import("@typedhouse/core").TableDef<{
    id: bigint;
    nullable: string | null;
    label: string;
    alias: bigint;
    materialized: bigint;
}> & {
    readonly columns: {
        readonly id: {
            readonly kind: "scalar";
            readonly name: "UInt64";
        };
        readonly nullable: {
            readonly kind: "Nullable";
            readonly inner: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
        readonly label: {
            readonly kind: "scalar";
            readonly name: "String";
        };
        readonly alias: {
            readonly kind: "scalar";
            readonly name: "UInt64";
        };
        readonly materialized: {
            readonly kind: "scalar";
            readonly name: "UInt64";
        };
    };
} & {
    readonly source?: never;
} & Pick<{
    readonly engine: "Memory";
    readonly sortingKey: readonly [];
    readonly partitionKey: readonly [];
    readonly columnMetadata: {
        readonly label: {
            readonly defaultKind: "DEFAULT";
        };
        readonly alias: {
            readonly defaultKind: "ALIAS";
        };
        readonly materialized: {
            readonly defaultKind: "MATERIALIZED";
        };
    };
}, "columnMetadata">;
export type Row = InsertRow<typeof target>;
export declare const rows: readonly Row[];
export declare const command: import("@typedhouse/core").InsertCommand;
