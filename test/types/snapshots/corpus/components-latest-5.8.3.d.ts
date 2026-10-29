export declare const componentsLatest: import("@chql/core").Query<{
    entityId: string;
    category: string | null;
    stockTotal: number;
    stockP50: number;
    leadDays: number;
    stockIndex: number;
    asOf: Date;
}, import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly category: import("@chql/core").Expr<string | null, "category", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "Nullable";
                inner: {
                    kind: "scalar";
                    name: "String";
                };
            };
        };
    };
    readonly stockTotal: import("@chql/core").Expr<number, "stockTotal", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly stockP50: import("@chql/core").Expr<number, "stockP50", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly leadDays: import("@chql/core").Expr<number, "leadDays", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly stockIndex: import("@chql/core").Expr<number, "stockIndex", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly asOf: import("@chql/core").Expr<Date, "asOf", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "DateTime64";
                precision: 3;
                tz?: never;
            };
        };
    };
}, false>;
export declare const query: import("@chql/core").Query<{
    entityId: string;
    category: string | null;
    stockTotal: number;
    stockP50: number;
    leadDays: number;
    stockIndex: number;
    asOf: Date;
}, import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly category: import("@chql/core").Expr<string | null, "category", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "Nullable";
                inner: {
                    kind: "scalar";
                    name: "String";
                };
            };
        };
    };
    readonly stockTotal: import("@chql/core").Expr<number, "stockTotal", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly stockP50: import("@chql/core").Expr<number, "stockP50", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly leadDays: import("@chql/core").Expr<number, "leadDays", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly stockIndex: import("@chql/core").Expr<number, "stockIndex", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly asOf: import("@chql/core").Expr<Date, "asOf", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "DateTime64";
                precision: 3;
                tz?: never;
            };
        };
    };
}, false>;
